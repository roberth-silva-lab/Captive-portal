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
