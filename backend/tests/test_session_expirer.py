from datetime import timedelta

import pytest

from app.models import AuditLog, AuthorizationMethod, GuestSession, SessionStatus
from app.models.entities import utcnow
from app.services.session_expirer import expire_due_sessions_with_unifi


class FakeUnauthorizer:
    def __init__(self, authorized_after=False):
        self.authorized_after = authorized_after
        self.calls = []

    async def unauthorize_guest(self, *, site_id: str, client_id: str):
        self.calls.append((site_id, client_id))
        return {"ok": True}

    async def is_authorized(self, *, site_id: str, client_mac: str) -> bool:
        return self.authorized_after


@pytest.mark.asyncio
async def test_expire_due_session_calls_unifi_and_marks_expired():
    from app.core.database import SessionLocal

    now = utcnow()
    db = SessionLocal()
    session = GuestSession(
        client_mac="aa:bb:cc:dd:ee:ff",
        site="site-esdras",
        unifi_client_id="client-1",
        authorization_method=AuthorizationMethod.EMAIL,
        status=SessionStatus.AUTHORIZED,
        authorized_at=now - timedelta(hours=2),
        expires_at=now - timedelta(minutes=1),
    )
    db.add(session)
    db.commit()

    fake = FakeUnauthorizer(authorized_after=False)
    result = await expire_due_sessions_with_unifi(db, fake)
    db.refresh(session)

    assert result.expired == 1
    assert fake.calls == [("site-esdras", "client-1")]
    assert session.status == SessionStatus.EXPIRED
    assert db.query(AuditLog).filter(AuditLog.event == "session.expired").count() == 1
    db.close()


@pytest.mark.asyncio
async def test_expire_due_session_does_not_mark_expired_without_unifi_confirmation():
    from app.core.database import SessionLocal

    now = utcnow()
    db = SessionLocal()
    session = GuestSession(
        client_mac="aa:bb:cc:dd:ee:ff",
        site="site-esdras",
        unifi_client_id="client-1",
        authorization_method=AuthorizationMethod.EMAIL,
        status=SessionStatus.AUTHORIZED,
        authorized_at=now - timedelta(hours=2),
        expires_at=now - timedelta(minutes=1),
    )
    db.add(session)
    db.commit()

    result = await expire_due_sessions_with_unifi(db, FakeUnauthorizer(authorized_after=True))
    db.refresh(session)

    assert result.expired == 0
    assert result.failed_unifi == 1
    assert session.status == SessionStatus.AUTHORIZED
    db.close()


@pytest.mark.asyncio
async def test_expire_due_legacy_session_without_unifi_context_locally():
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
