from app.core.database import SessionLocal
from app.integrations.unifi.client import UniFiClientContext, UniFiClientRecord
from app.models import AdminRole, AdminSiteAccess, AdminUser, MaintenanceConfig, NotificationType, PortalNotification, Voucher
from app.security.passwords import hash_password
from app.security.tokens import secret_hash


def login(client, email="admin@example.com", password="StrongPassword123!") -> str:
    response = client.post("/api/admin/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return client.cookies.get("portal_csrf") or ""


def create_admin(email: str, role: AdminRole, sites: list[str]) -> None:
    db = SessionLocal()
    user = AdminUser(email=email, name=email.split("@")[0], role=role, password_hash=hash_password("StrongPassword123!"))
    db.add(user)
    db.flush()
    for site_id in sites:
        db.add(AdminSiteAccess(admin_id=user.id, site_id=site_id, site_name_snapshot=site_id, granted_by="test"))
    db.commit()
    db.close()


class FakeUniFi:
    async def list_sites(self):
        return [{"id": "Sede", "name": "Sede"}, {"id": "Esdras", "name": "Esdras"}]

    async def list_clients(self, site_id, mac=None):
        rows = {
            "Sede": [{"id": "client-sede", "macAddress": "aa:bb:cc:dd:ee:01", "access": {"authorized": True}}],
            "Esdras": [{"id": "client-esdras", "macAddress": "aa:bb:cc:dd:ee:02", "access": {"authorized": True}}],
        }.get(site_id, [])
        if mac:
            return [row for row in rows if row["macAddress"] == mac]
        return rows

    async def list_devices(self, site_id):
        return []

    async def list_access_points(self, site_id):
        return []


def test_superadmin_lists_all_allowed_sites(client, admin_user, monkeypatch):
    from app.api import admin as admin_api

    monkeypatch.setattr(admin_api, "unifi_client", FakeUniFi())
    login(client)

    response = client.get("/api/admin/sites/allowed")

    assert response.status_code == 200
    assert {row["siteId"] for row in response.json()} == {"Sede", "Esdras"}


def test_admin_sede_cannot_access_esdras_users(client, monkeypatch):
    from app.api import admin as admin_api

    create_admin("sede@example.com", AdminRole.ADMIN, ["Sede"])
    monkeypatch.setattr(admin_api, "unifi_client", FakeUniFi())
    login(client, "sede@example.com")

    allowed = client.get("/api/admin/users?siteId=Sede")
    denied = client.get("/api/admin/users?siteId=Esdras")

    assert allowed.status_code == 200
    assert [row["siteId"] for row in allowed.json()] == ["Sede"]
    assert denied.status_code == 403


def test_admin_sede_cannot_create_esdras_voucher(client):
    create_admin("sede@example.com", AdminRole.ADMIN, ["Sede"])
    csrf = login(client, "sede@example.com")

    response = client.post(
        "/api/admin/vouchers",
        headers={"X-CSRF-Token": csrf},
        json={"site": "Esdras", "siteId": "Esdras", "quantity": 1, "durationMinutes": 60},
    )

    assert response.status_code == 403


def test_invite_preserves_site_access_on_accept(client, admin_user, monkeypatch):
    sent = []

    def fake_send(to_email, subject, text, html_body=None):
        sent.append(to_email)

    monkeypatch.setattr("app.api.admin.send_email", fake_send)
    csrf = login(client)
    response = client.post(
        "/api/admin/admins/invitations",
        headers={"X-CSRF-Token": csrf},
        json={"name": "Pessoa Sede", "email": "pessoa-sede@example.com", "role": "ADMIN", "siteIds": ["Sede"]},
    )
    assert response.status_code == 200
    token = response.json()["inviteUrl"].split("token=", 1)[1]

    accepted = client.post(
        "/api/admin/admins/invitations/accept",
        json={"token": token, "password": "AnotherStrong123!", "confirmPassword": "AnotherStrong123!", "acceptedPolicy": True},
    )
    assert accepted.status_code == 200

    db = SessionLocal()
    admin = db.query(AdminUser).filter(AdminUser.email == "pessoa-sede@example.com").first()
    access = db.query(AdminSiteAccess).filter(AdminSiteAccess.admin_id == admin.id).all()
    assert [row.site_id for row in access] == ["Sede"]
    db.close()


def test_voucher_sede_is_rejected_when_unifi_resolves_esdras(client, monkeypatch):
    from app.api import public

    db = SessionLocal()
    db.add(Voucher(code_hash=secret_hash("RF-TEST-0001"), code_label="RF-TEST-0001", duration_minutes=60, site="Sede", site_id="Sede", site_name_snapshot="Sede", max_devices=1))
    db.commit()
    db.close()

    async def resolve_client_context(**kwargs):
        return UniFiClientContext(
            site_id="Esdras",
            site_name="Esdras",
            client_id="client-esdras",
            client=UniFiClientRecord(id="client-esdras", mac=kwargs["client_mac"], site_id="Esdras", authorized=False),
        )

    monkeypatch.setattr(public.unifi_client, "resolve_client_context", resolve_client_context)
    response = client.post(
        "/api/auth/voucher",
        json={"clientMac": "aa:bb:cc:dd:ee:ff", "apMac": "11:22:33:44:55:66", "ssid": "Guest", "code": "RF-TEST-0001", "termsAccepted": True},
    )

    assert response.status_code == 400
    assert "unidade" in response.json()["detail"]

def test_admin_sede_cannot_publish_esdras_notice(client):
    create_admin("sede@example.com", AdminRole.ADMIN, ["Sede"])
    csrf = login(client, "sede@example.com")

    response = client.post(
        "/api/admin/notifications",
        headers={"X-CSRF-Token": csrf},
        json={"type": "INFO", "title": "Aviso", "message": "Mensagem", "site": "Esdras", "enabled": True},
    )

    assert response.status_code == 403


def test_public_settings_returns_global_and_matching_site_notices(client, monkeypatch):
    from app.api import public

    db = SessionLocal()
    db.add(PortalNotification(type=NotificationType.INFO, title="Global", message="Todos", site="ALL", enabled=True))
    db.add(PortalNotification(type=NotificationType.WARNING, title="Sede", message="Somente Sede", site="Sede", enabled=True))
    db.add(PortalNotification(type=NotificationType.WARNING, title="Esdras", message="Somente Esdras", site="Esdras", enabled=True))
    db.commit()
    db.close()

    async def resolve_client_context(**kwargs):
        return UniFiClientContext(
            site_id="Sede",
            site_name="Sede",
            client_id="client-sede",
            client=UniFiClientRecord(id="client-sede", mac=kwargs["client_mac"], site_id="Sede", authorized=False),
        )

    monkeypatch.setattr(public.unifi_client, "resolve_client_context", resolve_client_context)
    response = client.get("/api/settings?site=Esdras&clientMac=aa:bb:cc:dd:ee:01")

    assert response.status_code == 200
    titles = {notice["title"] for notice in response.json()["notifications"]}
    assert titles == {"Global", "Sede"}


def test_site_maintenance_does_not_block_other_site_settings(client, monkeypatch):
    from app.api import public

    db = SessionLocal()
    db.add(MaintenanceConfig(id="Sede", enabled=True, title="Manutenção Sede", message="Sede indisponível"))
    db.commit()
    db.close()

    async def resolve_client_context(**kwargs):
        return UniFiClientContext(
            site_id="Esdras",
            site_name="Esdras",
            client_id="client-esdras",
            client=UniFiClientRecord(id="client-esdras", mac=kwargs["client_mac"], site_id="Esdras", authorized=False),
        )

    monkeypatch.setattr(public.unifi_client, "resolve_client_context", resolve_client_context)
    response = client.get("/api/settings?site=Sede&clientMac=aa:bb:cc:dd:ee:02")

    assert response.status_code == 200
    assert response.json()["maintenanceMode"] is False

def test_site_portal_appearance_override_uses_rbac(client):
    create_admin("sede@example.com", AdminRole.ADMIN, ["Sede"])
    csrf = login(client, "sede@example.com")

    denied = client.put(
        "/api/admin/portal-appearance/site/Esdras",
        headers={"X-CSRF-Token": csrf},
        json={
            "networkName": "Wi-Fi Esdras",
            "establishmentName": "Esdras",
            "logoUrl": "",
            "primaryColor": "#176b87",
            "bannerText": "Portal Esdras",
            "welcomeText": "Bem-vindo ao Esdras.",
            "successMessage": "Liberado.",
            "expiredMessage": "Autentique novamente.",
            "termsText": "Termos Esdras.",
            "siteName": "Esdras",
            "enabled": True,
        },
    )
    assert denied.status_code == 403

    allowed = client.put(
        "/api/admin/portal-appearance/site/Sede",
        headers={"X-CSRF-Token": csrf},
        json={
            "networkName": "Wi-Fi Sede",
            "establishmentName": "Sede Institucional",
            "logoUrl": "",
            "primaryColor": "#176b87",
            "bannerText": "Portal Sede",
            "welcomeText": "Bem-vindo à Sede.",
            "successMessage": "Acesso da Sede liberado.",
            "expiredMessage": "Autentique novamente na Sede.",
            "termsText": "Termos da Sede.",
            "siteName": "Sede",
            "enabled": True,
        },
    )
    assert allowed.status_code == 200
    body = allowed.json()
    assert body["siteId"] == "Sede"
    assert body["establishmentName"] == "Sede Institucional"
    assert body["hasOverride"] is True

    loaded = client.get("/api/admin/portal-appearance/site/Sede")
    assert loaded.status_code == 200
    assert loaded.json()["termsText"] == "Termos da Sede."

def test_site_portal_appearance_can_be_reset_to_global(client):
    create_admin("sede@example.com", AdminRole.ADMIN, ["Sede"])
    csrf = login(client, "sede@example.com")
    payload = {
        "networkName": "Wi-Fi Sede",
        "establishmentName": "Sede Institucional",
        "logoUrl": "",
        "primaryColor": "#176b87",
        "bannerText": "Portal Sede",
        "welcomeText": "Bem-vindo à Sede.",
        "successMessage": "Acesso da Sede liberado.",
        "expiredMessage": "Autentique novamente na Sede.",
        "termsText": "Termos da Sede.",
        "siteName": "Sede",
        "enabled": True,
    }
    created = client.put("/api/admin/portal-appearance/site/Sede", headers={"X-CSRF-Token": csrf}, json=payload)
    assert created.status_code == 200
    assert created.json()["hasOverride"] is True

    removed = client.delete("/api/admin/portal-appearance/site/Sede", headers={"X-CSRF-Token": csrf})
    assert removed.status_code == 200
    assert removed.json()["removed"] is True

    loaded = client.get("/api/admin/portal-appearance/site/Sede")
    assert loaded.status_code == 200
    assert loaded.json()["hasOverride"] is False
    assert loaded.json()["termsText"] != "Termos da Sede."