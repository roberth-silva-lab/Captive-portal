from datetime import timedelta

from app.models import AuthorizationMethod, GuestSession, MaintenanceConfig, NotificationType, PortalNotification, SessionStatus
from app.models.entities import utcnow


def test_settings_returns_active_maintenance_and_notifications(client):
    from app.core.database import SessionLocal

    now = utcnow()
    db = SessionLocal()
    db.add(MaintenanceConfig(id="global", enabled=True, title="Janela de manutencao", message="Retornaremos em breve.", start_at=now - timedelta(minutes=1), end_at=now + timedelta(hours=1)))
    db.add(PortalNotification(type=NotificationType.WARNING, title="Aviso", message="Instabilidade prevista.", starts_at=now - timedelta(minutes=1), ends_at=now + timedelta(hours=1), site="ALL", enabled=True))
    db.commit()
    db.close()

    response = client.get("/api/settings?site=Default")
    assert response.status_code == 200
    body = response.json()
    assert body["maintenanceMode"] is True
    assert body["maintenance"]["active"] is True
    assert body["notifications"][0]["title"] == "Aviso"


def test_dashboard_includes_experience_metrics(client, admin_user):
    from app.core.database import SessionLocal

    now = utcnow()
    db = SessionLocal()
    db.add(GuestSession(client_mac="aa:bb:cc:dd:ee:ff", authorization_method=AuthorizationMethod.VOUCHER, status=SessionStatus.AUTHORIZED, authorized_at=now - timedelta(minutes=10), expires_at=now + timedelta(minutes=9), duration_seconds=600))
    db.commit()
    db.close()

    client.post("/api/admin/login", json={"email": "admin@example.com", "password": "StrongPassword123!"})
    response = client.get("/api/admin/dashboard")
    assert response.status_code == 200
    body = response.json()
    assert body["onlineUsers"] == 1
    assert body["expiringIn10Minutes"] == 1
    assert "activeNotifications" in body