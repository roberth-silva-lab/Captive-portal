import pytest

from app.integrations.unifi.client import UniFiClientContext, UniFiClientRecord
from app.models import Voucher
from app.security.tokens import secret_hash


@pytest.mark.asyncio
async def test_voucher_authorization_with_mocked_unifi(client, monkeypatch):
    from app.api import public
    from app.core.database import SessionLocal

    async def resolve_client_context(**kwargs):
        return UniFiClientContext(
            site_id="site-esdras",
            site_name="Esdras",
            client_id="client-1",
            client=UniFiClientRecord(id="client-1", mac=kwargs["client_mac"], site_id="site-esdras", authorized=False),
        )

    async def client_by_mac(site_id, mac):
        return UniFiClientRecord(id="client-1", mac=mac, site_id=site_id, authorized=True)

    async def authorize_guest(**kwargs):
        return {"action": "AUTHORIZE_GUEST_ACCESS"}

    monkeypatch.setattr(public.unifi_client, "resolve_client_context", resolve_client_context)
    monkeypatch.setattr(public.unifi_client, "get_client_by_mac", client_by_mac)
    monkeypatch.setattr(public.unifi_client, "authorize_guest", authorize_guest)

    db = SessionLocal()
    db.add(Voucher(code_hash=secret_hash("ABC123"), code_label="ABC***", duration_minutes=30, device_limit=1, site="Esdras", site_id="site-esdras", site_name_snapshot="Esdras"))
    db.commit()
    db.close()

    response = client.post("/api/auth/voucher", json={"clientMac": "AA:BB:CC:DD:EE:FF", "code": "ABC123", "termsAccepted": True})
    assert response.status_code == 200
    assert response.json()["remainingSeconds"] > 0

    db = SessionLocal()
    session = db.query(public.GuestSession).one()
    assert session.site == "site-esdras"
    assert session.unifi_client_id == "client-1"
    db.close()



def test_cpf_auth_rejects_invalid_cpf_before_unifi(client):
    response = client.post(
        "/api/auth/cpf",
        json={
            "clientMac": "AA:BB:CC:DD:EE:FF",
            "name": "Visitante Teste",
            "cpf": "111.111.111-11",
            "termsAccepted": True,
        },
    )
    assert response.status_code == 422
    assert "111.111.111-11" not in response.text


def test_request_email_code_invalidates_previous_codes(client, monkeypatch):
    from app.core.database import SessionLocal
    from app.models import EmailLoginCode

    sent: list[str] = []
    monkeypatch.setattr("app.api.public.send_email", lambda to_email, subject, text, html_body=None: sent.append(to_email))

    payload = {"clientMac": "AA:BB:CC:DD:EE:FF", "email": "visitante@example.com", "termsAccepted": True}
    first = client.post("/api/auth/email/request-code", json=payload)
    second = client.post("/api/auth/email/request-code", json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert sent == ["visitante@example.com", "visitante@example.com"]

    db = SessionLocal()
    rows = db.query(EmailLoginCode).all()
    db.close()
    assert len(rows) == 2
    assert sum(row.consumed_at is None for row in rows) == 1


def test_request_email_code_returns_503_when_smtp_fails_without_storing_code(client, monkeypatch):
    from app.core.database import SessionLocal
    from app.integrations.email import EmailDeliveryError
    from app.models import EmailLoginCode

    def fail_send(*args, **kwargs):
        raise EmailDeliveryError("smtp failed")

    monkeypatch.setattr("app.api.public.send_email", fail_send)

    response = client.post(
        "/api/auth/email/request-code",
        json={"clientMac": "AA:BB:CC:DD:EE:FF", "email": "visitante@example.com", "termsAccepted": True},
    )

    assert response.status_code == 503
    assert "visitante@example.com" not in response.text

    db = SessionLocal()
    rows = db.query(EmailLoginCode).all()
    db.close()
    assert rows == []
