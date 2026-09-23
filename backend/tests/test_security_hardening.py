import pytest

from app.integrations.unifi.client import UniFiClientContext, UniFiClientRecord


def _login(client) -> str:
    response = client.post(
        "/api/admin/login",
        json={"email": "admin@example.com", "password": "StrongPassword123!"},
    )
    assert response.status_code == 200
    return client.cookies.get("portal_csrf") or ""


def _mock_public_unifi(monkeypatch):
    from app.api import public

    async def resolve_client_context(**kwargs):
        return UniFiClientContext(
            site_id="default",
            site_name="Esdras",
            client_id="client-1",
            client=UniFiClientRecord(
                id="client-1",
                mac=kwargs["client_mac"],
                site_id="default",
                authorized=False,
            ),
        )

    monkeypatch.setattr(public.unifi_client, "resolve_client_context", resolve_client_context)


def test_csrf_cookie_must_match_session_record(client, admin_user):
    _login(client)
    client.cookies.set("portal_csrf", "forged-csrf")

    response = client.post(
        "/api/admin/logout",
        headers={"X-CSRF-Token": "forged-csrf"},
    )

    assert response.status_code == 403


def test_password_reset_revokes_existing_admin_sessions(client, admin_user, monkeypatch):
    from app.api import admin as admin_api

    _login(client)
    assert client.get("/api/admin/me").status_code == 200

    monkeypatch.setattr(admin_api, "_six_digit_code", lambda: "654321")
    monkeypatch.setattr(admin_api, "send_email", lambda *args, **kwargs: None)

    requested = client.post("/api/admin/password/forgot", json={"email": "admin@example.com"})
    assert requested.status_code == 200

    reset = client.post(
        "/api/admin/password/reset",
        json={
            "email": "admin@example.com",
            "code": "654321",
            "password": "AnotherStrongPassword123!",
            "confirmPassword": "AnotherStrongPassword123!",
        },
    )
    assert reset.status_code == 200
    assert client.get("/api/admin/me").status_code == 401


@pytest.mark.asyncio
async def test_email_code_requests_are_limited_even_when_smtp_succeeds(client, monkeypatch):
    _mock_public_unifi(monkeypatch)
    monkeypatch.setattr("app.api.public.send_email", lambda *args, **kwargs: None)

    payload = {
        "clientMac": "aa:bb:cc:dd:ee:ff",
        "email": "visitante@example.com",
        "termsAccepted": True,
    }

    for _ in range(8):
        response = client.post("/api/auth/email/request-code", json=payload)
        assert response.status_code == 200

    blocked = client.post("/api/auth/email/request-code", json=payload)
    assert blocked.status_code == 429


def test_admin_users_maps_legacy_unifi_fields(client, admin_user, monkeypatch):
    from app.api import admin as admin_api

    class LegacyUniFi:
        async def list_sites(self):
            return [{"id": "default", "name": "Esdras"}]

        async def list_clients(self, site_id, mac=None):
            rows = [
                {
                    "_id": "client-legacy",
                    "mac": "92:1d:bb:73:7e:03",
                    "hostname": "Redmi-13C",
                    "ip": "192.168.5.208",
                    "ap_mac": "11:22:33:44:55:66",
                    "essid": "Visitantes-Esdras",
                    "authorized": True,
                    "signal": -51,
                }
            ]
            return rows

    monkeypatch.setattr(admin_api, "unifi_client", LegacyUniFi())
    _login(client)

    response = client.get("/api/admin/users?siteId=default")

    assert response.status_code == 200
    row = response.json()[0]
    assert row["name"] == "Redmi-13C"
    assert row["apMac"] == "11:22:33:44:55:66"
    assert row["ssid"] == "Visitantes-Esdras"
    assert row["authorized"] is True
    assert row["signal"] == -51
