import logging
from dataclasses import dataclass
from time import monotonic
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class UniFiError(Exception):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class UniFiClientRecord:
    id: str
    mac: str
    site_id: str
    authorized: bool
    ap_mac: str = ""
    ssid: str = ""
    ip: str = ""
    signal: int | None = None
    raw: dict[str, Any] | None = None


@dataclass(frozen=True)
class UniFiClientContext:
    site_id: str
    site_name: str
    client_id: str
    client: UniFiClientRecord


def _mac(value: str | None) -> str:
    return str(value or "").strip().lower()


def _site_id(site: dict[str, Any]) -> str:
    return str(site.get("id") or site.get("siteId") or site.get("_id") or "")


def _site_name(site: dict[str, Any]) -> str:
    return str(site.get("name") or site.get("displayName") or site.get("description") or _site_id(site))


def _client_mac(client: dict[str, Any]) -> str:
    return _mac(client.get("macAddress") or client.get("mac") or client.get("clientMac"))


def _client_id(client: dict[str, Any]) -> str:
    return str(client.get("id") or client.get("_id") or client.get("clientId") or "")


def _client_ap_mac(client: dict[str, Any]) -> str:
    access_point = client.get("accessPoint") or {}
    uplink = client.get("uplinkDevice") or {}
    wifi = client.get("wifiConnection") or {}
    return _mac(
        access_point.get("macAddress")
        or access_point.get("mac")
        or uplink.get("macAddress")
        or uplink.get("mac")
        or wifi.get("apMacAddress")
        or wifi.get("apMac")
        or client.get("apMacAddress")
        or client.get("apMac")
        or client.get("uplinkMac")
    )


def _record(site_id: str, client: dict[str, Any]) -> UniFiClientRecord:
    access = client.get("access") or {}
    wifi = client.get("wifiConnection") or {}
    return UniFiClientRecord(
        id=_client_id(client),
        mac=_client_mac(client),
        site_id=site_id,
        authorized=bool(access.get("authorized")),
        ap_mac=_client_ap_mac(client),
        ssid=str(wifi.get("ssid") or client.get("ssid") or ""),
        ip=str(client.get("ipAddress") or client.get("ip") or ""),
        signal=client.get("signal"),
        raw=client,
    )


def _device_type(row: dict[str, Any]) -> str:
    return str(row.get("type") or row.get("deviceType") or row.get("category") or "").upper()


def is_access_point(row: dict[str, Any]) -> bool:
    device_type = _device_type(row)
    model = str(row.get("model") or row.get("modelName") or "").upper()
    return device_type in {"UAP", "ACCESS_POINT", "AP"} or model.startswith(("UAP", "U6", "U7"))


class UniFiClient:
    """Official UniFi Network Integration API client."""

    def __init__(self) -> None:
        settings = get_settings()
        self.base_url = settings.unifi_base_url.rstrip("/")
        self.prefix = "/" + settings.unifi_api_prefix.strip("/")
        self.site_name = settings.unifi_site
        self.cache_ttl_seconds = settings.unifi_cache_ttl_seconds
        self._cache: dict[tuple[str, str], tuple[float, dict | list]] = {}
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"X-API-Key": settings.unifi_api_key, "Accept": "application/json"},
            verify=settings.unifi_verify_ssl,
            timeout=settings.unifi_timeout_seconds,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, **kwargs) -> dict | list:
        response = await self._client.request(method, f"{self.prefix}{path}", **kwargs)
        if response.status_code >= 400:
            raise UniFiError(f"UniFi {method} {path} failed with HTTP {response.status_code}", status_code=response.status_code)
        return response.json()

    def _cached(self, key: tuple[str, str]) -> dict | list | None:
        expires_at, payload = self._cache.get(key, (0.0, []))
        if expires_at > monotonic():
            return payload
        self._cache.pop(key, None)
        return None

    def _remember(self, key: tuple[str, str], payload: dict | list) -> dict | list:
        if self.cache_ttl_seconds > 0:
            self._cache[key] = (monotonic() + self.cache_ttl_seconds, payload)
        return payload

    def _clear_cache(self, site_id: str | None = None) -> None:
        if site_id is None:
            self._cache.clear()
            return
        for key in list(self._cache):
            if key[1].startswith(f"/sites/{site_id}/") or key == ("GET", "/sites"):
                self._cache.pop(key, None)

    async def list_sites(self) -> list[dict[str, Any]]:
        key = ("GET", "/sites")
        payload = self._cached(key)
        if payload is None:
            payload = self._remember(key, await self._request("GET", "/sites"))
        if isinstance(payload, list):
            return payload
        return payload.get("data", []) if isinstance(payload, dict) else []

    async def resolve_site_id(self, requested: str | None = None) -> str:
        desired = str(requested or "").strip().lower()
        if not desired:
            raise UniFiError("UniFi site must be explicit for this operation.")
        sites = await self.list_sites()
        for site in sites:
            if _site_id(site).lower() == desired or _site_name(site).lower() == desired:
                return _site_id(site)
        raise UniFiError("Requested UniFi site was not found.")

    async def resolve_site(self, requested: str) -> dict[str, Any]:
        desired = str(requested or "").strip().lower()
        if not desired:
            raise UniFiError("UniFi site must be explicit for this operation.")
        for site in await self.list_sites():
            if _site_id(site).lower() == desired or _site_name(site).lower() == desired:
                return site
        raise UniFiError("Requested UniFi site was not found.")

    async def list_clients(self, site_id: str, mac: str | None = None) -> list[dict[str, Any]]:
        payload: dict | list | None = None
        params = {}
        if mac:
            params["filter"] = f"macAddress.eq('{mac}')"
            payload = await self._request("GET", f"/sites/{site_id}/clients", params=params)
        else:
            key = ("GET", f"/sites/{site_id}/clients")
            payload = self._cached(key)
            if payload is None:
                payload = self._remember(key, await self._request("GET", f"/sites/{site_id}/clients", params=params))
        if payload is None:
            raise UniFiError("UniFi returned no client payload.")
        rows = payload if isinstance(payload, list) else payload.get("data", [])
        if mac:
            wanted = _mac(mac)
            return [row for row in rows if _client_mac(row) == wanted]
        return rows

    async def get_client_by_mac(self, site_id: str, mac: str) -> UniFiClientRecord:
        clients = await self.list_clients(site_id, mac)
        for client in clients:
            if _client_mac(client) == _mac(mac):
                record = _record(site_id, client)
                if not record.id:
                    raise UniFiError("Client found in UniFi without client id.")
                return record
        raise UniFiError("Client not found in UniFi site.")

    async def resolve_client_context(self, *, client_mac: str, ap_mac: str | None = None, requested_site: str | None = None) -> UniFiClientContext:
        sites = await self.list_sites()
        if not sites:
            raise UniFiError("UniFi returned no sites.")

        if requested_site:
            site = await self.resolve_site(requested_site)
            site_id = _site_id(site)
            client = await self.get_client_by_mac(site_id, client_mac)
            return UniFiClientContext(site_id=site_id, site_name=_site_name(site), client_id=client.id, client=client)

        matches: list[UniFiClientContext] = []
        for site in sites:
            site_id = _site_id(site)
            if not site_id:
                continue
            for row in await self.list_clients(site_id, client_mac):
                if _client_mac(row) != _mac(client_mac):
                    continue
                client = _record(site_id, row)
                if not client.id:
                    continue
                matches.append(UniFiClientContext(site_id=site_id, site_name=_site_name(site), client_id=client.id, client=client))

        if not matches:
            raise UniFiError("Client not found in any UniFi site.")
        if len(matches) == 1:
            return matches[0]

        desired_ap = _mac(ap_mac)
        if desired_ap:
            ap_matches = [match for match in matches if match.client.ap_mac == desired_ap]
            if len(ap_matches) == 1:
                return ap_matches[0]

        raise UniFiError("Client site is ambiguous in UniFi.")

    async def authorize_guest(
        self,
        *,
        site_id: str,
        client_id: str,
        minutes: int,
        rx_kbps: int | None = None,
        tx_kbps: int | None = None,
        data_limit_mb: int | None = None,
    ) -> dict:
        body: dict = {"action": "AUTHORIZE_GUEST_ACCESS", "timeLimitMinutes": minutes}
        if data_limit_mb is not None:
            body["dataUsageLimitMBytes"] = data_limit_mb
        if rx_kbps is not None:
            body["rxRateLimitKbps"] = rx_kbps
        if tx_kbps is not None:
            body["txRateLimitKbps"] = tx_kbps
        payload = await self._request("POST", f"/sites/{site_id}/clients/{client_id}/actions", json=body)
        self._clear_cache(site_id)
        return payload if isinstance(payload, dict) else {"data": payload}

    async def unauthorize_guest(self, *, site_id: str, client_id: str) -> dict:
        payload = await self._request(
            "POST",
            f"/sites/{site_id}/clients/{client_id}/actions",
            json={"action": "UNAUTHORIZE_GUEST_ACCESS"},
        )
        self._clear_cache(site_id)
        return payload if isinstance(payload, dict) else {"data": payload}

    async def list_devices(self, site_id: str) -> list[dict[str, Any]]:
        key = ("GET", f"/sites/{site_id}/devices")
        payload = self._cached(key)
        if payload is None:
            payload = self._remember(key, await self._request("GET", f"/sites/{site_id}/devices"))
        if payload is None:
            raise UniFiError("UniFi returned no device payload.")
        return payload if isinstance(payload, list) else payload.get("data", [])

    async def list_access_points(self, site_id: str) -> list[dict[str, Any]]:
        return [row for row in await self.list_devices(site_id) if is_access_point(row)]


unifi_client = UniFiClient()
