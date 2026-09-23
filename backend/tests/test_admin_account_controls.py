from app.core.database import SessionLocal
from app.models import AdminReactivationRequest, AdminRole, AdminUser
from app.security.passwords import hash_password


def login(client, email="admin@example.com", password="StrongPassword123!"):
    response = client.post("/api/admin/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return client.cookies.get("portal_csrf") or ""


def test_admin_is_suspended_after_five_bad_passwords(client, monkeypatch):
    monkeypatch.setattr("app.api.admin.send_email", lambda *args, **kwargs: None)

    db = SessionLocal()
    user = AdminUser(
        email="operator@example.com",
        name="Operator",
        role=AdminRole.ADMIN,
        password_hash=hash_password("StrongPassword123!"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    user_id = user.id
    db.close()

    for _ in range(4):
        response = client.post(
            "/api/admin/login",
            json={"email": "operator@example.com", "password": "WrongPassword123!"},
        )
        assert response.status_code == 401

    fifth = client.post(
        "/api/admin/login",
        json={"email": "operator@example.com", "password": "WrongPassword123!"},
    )
    assert fifth.status_code == 423
    assert "suspensa" in fifth.json()["detail"].lower()

    db = SessionLocal()
    row = db.get(AdminUser, user_id)
    assert row is not None
    assert row.is_active is False
    assert row.failed_login_attempts == 5
    assert row.locked_at is not None
    assert row.suspended_at is not None
    db.close()


def test_global_admin_is_throttled_but_not_suspended_after_five_bad_passwords(client, admin_user, monkeypatch):
    monkeypatch.setattr("app.api.admin.send_email", lambda *args, **kwargs: None)

    for _ in range(4):
        response = client.post(
            "/api/admin/login",
            json={"email": "admin@example.com", "password": "WrongPassword123!"},
        )
        assert response.status_code == 401

    fifth = client.post(
        "/api/admin/login",
        json={"email": "admin@example.com", "password": "WrongPassword123!"},
    )
    assert fifth.status_code == 429

    db = SessionLocal()
    row = db.get(AdminUser, admin_user.id)
    assert row is not None
    assert row.is_active is True
    assert row.failed_login_attempts == 5
    assert row.locked_at is not None
    assert row.suspended_at is None
    db.close()


def test_suspended_admin_can_request_review_without_account_disclosure(client, admin_user, monkeypatch):
    monkeypatch.setattr("app.api.admin.send_email", lambda *args, **kwargs: None)

    db = SessionLocal()
    row = db.get(AdminUser, admin_user.id)
    assert row is not None
    row.is_active = False
    row.suspended_reason = "Revisão de segurança"
    db.commit()
    db.close()

    response = client.post(
        "/api/admin/support/reactivation-request",
        json={"email": "admin@example.com", "message": "Preciso recuperar o acesso."},
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    db = SessionLocal()
    request_row = db.query(AdminReactivationRequest).one()
    assert request_row.admin_id == admin_user.id
    assert request_row.status == "PENDING"
    db.close()

    unknown = client.post(
        "/api/admin/support/reactivation-request",
        json={"email": "desconhecido@example.com", "message": "Teste"},
    )
    assert unknown.status_code == 200
    assert unknown.json()["ok"] is True


def test_superadmin_can_change_role_suspend_and_reactivate(client, admin_user, monkeypatch):
    monkeypatch.setattr("app.api.admin.send_email", lambda *args, **kwargs: None)

    db = SessionLocal()
    target = AdminUser(
        email="operator@example.com",
        name="Operator",
        role=AdminRole.VIEWER,
        password_hash=hash_password("OperatorPassword123!"),
    )
    db.add(target)
    db.commit()
    db.refresh(target)
    target_id = target.id
    db.close()

    csrf = login(client)

    promoted = client.put(
        f"/api/admin/admins/{target_id}/role",
        headers={"X-CSRF-Token": csrf},
        json={"role": "ADMIN"},
    )
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "ADMIN"

    suspended = client.put(
        f"/api/admin/admins/{target_id}/status",
        headers={"X-CSRF-Token": csrf},
        json={"active": False, "reason": "Revisão de permissões"},
    )
    assert suspended.status_code == 200
    assert suspended.json()["status"] == "suspended"

    db = SessionLocal()
    target = db.get(AdminUser, target_id)
    assert target is not None
    assert target.role == AdminRole.ADMIN
    assert target.is_active is False
    assert target.suspended_reason == "Revisão de permissões"
    db.close()

    reactivated = client.put(
        f"/api/admin/admins/{target_id}/status",
        headers={"X-CSRF-Token": csrf},
        json={"active": True, "reason": "Acesso revisado"},
    )
    assert reactivated.status_code == 200

    db = SessionLocal()
    target = db.get(AdminUser, target_id)
    assert target is not None
    assert target.is_active is True
    assert target.failed_login_attempts == 0
    assert target.suspended_at is None
    db.close()


def test_admin_list_reports_online_presence_and_last_login(client, admin_user):
    csrf = login(client)
    assert csrf

    response = client.get("/api/admin/admins")
    assert response.status_code == 200
    row = next(item for item in response.json() if item["id"] == admin_user.id)
    assert row["online"] is True
    assert row["lastLogin"] is not None
    assert row["lastSeenAt"] is not None


def test_superadmin_can_review_reactivation_request(client, admin_user, monkeypatch):
    monkeypatch.setattr("app.api.admin.send_email", lambda *args, **kwargs: None)

    db = SessionLocal()
    target = AdminUser(
        email="locked@example.com",
        name="Locked",
        role=AdminRole.ADMIN,
        password_hash=hash_password("LockedPassword123!"),
        is_active=False,
        suspended_reason="Falhas de senha",
    )
    db.add(target)
    db.flush()
    review = AdminReactivationRequest(admin_id=target.id, message="Solicito revisão")
    db.add(review)
    db.commit()
    target_id = target.id
    request_id = review.id
    db.close()

    csrf = login(client)
    pending = client.get("/api/admin/admins/reactivation-requests")
    assert pending.status_code == 200
    assert any(item["id"] == request_id for item in pending.json())

    approved = client.post(
        f"/api/admin/admins/reactivation-requests/{request_id}/review",
        headers={"X-CSRF-Token": csrf},
        json={"approved": True, "note": "Acesso conferido"},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "APPROVED"

    db = SessionLocal()
    target = db.get(AdminUser, target_id)
    request_row = db.get(AdminReactivationRequest, request_id)
    assert target is not None and target.is_active is True
    assert request_row is not None and request_row.status == "APPROVED"
    db.close()
