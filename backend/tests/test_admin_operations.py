from app.core.database import SessionLocal
from app.models import AdminInvitation, AdminRole, AdminUser, PortalNotification, Voucher


def login_admin(client) -> str:
    response = client.post("/api/admin/login", json={"email": "admin@example.com", "password": "StrongPassword123!"})
    assert response.status_code == 200
    return client.cookies.get("portal_csrf") or ""


def test_admin_creates_and_revokes_voucher_batch(client, admin_user):
    csrf = login_admin(client)
    response = client.post(
        "/api/admin/vouchers",
        headers={"X-CSRF-Token": csrf},
        json={"site": "Esdras", "description": "Evento", "quantity": 3, "durationMinutes": 60, "maxDevices": 2, "expiresAt": None},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["created"] == 3
    assert len(payload["vouchers"]) == 3
    assert all(item["code"].startswith("RF-") for item in payload["vouchers"])

    listing = client.get("/api/admin/vouchers")
    assert listing.status_code == 200
    assert listing.json()[0]["description"] == "Evento"
    assert listing.json()[0]["status"] == "Disponível"

    voucher_id = payload["vouchers"][0]["id"]
    revoked = client.post(f"/api/admin/vouchers/{voucher_id}/revoke", headers={"X-CSRF-Token": csrf})
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "Revogado"

    db = SessionLocal()
    voucher = db.get(Voucher, voucher_id)
    assert voucher is not None
    assert voucher.revoked_at is not None
    db.close()


def test_viewer_cannot_create_voucher(client):
    db = SessionLocal()
    viewer = AdminUser(email="viewer@example.com", name="Viewer", role=AdminRole.VIEWER, password_hash=admin_user_password_hash())
    db.add(viewer)
    db.commit()
    db.close()

    login = client.post("/api/admin/login", json={"email": "viewer@example.com", "password": "StrongPassword123!"})
    assert login.status_code == 200
    csrf = client.cookies.get("portal_csrf") or ""
    response = client.post("/api/admin/vouchers", headers={"X-CSRF-Token": csrf}, json={"site": "Esdras", "quantity": 1, "durationMinutes": 60})
    assert response.status_code == 403


def admin_user_password_hash():
    from app.security.passwords import hash_password

    return hash_password("StrongPassword123!")


def test_superadmin_invites_and_invited_admin_accepts(client, admin_user, monkeypatch):
    sent = []

    def fake_send(to_email, subject, text, html_body=None):
        sent.append((to_email, subject, text, html_body))

    monkeypatch.setattr("app.api.admin.send_email", fake_send)
    csrf = login_admin(client)
    response = client.post(
        "/api/admin/admins/invitations",
        headers={"X-CSRF-Token": csrf},
        json={"name": "Novo Admin", "email": "novo@example.com", "role": "ADMIN", "siteIds": ["Sede"]},
    )
    assert response.status_code == 200
    invite = response.json()
    assert invite["deliveryStatus"] == "sent"
    assert invite["inviteUrl"]
    assert sent and sent[0][0] == "novo@example.com"

    token = invite["inviteUrl"].split("token=", 1)[1]
    accepted = client.post(
        "/api/admin/admins/invitations/accept",
        json={"token": token, "password": "AnotherStrong123!", "confirmPassword": "AnotherStrong123!", "acceptedPolicy": True},
    )
    assert accepted.status_code == 200
    assert accepted.json()["email"] == "novo@example.com"
    assert accepted.json()["role"] == "ADMIN"

    db = SessionLocal()
    row = db.query(AdminInvitation).filter(AdminInvitation.email == "novo@example.com").first()
    assert row is not None
    assert row.accepted_at is not None
    db.close()


def test_admin_invite_requires_superadmin(client):
    db = SessionLocal()
    admin = AdminUser(email="limited@example.com", name="Limited", role=AdminRole.ADMIN, password_hash=admin_user_password_hash())
    db.add(admin)
    db.commit()
    db.close()

    login = client.post("/api/admin/login", json={"email": "limited@example.com", "password": "StrongPassword123!"})
    assert login.status_code == 200
    csrf = client.cookies.get("portal_csrf") or ""
    response = client.post("/api/admin/admins/invitations", headers={"X-CSRF-Token": csrf}, json={"name": "Pessoa", "email": "pessoa@example.com", "role": "VIEWER", "siteIds": ["Sede"]})
    assert response.status_code == 403

def test_admin_creates_updates_and_deletes_notification(client, admin_user):
    csrf = login_admin(client)
    created = client.post(
        "/api/admin/notifications",
        headers={"X-CSRF-Token": csrf},
        json={"type": "INFO", "title": "Aviso", "message": "Mensagem", "site": "ALL", "enabled": True},
    )
    assert created.status_code == 200
    notification_id = created.json()["id"]

    updated = client.put(
        f"/api/admin/notifications/{notification_id}",
        headers={"X-CSRF-Token": csrf},
        json={"type": "WARNING", "title": "Aviso atualizado", "message": "Mensagem nova", "site": "Sede", "enabled": False},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Aviso atualizado"
    assert updated.json()["enabled"] is False

    deleted = client.delete(f"/api/admin/notifications/{notification_id}", headers={"X-CSRF-Token": csrf})
    assert deleted.status_code == 200

    db = SessionLocal()
    row = db.get(PortalNotification, notification_id)
    assert row is None
    db.close()