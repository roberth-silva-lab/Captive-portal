def test_live_and_ready(client):
    assert client.get("/health/live").status_code == 200
    ready = client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json()["status"] == "ok"


def test_security_headers(client):
    response = client.get("/health/live")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "default-src" in response.headers["content-security-policy"]


def test_cors_not_wildcard(client):
    response = client.options("/api/settings", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert response.headers.get("access-control-allow-origin") != "*"
