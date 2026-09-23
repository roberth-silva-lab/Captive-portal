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


@pytest.mark.asyncio
async def test_public_session_status_requires_matching_session_id(client, monkeypatch):
    from app.core.database import SessionLocal
    from app.models import Voucher
    from app.security.tokens import secret_hash
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

    async def get_client_by_mac(site_id, mac):
        return UniFiClientRecord(id="client-1", mac=mac, site_id=site_id, authorized=True)

    async def authorize_guest(**kwargs):
        return {"meta": {"rc": "ok"}}

    monkeypatch.setattr(public.unifi_client, "resolve_client_context", resolve_client_context)
    monkeypatch.setattr(public.unifi_client, "get_client_by_mac", get_client_by_mac)
    monkeypatch.setattr(public.unifi_client, "authorize_guest", authorize_guest)

    db = SessionLocal()
    db.add(
        Voucher(
            code_hash=secret_hash("RFSECURE01"),
            code_label="RF-SECURE-01",
            duration_minutes=30,
            device_limit=1,
            site="Esdras",
            site_id="default",
            site_name_snapshot="Esdras",
        )
    )
    db.commit()
    db.close()

    authorized = client.post(
        "/api/auth/voucher",
        json={
            "clientMac": "aa:bb:cc:dd:ee:31",
            "code": "RFSECURE01",
            "termsAccepted": True,
        },
    )
    assert authorized.status_code == 200
    session_id = authorized.json()["sessionId"]

    missing = client.get("/api/session/status?clientMac=aa:bb:cc:dd:ee:31")
    assert missing.status_code == 422

    wrong = client.get(
        "/api/session/status?clientMac=aa:bb:cc:dd:ee:31&sessionId=gst_00000000000000000000000000000000"
    )
    assert wrong.status_code == 404

    valid = client.get(
        f"/api/session/status?clientMac=aa:bb:cc:dd:ee:31&sessionId={session_id}"
    )
    assert valid.status_code == 200
    assert valid.json()["authorized"] is True


@pytest.mark.asyncio
async def test_public_session_end_requires_matching_session_id(client, monkeypatch):
    from app.core.database import SessionLocal
    from app.models import AuthorizationMethod
    from app.services.sessions import authorize_session
    from app.api import public

    db = SessionLocal()
    session = authorize_session(
        db,
        client_mac="aa:bb:cc:dd:ee:32",
        site="default",
        method=AuthorizationMethod.VOUCHER,
        minutes=30,
        unifi_client_id="client-32",
    )
    session_id = session.id
    db.close()

    calls = []

    async def unauthorize_guest(**kwargs):
        calls.append(kwargs)
        return {"meta": {"rc": "ok"}}

    monkeypatch.setattr(public.unifi_client, "unauthorize_guest", unauthorize_guest)

    wrong = client.post(
        "/api/session/end",
        json={
            "clientMac": "aa:bb:cc:dd:ee:32",
            "sessionId": "gst_00000000000000000000000000000000",
        },
    )
    assert wrong.status_code == 404
    assert calls == []

    valid = client.post(
        "/api/session/end",
        json={"clientMac": "aa:bb:cc:dd:ee:32", "sessionId": session_id},
    )
    assert valid.status_code == 200
    assert calls == [{"site_id": "default", "client_id": "client-32"}]


def test_public_readiness_does_not_expose_database_or_migration_details(client):
    response = client.get(
        "/health/ready",
        headers={"host": "portal.gabineteitinerante.com.br"},
    )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_admin_access_points_maps_legacy_radio_fields(client, admin_user, monkeypatch):
    from app.api import admin as admin_api

    class LegacyUniFi:
        async def list_sites(self):
            return [{"id": "default", "name": "Esdras"}]

        async def list_clients(self, site_id, mac=None):
            return [
                {
                    "_id": "client-1",
                    "mac": "aa:bb:cc:dd:ee:41",
                    "ap_mac": "11:22:33:44:55:66",
                }
            ]

        async def list_access_points(self, site_id):
            return [
                {
                    "_id": "ap-1",
                    "name": "Esdras-Atendimento",
                    "model": "U6-Lite",
                    "mac": "11:22:33:44:55:66",
                    "ip": "192.168.5.10",
                    "state": 1,
                    "uptime": 12345,
                    "radio_table": [
                        {"radio": "ng", "channel": 6},
                        {"radio": "na", "channel": 44},
                    ],
                }
            ]

    monkeypatch.setattr(admin_api, "unifi_client", LegacyUniFi())
    _login(client)

    response = client.get("/api/admin/access-points?siteId=default")

    assert response.status_code == 200
    row = response.json()[0]
    assert row["status"] == "connected"
    assert row["clientes"] == 1
    assert row["canal"] == "6 / 44"
    assert row["banda"] == "2.4 GHz / 5 GHz"
