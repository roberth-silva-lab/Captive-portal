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

def create_invite_and_token(client, monkeypatch, *, email="convite@example.com", site_ids=None):
    monkeypatch.setattr("app.api.admin.send_email", lambda *args, **kwargs: None)
    csrf = login_admin(client)
    response = client.post(
        "/api/admin/admins/invitations",
        headers={"X-CSRF-Token": csrf},
        json={"name": "Pessoa Convidada", "email": email, "role": "ADMIN", "siteIds": site_ids or ["Sede"]},
    )
    assert response.status_code == 200
    invite = response.json()
    token = invite["inviteUrl"].split("token=", 1)[1]
    return invite, token


def test_validate_admin_invitation_returns_safe_invite_summary(client, admin_user, monkeypatch):
    _, token = create_invite_and_token(client, monkeypatch)

    response = client.get(f"/api/admin/admins/invitations/validate?token={token}")

    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "email": "convite@example.com",
        "name": "Pessoa Convidada",
        "role": "ADMIN",
        "expiresAt": payload["expiresAt"],
        "siteIds": ["Sede"],
    }
    assert token not in response.text


def test_validate_admin_invitation_rejects_missing_token(client, admin_user):
    response = client.get("/api/admin/admins/invitations/validate")

    assert response.status_code == 400


def test_accept_admin_invitation_accepts_snake_case_payload(client, admin_user, monkeypatch):
    _, token = create_invite_and_token(client, monkeypatch, email="snake@example.com")

    response = client.post(
        "/api/admin/admins/invitations/accept",
        json={"token": token, "password": "AnotherStrong123!", "confirm_password": "AnotherStrong123!", "accepted_policy": True},
    )

    assert response.status_code == 200
    assert response.json()["email"] == "snake@example.com"


def test_accept_admin_invitation_password_confirmation_mismatch_is_422(client, admin_user, monkeypatch):
    _, token = create_invite_and_token(client, monkeypatch, email="mismatch@example.com")

    response = client.post(
        "/api/admin/admins/invitations/accept",
        json={"token": token, "password": "AnotherStrong123!", "confirmPassword": "DifferentStrong123!", "acceptedPolicy": True},
    )

    assert response.status_code == 422
    assert token not in response.text


def test_accept_admin_invitation_used_token_returns_409(client, admin_user, monkeypatch):
    _, token = create_invite_and_token(client, monkeypatch, email="used@example.com")
    first = client.post(
        "/api/admin/admins/invitations/accept",
        json={"token": token, "password": "AnotherStrong123!", "confirmPassword": "AnotherStrong123!", "acceptedPolicy": True},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/admin/admins/invitations/accept",
        json={"token": token, "password": "AnotherStrong123!", "confirmPassword": "AnotherStrong123!", "acceptedPolicy": True},
    )

    assert second.status_code == 409


def test_superadmin_revokes_admin_invitation(client, admin_user, monkeypatch):
    invite, token = create_invite_and_token(client, monkeypatch, email="revogar@example.com")
    csrf = client.cookies.get("portal_csrf") or ""

    revoked = client.post(f"/api/admin/admins/invitations/{invite['id']}/revoke", headers={"X-CSRF-Token": csrf})

    assert revoked.status_code == 200
    assert revoked.json()["deliveryStatus"] == "REVOKED"
    rejected = client.get(f"/api/admin/admins/invitations/validate?token={token}")
    assert rejected.status_code == 410


def test_superadmin_renews_admin_invitation_with_new_token(client, admin_user, monkeypatch):
    sent = []
    monkeypatch.setattr("app.api.admin.send_email", lambda to_email, subject, text, html_body=None: sent.append((to_email, subject, text, html_body)))
    csrf = login_admin(client)
    created = client.post(
        "/api/admin/admins/invitations",
        headers={"X-CSRF-Token": csrf},
        json={"name": "Pessoa Link", "email": "link@example.com", "role": "ADMIN", "siteIds": ["Sede"]},
    )
    assert created.status_code == 200
    first = created.json()
    old_token = first["inviteUrl"].split("token=", 1)[1]

    renewed = client.post(f"/api/admin/admins/invitations/{first['id']}/renew", headers={"X-CSRF-Token": csrf})

    assert renewed.status_code == 200
    payload = renewed.json()
    assert payload["inviteUrl"]
    new_token = payload["inviteUrl"].split("token=", 1)[1]
    assert new_token != old_token
    assert sent

    old_validation = client.get(f"/api/admin/admins/invitations/validate?token={old_token}")
    assert old_validation.status_code == 404
    accepted = client.post(
        "/api/admin/admins/invitations/accept",
        json={"token": new_token, "password": "AnotherStrong123!", "confirmPassword": "AnotherStrong123!", "acceptedPolicy": True},
    )
    assert accepted.status_code == 200
    assert accepted.json()["email"] == "link@example.com"
