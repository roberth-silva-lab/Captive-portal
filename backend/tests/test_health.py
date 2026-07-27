from fastapi.testclient import TestClient

from app.main import create_app


def test_live_health_and_security_headers():
    client = TestClient(create_app())
    res = client.get("/health/live")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.headers["x-content-type-options"] == "nosniff"
    assert "default-src" in res.headers["content-security-policy"]
