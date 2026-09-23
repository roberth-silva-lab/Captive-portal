from datetime import timedelta

import pytest

from app.integrations.unifi import UniFiClientRecord, UniFiError
from app.models import AuditLog, AuthorizationMethod, GuestSession, SessionStatus
from app.models.entities import utcnow
from app.services.session_expirer import (
    UNLIMITED_UNIFI_GRANT_MINUTES,
    expire_due_sessions_with_unifi,
    refresh_unlimited_sessions_with_unifi,
)


class FakeUnauthorizer:
    def __init__(self, clients=None, unauthorize_errors=None):
        self.clients = list(clients or [])
        self.unauthorize_errors = list(unauthorize_errors or [])
        self.calls = []
        self.authorize_calls = []
        self.lookups = []

    async def get_current_client(self, *, site_id: str, client_mac: str):
        self.lookups.append((site_id, client_mac))
        if not self.clients:
            raise UniFiError("Client not found in UniFi site.", status_code=404)
        item = self.clients.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    async def unauthorize_guest(self, *, site_id: str, client_id: str):
        self.calls.append((site_id, client_id))
        if self.unauthorize_errors:
            raise self.unauthorize_errors.pop(0)
        return {"ok": True}

    async def authorize_guest(self, *, site_id: str, client_id: str, minutes: int):
        self.authorize_calls.append((site_id, client_id, minutes))
        return {"ok": True}


def client_record(client_id="client-1", authorized=True, mac="aa:bb:cc:dd:ee:ff", site_id="site-esdras"):
    return UniFiClientRecord(id=client_id, mac=mac, site_id=site_id, authorized=authorized)


def create_due_session(db, *, client_id="client-1", site="site-esdras"):
    now = utcnow()
    session = GuestSession(
        client_mac="aa:bb:cc:dd:ee:ff",
        site=site,
        unifi_client_id=client_id,
        authorization_method=AuthorizationMethod.EMAIL,
        status=SessionStatus.AUTHORIZED,
        authorized_at=now - timedelta(hours=2),
        expires_at=now - timedelta(minutes=1),
    )
    db.add(session)
    db.commit()
    return session


@pytest.mark.asyncio
async def test_expire_due_session_calls_unifi_with_current_client_id_and_marks_expired():
    from app.core.database import SessionLocal

    db = SessionLocal()
    session = create_due_session(db, client_id="client-1")
    fake = FakeUnauthorizer(clients=[client_record("client-1", True), client_record("client-1", False)])

    result = await expire_due_sessions_with_unifi(db, fake)
    db.refresh(session)

    assert result.expired == 1
    assert fake.calls == [("site-esdras", "client-1")]
    assert session.status == SessionStatus.EXPIRED
    assert db.query(AuditLog).filter(AuditLog.event == "session.expired").count() == 1
    db.close()


@pytest.mark.asyncio
async def test_expire_due_session_refreshes_stale_client_id_by_mac():
    from app.core.database import SessionLocal

    db = SessionLocal()
    session = create_due_session(db, client_id="old-client")
    fake = FakeUnauthorizer(clients=[client_record("current-client", True), client_record("current-client", False)])

    result = await expire_due_sessions_with_unifi(db, fake)
    db.refresh(session)

    assert result.expired == 1
    assert fake.calls == [("site-esdras", "current-client")]
    assert session.unifi_client_id == "current-client"
    assert session.status == SessionStatus.EXPIRED
    assert db.query(AuditLog).filter(AuditLog.event == "session.unifi_client_id_refreshed").count() == 1
    db.close()


@pytest.mark.asyncio
async def test_expire_due_session_marks_expired_when_client_is_not_connected():
    from app.core.database import SessionLocal

    db = SessionLocal()
    session = create_due_session(db)
    fake = FakeUnauthorizer(clients=[UniFiError("Client not found in UniFi site.", status_code=404)])

    result = await expire_due_sessions_with_unifi(db, fake)
    db.refresh(session)

    assert result.expired == 1
    assert fake.calls == []
    assert session.status == SessionStatus.EXPIRED
    assert db.query(AuditLog).filter(AuditLog.event == "session.expired_client_not_found").count() == 1
    db.close()


@pytest.mark.asyncio
async def test_expire_due_session_marks_expired_when_client_already_unauthorized():
    from app.core.database import SessionLocal

    db = SessionLocal()
    session = create_due_session(db)
    fake = FakeUnauthorizer(clients=[client_record("client-1", False)])

    result = await expire_due_sessions_with_unifi(db, fake)
    db.refresh(session)

    assert result.expired == 1
    assert fake.calls == []
    assert session.status == SessionStatus.EXPIRED
    assert db.query(AuditLog).filter(AuditLog.event == "session.expired_already_unauthorized").count() == 1
    db.close()


@pytest.mark.asyncio
async def test_expire_due_session_does_not_mark_expired_when_unifi_unavailable():
    from app.core.database import SessionLocal

    db = SessionLocal()
    session = create_due_session(db)
    fake = FakeUnauthorizer(clients=[UniFiError("UniFi unavailable", status_code=503)])

    result = await expire_due_sessions_with_unifi(db, fake)
    db.refresh(session)

    assert result.expired == 0
    assert result.failed_unifi == 1
    assert session.status == SessionStatus.AUTHORIZED
    db.close()


@pytest.mark.asyncio
async def test_expire_due_session_handles_action_404_after_client_disappears():
    from app.core.database import SessionLocal

    db = SessionLocal()
    session = create_due_session(db, client_id="old-client")
    fake = FakeUnauthorizer(
        clients=[client_record("current-client", True), UniFiError("Client not found", status_code=404)],
        unauthorize_errors=[UniFiError("Action failed", status_code=404)],
    )

    result = await expire_due_sessions_with_unifi(db, fake)
    db.refresh(session)

    assert result.expired == 1
    assert fake.calls == [("site-esdras", "current-client")]
    assert session.status == SessionStatus.EXPIRED
    assert db.query(AuditLog).filter(AuditLog.event == "session.expired_action_client_not_found").count() == 1
    db.close()


@pytest.mark.asyncio
async def test_expire_due_session_retries_transient_unauthorize_error():
    from app.core.database import SessionLocal

    db = SessionLocal()
    session = create_due_session(db)
    fake = FakeUnauthorizer(
        clients=[client_record("client-1", True), client_record("client-1", False)],
        unauthorize_errors=[UniFiError("temporary", status_code=503)],
    )

    result = await expire_due_sessions_with_unifi(db, fake)
    db.refresh(session)

    assert result.expired == 1
    assert fake.calls == [("site-esdras", "client-1"), ("site-esdras", "client-1")]
    assert session.status == SessionStatus.EXPIRED
    db.close()


@pytest.mark.asyncio
async def test_expire_due_session_is_idempotent_after_marked_expired():
    from app.core.database import SessionLocal

    db = SessionLocal()
    session = create_due_session(db)
    fake = FakeUnauthorizer(clients=[client_record("client-1", False)])

    first = await expire_due_sessions_with_unifi(db, fake)
    second = await expire_due_sessions_with_unifi(db, fake)
    db.refresh(session)

    assert first.expired == 1
    assert second.expired == 0
    assert fake.calls == []
    assert session.status == SessionStatus.EXPIRED
    db.close()


@pytest.mark.asyncio
async def test_expire_due_legacy_session_without_site_expires_locally():
    from app.core.database import SessionLocal

    now = utcnow()
    db = SessionLocal()
    session = GuestSession(
        client_mac="aa:bb:cc:dd:ee:ff",
        authorization_method=AuthorizationMethod.CPF,
        status=SessionStatus.AUTHORIZED,
        authorized_at=now - timedelta(hours=2),
        expires_at=now - timedelta(minutes=1),
    )
    db.add(session)
    db.commit()

    result = await expire_due_sessions_with_unifi(db, FakeUnauthorizer())
    db.refresh(session)

    assert result.expired == 1
    assert result.skipped_missing_unifi_context == 1
    assert session.status == SessionStatus.EXPIRED
    db.close()

@pytest.mark.asyncio
async def test_refresh_unlimited_session_renews_rolling_unifi_grant():
    from app.core.database import SessionLocal

    now = utcnow()
    db = SessionLocal()
    session = GuestSession(
        client_mac="aa:bb:cc:dd:ee:90",
        site="site-esdras",
        unifi_client_id="client-unlimited",
        authorization_method=AuthorizationMethod.VOUCHER,
        status=SessionStatus.AUTHORIZED,
        authorized_at=now - timedelta(days=3),
        expires_at=None,
        unlimited_access=True,
        unifi_refresh_at=now - timedelta(hours=13),
    )
    db.add(session)
    db.commit()

    fake = FakeUnauthorizer(
        clients=[
            client_record("client-unlimited", True, mac="aa:bb:cc:dd:ee:90"),
            client_record("client-unlimited", True, mac="aa:bb:cc:dd:ee:90"),
        ]
    )

    result = await refresh_unlimited_sessions_with_unifi(db, fake)
    db.refresh(session)

    assert result.renewed_unlimited == 1
    assert result.failed_unlimited == 0
    assert fake.authorize_calls == [
        ("site-esdras", "client-unlimited", UNLIMITED_UNIFI_GRANT_MINUTES)
    ]
    assert session.expires_at is None
    assert session.unlimited_access is True
    assert session.unifi_refresh_at is not None
    db.close()
