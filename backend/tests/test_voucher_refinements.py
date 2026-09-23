import pytest

from app.core.database import SessionLocal
from app.integrations.email import EmailDeliveryError
from app.integrations.unifi.client import UniFiClientContext, UniFiClientRecord
from app.models import AdminRole, AdminSiteAccess, AdminUser, GuestSession, Voucher
from app.security.passwords import hash_password
from app.security.tokens import secret_hash


def login(client, email="admin@example.com", password="StrongPassword123!") -> str:
    response = client.post("/api/admin/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return client.cookies.get("portal_csrf") or ""


def test_create_unlimited_voucher_and_send_email(client, admin_user, monkeypatch):
    sent: list[tuple[str, str, str]] = []

    def fake_send(to_email, subject, text, html_body=None):
        sent.append((to_email, subject, text))

    monkeypatch.setattr("app.api.admin.send_email", fake_send)
    csrf = login(client)

    response = client.post(
        "/api/admin/vouchers",
        headers={"X-CSRF-Token": csrf},
        json={
            "description": "Visitante externo",
            "quantity": 1,
            "durationMinutes": 120,
            "unlimitedDuration": True,
            "maxDevices": 2,
            "deviceLimit": 2,
            "site": "ALL",
            "siteId": "ALL",
            "deliveryEmail": "visitante@example.com",
            "enabled": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["created"] == 1
    assert body["vouchers"][0]["unlimitedDuration"] is True
    assert body["emailDeliveryStatus"] == "sent"
    assert body["emailSentTo"] == "visitante@example.com"
    assert len(sent) == 1
    assert body["vouchers"][0]["code"] in sent[0][2]
    assert "Sem limite" in sent[0][2]
    assert "Dispositivos permitidos: 2" in sent[0][2]

    db = SessionLocal()
    voucher = db.query(Voucher).one()
    assert voucher.unlimited_duration is True
    db.close()


def test_voucher_email_failure_does_not_rollback_created_code(client, admin_user, monkeypatch):
    def fail_send(*args, **kwargs):
        raise EmailDeliveryError("SMTP indisponível", "smtp_network_error")

    monkeypatch.setattr("app.api.admin.send_email", fail_send)
    csrf = login(client)

    response = client.post(
        "/api/admin/vouchers",
        headers={"X-CSRF-Token": csrf},
        json={
            "description": "Teste de contingência",
            "quantity": 1,
            "durationMinutes": 60,
            "site": "ALL",
            "siteId": "ALL",
            "deliveryEmail": "visitante@example.com",
        },
    )

    assert response.status_code == 200
    assert response.json()["emailDeliveryStatus"] == "failed"

    db = SessionLocal()
    assert db.query(Voucher).count() == 1
    db.close()


@pytest.mark.asyncio
async def test_unlimited_voucher_creates_non_expiring_portal_session(client, monkeypatch):
    from app.api import public

    authorization_calls: list[dict] = []

    async def resolve_client_context(**kwargs):
        return UniFiClientContext(
            site_id="site-esdras",
            site_name="Esdras",
            client_id="client-unlimited",
            client=UniFiClientRecord(
                id="client-unlimited",
                mac=kwargs["client_mac"],
                site_id="site-esdras",
                authorized=False,
            ),
        )

    async def get_client_by_mac(site_id, mac):
        return UniFiClientRecord(
            id="client-unlimited",
            mac=mac,
            site_id=site_id,
            authorized=True,
        )

    async def authorize_guest(**kwargs):
        authorization_calls.append(kwargs)
        return {"meta": {"rc": "ok"}}

    monkeypatch.setattr(public.unifi_client, "resolve_client_context", resolve_client_context)
    monkeypatch.setattr(public.unifi_client, "get_client_by_mac", get_client_by_mac)
    monkeypatch.setattr(public.unifi_client, "authorize_guest", authorize_guest)

    db = SessionLocal()
    db.add(
        Voucher(
            code_hash=secret_hash("RFUNLIMITED"),
            code_label="RF-UNLIMITED",
            duration_minutes=120,
            unlimited_duration=True,
            device_limit=1,
            max_devices=1,
            site="Esdras",
            site_id="site-esdras",
            site_name_snapshot="Esdras",
        )
    )
    db.commit()
    db.close()

    response = client.post(
        "/api/auth/voucher",
        json={
            "clientMac": "AA:BB:CC:DD:EE:91",
            "code": "RFUNLIMITED",
            "termsAccepted": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["authorized"] is True
    assert body["unlimited"] is True
    assert body["expiresAt"] is None
    assert body["sessionMinutes"] is None
    assert body["remainingSeconds"] == 0
    assert authorization_calls[0]["minutes"] == public.UNLIMITED_UNIFI_ROLLING_MINUTES

    db = SessionLocal()
    session = db.query(GuestSession).one()
    assert session.unlimited_access is True
    assert session.expires_at is None
    session_id = session.id
    db.close()

    status = client.get(
        f"/api/session/status?clientMac=aa:bb:cc:dd:ee:91&sessionId={session_id}"
    )
    assert status.status_code == 200
    assert status.json()["authorized"] is True
    assert status.json()["unlimited"] is True
    assert status.json()["expiresAt"] is None


def test_viewer_cannot_open_security_admin_endpoints(client):
    db = SessionLocal()
    viewer = AdminUser(
        email="viewer@example.com",
        name="Viewer",
        role=AdminRole.VIEWER,
        password_hash=hash_password("StrongPassword123!"),
    )
    db.add(viewer)
    db.flush()
    db.add(
        AdminSiteAccess(
            admin_id=viewer.id,
            site_id="Esdras",
            site_name_snapshot="Esdras",
            granted_by="test",
        )
    )
    db.commit()
    db.close()

    login(client, "viewer@example.com")

    assert client.get("/api/admin/system-health").status_code == 403
    assert client.get("/api/admin/audit?siteId=Esdras").status_code == 403
    assert client.get("/api/admin/auth-attempts").status_code == 403
