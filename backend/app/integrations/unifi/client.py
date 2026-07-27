import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class UniFiError(Exception):
    pass


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


class UniFiClient:
    """Official UniFi Network Integration API client.

    Based on Ubiquiti documentation for:
    - GET /v1/sites
    - GET /v1/sites/{siteId}/clients
    - POST /v1/sites/{siteId}/clients/{clientId}/actions
    """

    def __init__(self) -> None:
        settings = get_settings()
        self.base_url = settings.unifi_base_url.rstrip("/")
        self.prefix = "/" + settings.unifi_api_prefix.strip("/")
        self.site_name = settings.unifi_site
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
            raise UniFiError(f"UniFi {method} {path} failed with HTTP {response.status_code}")
        return response.json()

    async def list_sites(self) -> list[dict]:
        payload = await self._request("GET", "/sites")
        if isinstance(payload, list):
            return payload
        return payload.get("data", []) if isinstance(payload, dict) else []

    async def resolve_site_id(self, requested: str | None = None) -> str:
        desired = (requested or self.site_name or "").lower()
        sites = await self.list_sites()
        if not sites:
            raise UniFiError("UniFi returned no sites.")
        for site in sites:
            if str(site.get("id", "")).lower() == desired or str(site.get("name", "")).lower() == desired:
                return str(site["id"])
        return str(sites[0]["id"])

    async def list_clients(self, site_id: str, mac: str | None = None) -> list[dict]:
        params = {}
        if mac:
            params["filter"] = f"macAddress.eq('{mac}')"
        payload = await self._request("GET", f"/sites/{site_id}/clients", params=params)
        if isinstance(payload, list):
            return payload
        return payload.get("data", []) if isinstance(payload, dict) else []

    async def get_client_by_mac(self, site_id: str, mac: str) -> UniFiClientRecord:
        clients = await self.list_clients(site_id, mac)
        for client in clients:
            mac_value = str(client.get("macAddress") or client.get("mac") or "").lower()
            if mac_value == mac.lower():
                access = client.get("access") or {}
                uplink = client.get("uplinkDevice") or {}
                wifi = client.get("wifiConnection") or {}
                return UniFiClientRecord(
                    id=str(client.get("id") or client.get("_id") or ""),
                    mac=mac_value,
                    site_id=site_id,
                    authorized=bool(access.get("authorized")),
                    ap_mac=str(uplink.get("macAddress") or client.get("apMac") or ""),
                    ssid=str(wifi.get("ssid") or client.get("ssid") or ""),
                    ip=str(client.get("ipAddress") or client.get("ip") or ""),
                    signal=client.get("signal"),
                )
        raise UniFiError("Client not found in UniFi site.")

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
        return payload if isinstance(payload, dict) else {"data": payload}

    async def unauthorize_guest(self, *, site_id: str, client_id: str) -> dict:
        payload = await self._request(
            "POST",
            f"/sites/{site_id}/clients/{client_id}/actions",
            json={"action": "UNAUTHORIZE_GUEST_ACCESS"},
        )
        return payload if isinstance(payload, dict) else {"data": payload}

    async def list_access_points(self, site_id: str) -> list[dict]:
        payload = await self._request("GET", f"/sites/{site_id}/devices")
        rows = payload if isinstance(payload, list) else payload.get("data", [])
        return [row for row in rows if str(row.get("type", "")).upper() in {"UAP", "ACCESS_POINT", "AP"}]


unifi_client = UniFiClient()
