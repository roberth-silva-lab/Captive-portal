import pytest

from app.integrations.unifi.client import UniFiClient


def legacy_client() -> UniFiClient:
    client = UniFiClient.__new__(UniFiClient)
    client.auth_mode = "legacy"
    client.site_name = "default"
    client.site_label = "Esdras"
    client.cache_ttl_seconds = 0
    client._cache = {}
    return client


@pytest.mark.asyncio
async def test_legacy_list_sites_uses_site_slug_and_display_label():
    client = legacy_client()

    async def request(method, path, **kwargs):
        assert method == "GET"
        assert path == "/api/self/sites"
        return {"meta": {"rc": "ok"}, "data": [{"_id": "mongo-site-id", "name": "default", "desc": "Default"}]}

    client._legacy_request = request

    sites = await UniFiClient.list_sites(client)

    assert sites == [
        {
            "_id": "mongo-site-id",
            "name": "Esdras",
            "desc": "Default",
            "id": "default",
            "legacySiteId": "mongo-site-id",
        }
    ]


@pytest.mark.asyncio
async def test_legacy_client_record_reads_top_level_fields():
    client = legacy_client()

    async def request(method, path, **kwargs):
        assert path == "/api/s/default/stat/sta"
        return {
            "meta": {"rc": "ok"},
            "data": [
                {
                    "_id": "client-id",
                    "mac": "AA:BB:CC:DD:EE:FF",
                    "authorized": True,
                    "ap_mac": "11:22:33:44:55:66",
                    "essid": "Visitantes-Esdras",
                    "ip": "192.168.5.77",
                    "signal": -54,
                }
            ],
        }

    client._legacy_request = request

    record = await UniFiClient.get_client_by_mac(client, "default", "aa:bb:cc:dd:ee:ff")

    assert record.id == "client-id"
    assert record.authorized is True
    assert record.ap_mac == "11:22:33:44:55:66"
    assert record.ssid == "Visitantes-Esdras"
    assert record.ip == "192.168.5.77"


@pytest.mark.asyncio
async def test_legacy_authorize_guest_resolves_client_id_to_mac_and_maps_limits():
    client = legacy_client()
    calls = []

    async def request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        if path.endswith("/stat/sta"):
            return {
                "meta": {"rc": "ok"},
                "data": [{"_id": "client-id", "mac": "aa:bb:cc:dd:ee:ff", "authorized": False}],
            }
        if path.endswith("/cmd/stamgr"):
            return {"meta": {"rc": "ok"}, "data": []}
        raise AssertionError(path)

    client._legacy_request = request

    result = await UniFiClient.authorize_guest(
        client,
        site_id="default",
        client_id="client-id",
        minutes=60,
        rx_kbps=12000,
        tx_kbps=4000,
        data_limit_mb=500,
    )

    assert result["meta"]["rc"] == "ok"
    assert calls[-1] == (
        "POST",
        "/api/s/default/cmd/stamgr",
        {
            "json": {
                "cmd": "authorize-guest",
                "mac": "aa:bb:cc:dd:ee:ff",
                "minutes": 60,
                "up": 4000,
                "down": 12000,
                "bytes": 500,
            }
        },
    )


@pytest.mark.asyncio
async def test_legacy_unauthorize_guest_accepts_mac_directly():
    client = legacy_client()
    calls = []

    async def request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        return {"meta": {"rc": "ok"}, "data": []}

    client._legacy_request = request

    await UniFiClient.unauthorize_guest(
        client,
        site_id="default",
        client_id="aa:bb:cc:dd:ee:ff",
    )

    assert calls == [
        (
            "POST",
            "/api/s/default/cmd/stamgr",
            {"json": {"cmd": "unauthorize-guest", "mac": "aa:bb:cc:dd:ee:ff"}},
        )
    ]
