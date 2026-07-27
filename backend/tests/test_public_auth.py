import pytest

from app.integrations.unifi.client import UniFiClientRecord
from app.models import Voucher
from app.security.tokens import secret_hash


@pytest.mark.asyncio
async def test_voucher_authorization_with_mocked_unifi(client, monkeypatch):
    from app.api import public
    from app.core.database import SessionLocal

    async def site(_site=None):
        return "site-default"

    async def client_by_mac(site_id, mac):
        return UniFiClientRecord(id="client-1", mac=mac, site_id=site_id, authorized=True)

    async def authorize_guest(**kwargs):
        return {"action": "AUTHORIZE_GUEST_ACCESS"}

    monkeypatch.setattr(public.unifi_client, "resolve_site_id", site)
    monkeypatch.setattr(public.unifi_client, "get_client_by_mac", client_by_mac)
    monkeypatch.setattr(public.unifi_client, "authorize_guest", authorize_guest)

    db = SessionLocal()
    db.add(Voucher(code_hash=secret_hash("ABC123"), code_label="ABC***", duration_minutes=30, device_limit=1))
    db.commit()
    db.close()

    response = client.post("/api/auth/voucher", json={"clientMac": "AA:BB:CC:DD:EE:FF", "code": "ABC123", "termsAccepted": True})
    assert response.status_code == 200
    assert response.json()["remainingSeconds"] > 0
