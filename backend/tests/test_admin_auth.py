def test_admin_login_cookie_session(client, admin_user):
    response = client.post("/api/admin/login", json={"email": "admin@example.com", "password": "StrongPassword123!"})
    assert response.status_code == 200
    assert "portal_admin_session" in response.headers.get("set-cookie", "")
    assert response.json()["role"] == "SUPERADMIN"
    assert client.get("/api/admin/me").status_code == 200


def test_admin_requires_auth(client):
    assert client.get("/api/admin/me").status_code == 401


def csrf_cookie(client) -> str:
    return client.cookies.get("portal_csrf") or ""


def test_admin_logout_requires_valid_origin(client, admin_user):
    login = client.post("/api/admin/login", json={"email": "admin@example.com", "password": "StrongPassword123!"})
    assert login.status_code == 200
    response = client.post(
        "/api/admin/logout",
        headers={"X-CSRF-Token": csrf_cookie(client), "Origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_admin_logout_accepts_valid_csrf_without_cross_origin(client, admin_user):
    login = client.post("/api/admin/login", json={"email": "admin@example.com", "password": "StrongPassword123!"})
    assert login.status_code == 200
    response = client.post("/api/admin/logout", headers={"X-CSRF-Token": csrf_cookie(client)})
    assert response.status_code == 200


def test_admin_responses_are_not_cacheable(client, admin_user):
    login = client.post("/api/admin/login", json={"email": "admin@example.com", "password": "StrongPassword123!"})
    assert login.status_code == 200
    response = client.get("/api/admin/me")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["x-frame-options"] == "DENY"

def test_admin_login_requires_email_code_when_mfa_enabled(client, admin_user, monkeypatch):
    from app.api import admin as admin_api
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "admin_email_mfa_required", True)
    monkeypatch.setattr(admin_api, "_six_digit_code", lambda: "123456")
    sent = []
    monkeypatch.setattr(admin_api, "send_email", lambda to, subject, text, html_body=None: sent.append((to, subject)))

    response = client.post("/api/admin/login", json={"email": "admin@example.com", "password": "StrongPassword123!"})

    assert response.status_code == 200
    assert response.json()["mfaRequired"] is True
    assert "portal_admin_session" not in response.headers.get("set-cookie", "")
    assert sent == [("admin@example.com", "Codigo de acesso ao painel")]
    assert client.get("/api/admin/me").status_code == 401

    verified = client.post("/api/admin/login/verify-code", json={"email": "admin@example.com", "password": "StrongPassword123!", "code": "123456"})
    assert verified.status_code == 200
    assert verified.json()["role"] == "SUPERADMIN"
    assert "portal_admin_session" in verified.headers.get("set-cookie", "")


def test_admin_password_reset_with_email_code(client, admin_user, monkeypatch):
    from app.api import admin as admin_api

    monkeypatch.setattr(admin_api, "_six_digit_code", lambda: "654321")
    sent = []
    monkeypatch.setattr(admin_api, "send_email", lambda to, subject, text, html_body=None: sent.append((to, subject)))

    requested = client.post("/api/admin/password/forgot", json={"email": "admin@example.com"})
    assert requested.status_code == 200
    assert sent == [("admin@example.com", "Recuperacao de senha do painel")]

    reset = client.post(
        "/api/admin/password/reset",
        json={"email": "admin@example.com", "code": "654321", "password": "AnotherStrongPassword123!", "confirmPassword": "AnotherStrongPassword123!"},
    )
    assert reset.status_code == 200

    old_login = client.post("/api/admin/login", json={"email": "admin@example.com", "password": "StrongPassword123!"})
    assert old_login.status_code == 401
    new_login = client.post("/api/admin/login", json={"email": "admin@example.com", "password": "AnotherStrongPassword123!"})
    assert new_login.status_code == 200
