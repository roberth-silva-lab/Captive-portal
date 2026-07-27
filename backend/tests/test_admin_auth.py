def test_admin_login_cookie_session(client, admin_user):
    response = client.post("/api/admin/login", json={"email": "admin@example.com", "password": "StrongPassword123!"})
    assert response.status_code == 200
    assert "portal_admin_session" in response.headers.get("set-cookie", "")
    assert response.json()["role"] == "SUPERADMIN"
    assert client.get("/api/admin/me").status_code == 200


def test_admin_requires_auth(client):
    assert client.get("/api/admin/me").status_code == 401
