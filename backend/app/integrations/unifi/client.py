import logging
import re
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


def _looks_like_mac(value: str | None) -> bool:
    return bool(re.fullmatch(r"[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}", str(value or "").strip()))


def _site_id(site: dict[str, Any]) -> str:
    return str(site.get("id") or site.get("siteId") or site.get("_id") or "")


def _site_name(site: dict[str, Any]) -> str:
    return str(site.get("name") or site.get("displayName") or site.get("description") or site.get("desc") or _site_id(site))


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
        or client.get("ap_mac")
        or client.get("uplinkMac")
    )


def _record(site_id: str, client: dict[str, Any]) -> UniFiClientRecord:
    access = client.get("access") or {}
    wifi = client.get("wifiConnection") or {}
    if "authorized" in client:
        authorized = bool(client.get("authorized"))
    else:
        authorized = bool(access.get("authorized"))
    return UniFiClientRecord(
        id=_client_id(client),
        mac=_client_mac(client),
        site_id=site_id,
        authorized=authorized,
        ap_mac=_client_ap_mac(client),
        ssid=str(wifi.get("ssid") or client.get("ssid") or client.get("essid") or ""),
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
    """UniFi client supporting the official Integration API and classic controller API."""

    def __init__(self) -> None:
        settings = get_settings()
        self.auth_mode = settings.normalized_unifi_auth_mode
        self.base_url = settings.unifi_base_url.rstrip("/")
        self.prefix = "/" + settings.unifi_api_prefix.strip("/")
        self.site_name = settings.unifi_site
        self.site_label = settings.unifi_site_label.strip()
        self.username = settings.unifi_username
        self.password = settings.unifi_password
        self.cache_ttl_seconds = settings.unifi_cache_ttl_seconds
        self._cache: dict[tuple[str, str], tuple[float, dict | list]] = {}
        self._legacy_logged_in = False
        self._csrf_token = ""
        headers = {"Accept": "application/json"}
        if self.auth_mode == "integration":
            headers["X-API-Key"] = settings.unifi_api_key
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            verify=settings.unifi_verify_ssl,
            timeout=settings.unifi_timeout_seconds,
        )

    @property
    def is_legacy(self) -> bool:
        return getattr(self, "auth_mode", "integration") == "legacy"

    async def close(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _payload_ok(payload: dict | list) -> bool:
        if not isinstance(payload, dict):
            return True
        meta = payload.get("meta")
        return not isinstance(meta, dict) or str(meta.get("rc") or "ok").lower() == "ok"

    def _remember_csrf(self, response: httpx.Response) -> None:
        token = response.headers.get("x-csrf-token") or response.headers.get("x-updated-csrf-token")
        if token:
            self._csrf_token = token

    async def _legacy_login(self) -> None:
        response = await self._client.post(
            "/api/login",
            json={"username": self.username, "password": self.password},
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        self._remember_csrf(response)
        payload: dict | list = {}
        try:
            payload = response.json()
        except ValueError:
            pass
        if response.status_code >= 400 or not self._payload_ok(payload):
            raise UniFiError(f"UniFi legacy login failed with HTTP {response.status_code}", status_code=response.status_code)
        self._legacy_logged_in = True

    async def _legacy_request(self, method: str, path: str, **kwargs) -> dict | list:
        if not getattr(self, "_legacy_logged_in", False):
            await self._legacy_login()

        headers = dict(kwargs.pop("headers", {}) or {})
        if getattr(self, "_csrf_token", ""):
            headers.setdefault("X-CSRF-Token", self._csrf_token)
        if method.upper() in {"POST", "PUT", "PATCH"}:
            headers.setdefault("Content-Type", "application/json")

        response = await self._client.request(method, path, headers=headers, **kwargs)
        self._remember_csrf(response)
        if response.status_code in {401, 403}:
            self._legacy_logged_in = False
            await self._legacy_login()
            if self._csrf_token:
                headers["X-CSRF-Token"] = self._csrf_token
            response = await self._client.request(method, path, headers=headers, **kwargs)
            self._remember_csrf(response)

        if response.status_code >= 400:
            raise UniFiError(f"UniFi {method} {path} failed with HTTP {response.status_code}", status_code=response.status_code)
        try:
            payload = response.json()
        except ValueError as exc:
            raise UniFiError(f"UniFi {method} {path} returned invalid JSON.") from exc
        if not self._payload_ok(payload):
            raise UniFiError(f"UniFi {method} {path} returned an API error.")
        return payload

    async def _request(self, method: str, path: str, **kwargs) -> dict | list:
        if self.is_legacy:
            legacy_path = path if path.startswith("/api/") else f"/api/s/{self.site_name}{path}"
            return await self._legacy_request(method, legacy_path, **kwargs)
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
            path = key[1]
            if (
                path.startswith(f"/sites/{site_id}/")
                or path.startswith(f"/api/s/{site_id}/")
                or key == ("GET", "/sites")
                or key == ("GET", "/api/self/sites")
            ):
                self._cache.pop(key, None)

    @staticmethod
    def _rows(payload: dict | list) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
        data = payload.get("data", []) if isinstance(payload, dict) else []
        return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

    async def list_sites(self) -> list[dict[str, Any]]:
        if self.is_legacy:
            key = ("GET", "/api/self/sites")
            payload = self._cached(key)
            if payload is None:
                payload = self._remember(key, await self._legacy_request("GET", "/api/self/sites"))
            sites: list[dict[str, Any]] = []
            for row in self._rows(payload):
                slug = str(row.get("name") or self.site_name or "default")
                display = str(row.get("desc") or row.get("description") or row.get("displayName") or slug)
                if getattr(self, "site_label", "") and slug.lower() == str(self.site_name).lower():
                    display = self.site_label
                sites.append({**row, "id": slug, "name": display, "legacySiteId": str(row.get("_id") or "")})
            if not sites and self.site_name:
                sites.append({"id": self.site_name, "name": self.site_label or self.site_name})
            return sites

        key = ("GET", "/sites")
        payload = self._cached(key)
        if payload is None:
            payload = self._remember(key, await self._request("GET", "/sites"))
        return self._rows(payload)

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
        if self.is_legacy:
            path = f"/api/s/{site_id}/stat/sta"
            if mac:
                payload = await self._legacy_request("GET", path)
            else:
                key = ("GET", path)
                payload = self._cached(key)
                if payload is None:
                    payload = self._remember(key, await self._legacy_request("GET", path))
            rows = self._rows(payload)
            if mac:
                wanted = _mac(mac)
                return [row for row in rows if _client_mac(row) == wanted]
            return rows

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
        rows = self._rows(payload)
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

    async def _legacy_action_mac(self, site_id: str, client_id: str) -> str:
        if _looks_like_mac(client_id):
            return _mac(client_id)
        for row in await self.list_clients(site_id):
            if _client_id(row) == client_id:
                mac = _client_mac(row)
                if mac:
                    return mac
        raise UniFiError("UniFi client id could not be resolved to a MAC address.")

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
        if self.is_legacy:
            mac = await self._legacy_action_mac(site_id, client_id)
            body: dict[str, Any] = {"cmd": "authorize-guest", "mac": mac, "minutes": minutes}
            if tx_kbps is not None:
                body["up"] = tx_kbps
            if rx_kbps is not None:
                body["down"] = rx_kbps
            if data_limit_mb is not None:
                body["bytes"] = data_limit_mb
            payload = await self._legacy_request("POST", f"/api/s/{site_id}/cmd/stamgr", json=body)
            self._clear_cache(site_id)
            return payload if isinstance(payload, dict) else {"data": payload}

        body = {"action": "AUTHORIZE_GUEST_ACCESS", "timeLimitMinutes": minutes}
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
        if self.is_legacy:
            mac = await self._legacy_action_mac(site_id, client_id)
            payload = await self._legacy_request(
                "POST",
                f"/api/s/{site_id}/cmd/stamgr",
                json={"cmd": "unauthorize-guest", "mac": mac},
            )
            self._clear_cache(site_id)
            return payload if isinstance(payload, dict) else {"data": payload}

        payload = await self._request(
            "POST",
            f"/sites/{site_id}/clients/{client_id}/actions",
            json={"action": "UNAUTHORIZE_GUEST_ACCESS"},
        )
        self._clear_cache(site_id)
        return payload if isinstance(payload, dict) else {"data": payload}

    async def list_devices(self, site_id: str) -> list[dict[str, Any]]:
        if self.is_legacy:
            path = f"/api/s/{site_id}/stat/device"
            key = ("GET", path)
            payload = self._cached(key)
            if payload is None:
                payload = self._remember(key, await self._legacy_request("GET", path))
            return self._rows(payload)

        key = ("GET", f"/sites/{site_id}/devices")
        payload = self._cached(key)
        if payload is None:
            payload = self._remember(key, await self._request("GET", f"/sites/{site_id}/devices"))
        if payload is None:
            raise UniFiError("UniFi returned no device payload.")
        return self._rows(payload)

    async def list_access_points(self, site_id: str) -> list[dict[str, Any]]:
        return [row for row in await self.list_devices(site_id) if is_access_point(row)]


unifi_client = UniFiClient()
