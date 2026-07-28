import pytest

from app.integrations.unifi.client import UniFiClient, UniFiClientContext, UniFiClientRecord, UniFiError

SITES = [
    {"id": "site-default", "name": "Default"},
    {"id": "site-esdras", "name": "Esdras"},
]

CLIENTS = {
    "site-default": [],
    "site-esdras": [
        {
            "id": "client-esdras",
            "macAddress": "aa:bb:cc:dd:ee:ff",
            "access": {"authorized": False},
            "uplinkDevice": {"macAddress": "11:22:33:44:55:66"},
        }
    ],
}


def fake_unifi(clients=None):
    client = UniFiClient.__new__(UniFiClient)
    client.site_name = "Default"
    rows = clients or CLIENTS

    async def list_sites():
        return SITES

    async def list_clients(site_id, mac=None):
        data = rows.get(site_id, [])
        if mac:
            return [row for row in data if row.get("macAddress", "").lower() == mac.lower()]
        return data

    client.list_sites = list_sites
    client.list_clients = list_clients
    return client


@pytest.mark.asyncio
async def test_requested_site_valid_by_name():
    context = await UniFiClient.resolve_client_context(fake_unifi(), client_mac="aa:bb:cc:dd:ee:ff", requested_site="Esdras")
    assert context.site_id == "site-esdras"
    assert context.client_id == "client-esdras"


@pytest.mark.asyncio
async def test_requested_site_valid_by_uuid():
    context = await UniFiClient.resolve_client_context(fake_unifi(), client_mac="aa:bb:cc:dd:ee:ff", requested_site="site-esdras")
    assert context.site_name == "Esdras"


@pytest.mark.asyncio
async def test_requested_site_missing_raises_error():
    with pytest.raises(UniFiError):
        await UniFiClient.resolve_client_context(fake_unifi(), client_mac="aa:bb:cc:dd:ee:ff", requested_site="Inexistente")


@pytest.mark.asyncio
async def test_absent_site_finds_client_in_esdras():
    context = await UniFiClient.resolve_client_context(fake_unifi(), client_mac="aa:bb:cc:dd:ee:ff")
    assert context.site_id == "site-esdras"


@pytest.mark.asyncio
async def test_absent_client_raises_error():
    with pytest.raises(UniFiError):
        await UniFiClient.resolve_client_context(fake_unifi(), client_mac="00:00:00:00:00:00")


@pytest.mark.asyncio
async def test_ambiguous_client_uses_ap_mac():
    clients = {
        "site-default": [{"id": "client-default", "macAddress": "aa:bb:cc:dd:ee:ff", "uplinkDevice": {"macAddress": "aa:aa:aa:aa:aa:aa"}}],
        "site-esdras": [{"id": "client-esdras", "macAddress": "aa:bb:cc:dd:ee:ff", "uplinkDevice": {"macAddress": "11:22:33:44:55:66"}}],
    }
    context = await UniFiClient.resolve_client_context(fake_unifi(clients), client_mac="aa:bb:cc:dd:ee:ff", ap_mac="11:22:33:44:55:66")
    assert context.site_id == "site-esdras"


@pytest.mark.asyncio
async def test_ambiguous_client_without_matching_ap_raises_error():
    clients = {
        "site-default": [{"id": "client-default", "macAddress": "aa:bb:cc:dd:ee:ff"}],
        "site-esdras": [{"id": "client-esdras", "macAddress": "aa:bb:cc:dd:ee:ff"}],
    }
    with pytest.raises(UniFiError):
        await UniFiClient.resolve_client_context(fake_unifi(clients), client_mac="aa:bb:cc:dd:ee:ff")


@pytest.mark.asyncio
async def test_resolve_site_id_never_uses_first_site_as_fallback():
    with pytest.raises(UniFiError):
        await UniFiClient.resolve_site_id(fake_unifi(), None)
    with pytest.raises(UniFiError):
        await UniFiClient.resolve_site_id(fake_unifi(), "NaoExiste")


@pytest.mark.asyncio
async def test_public_authorize_unifi_returns_real_site_uuid(monkeypatch):
    from app.api import public

    context = UniFiClientContext(
        site_id="site-esdras",
        site_name="Esdras",
        client_id="client-esdras",
        client=UniFiClientRecord(id="client-esdras", mac="aa:bb:cc:dd:ee:ff", site_id="site-esdras", authorized=False),
    )

    class Payload:
        clientMac = "aa:bb:cc:dd:ee:ff"
        apMac = None
        site = None

    async def resolve_client_context(**kwargs):
        assert kwargs["requested_site"] is None
        return context

    async def authorize_guest(**kwargs):
        assert kwargs["site_id"] == "site-esdras"
        assert kwargs["client_id"] == "client-esdras"
        return {"ok": True}

    async def get_client_by_mac(site_id, mac):
        assert site_id == "site-esdras"
        return UniFiClientRecord(id="client-esdras", mac=mac, site_id=site_id, authorized=True)

    monkeypatch.setattr(public.unifi_client, "resolve_client_context", resolve_client_context)
    monkeypatch.setattr(public.unifi_client, "authorize_guest", authorize_guest)
    monkeypatch.setattr(public.unifi_client, "get_client_by_mac", get_client_by_mac)

    site_id, client_id = await public._authorize_unifi(Payload(), 60)
    assert site_id == "site-esdras"
    assert client_id == "client-esdras"


def test_frontend_does_not_default_site_to_default():
    from pathlib import Path

    source = Path("../frontend/src/main.tsx").read_text(encoding="utf-8")
    assert "site: params.get('site') ?? 'Default'" not in source
    assert "site: params.get('site') ?? ''," in source