from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.core.database import SessionLocal
from app.integrations.unifi import UniFiClientRecord, UniFiError
from app.models import AccessBlock, AdminRole, AdminUser, AuditLog, AuthorizationMethod, EmailLoginCode, GuestSession, SessionStatus
from app.models.entities import utcnow
from app.security.passwords import hash_password
from app.security.tokens import secret_hash
from app.services import session_operations as ops


class FakeWorker:
    def __init__(self, clients=None, unauthorize_errors=None, authorize_errors=None):
        self.clients = list(clients or [])
        self.unauthorize_errors = list(unauthorize_errors or [])
        self.authorize_errors = list(authorize_errors or [])
        self.lookups = []
        self.unauthorized = []
        self.authorized = []

    async def get_current_client(self, *, site_id: str, client_mac: str):
        self.lookups.append((site_id, client_mac))
        if not self.clients:
            raise UniFiError("not found", status_code=404)
        current = self.clients[0]
        if len(self.clients) > 1:
            self.clients.pop(0)
        if isinstance(current, BaseException):
            raise current
        return current

    async def unauthorize_guest(self, *, site_id: str, client_id: str):
        self.unauthorized.append((site_id, client_id))
        if self.unauthorize_errors:
            raise self.unauthorize_errors.pop(0)
        return {"ok": True}

    async def authorize_guest(self, *, site_id: str, client_id: str, minutes: int):
        self.authorized.append((site_id, client_id, minutes))
        if self.authorize_errors:
            raise self.authorize_errors.pop(0)
        return {"ok": True}


def make_admin(db, role=AdminRole.SUPERADMIN):
    admin = AdminUser(email=f"{role.value.lower()}@example.com", name="Admin", role=role, password_hash=hash_password("StrongPassword123!"))
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def make_session(db, *, status=SessionStatus.AUTHORIZED, client_id="old-client"):
    now = utcnow()
    session = GuestSession(
        client_mac="aa:bb:cc:dd:ee:ff",
        ap_mac="11:22:33:44:55:66",
        ssid="WiFi",
        site="Sede",
        authorization_method=AuthorizationMethod.EMAIL,
        status=status,
        created_at=now - timedelta(minutes=20),
        authorized_at=now - timedelta(minutes=10),
        expires_at=now + timedelta(minutes=50),
        terms_accepted_at=now - timedelta(minutes=10),
        unifi_client_id=client_id,
        name="POCO-X7-Pro",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def record(client_id="current-client", authorized=True):
    return UniFiClientRecord(id=client_id, mac="aa:bb:cc:dd:ee:ff", site_id="Sede", authorized=authorized)


@pytest.mark.asyncio
async def test_end_session_refreshes_obsolete_client_id_and_retries_404():
    db = SessionLocal()
    try:
        admin = make_admin(db)
        session = make_session(db)
        worker = FakeWorker(clients=[record("current-client", True), record("current-client", False)], unauthorize_errors=[UniFiError("old id", status_code=404)])

        result = await ops.end_session(db, session_id=session.id, admin=admin, reason="atendimento encerrado", worker=worker)

        db.refresh(session)
        assert result.status == "ended"
        assert session.status == SessionStatus.DISCONNECTED
        assert session.unifi_client_id == "current-client"
        assert worker.unauthorized == [("Sede", "current-client")]
        assert db.query(AuditLog).filter(AuditLog.event == "session.unifi_client_id_refreshed").count() == 1
    finally:
        db.close()


@pytest.mark.asyncio
async def test_end_session_is_idempotent_when_client_already_unauthorized():
    db = SessionLocal()
    try:
        admin = make_admin(db)
        session = make_session(db)
        worker = FakeWorker(clients=[record("current-client", False)])

        result = await ops.end_session(db, session_id=session.id, admin=admin, reason="sem uso", worker=worker)

        db.refresh(session)
        assert result.status == "ended"
        assert session.status == SessionStatus.DISCONNECTED
        assert not worker.unauthorized
        assert db.query(AuditLog).filter(AuditLog.event == "session.client_already_unauthorized").count() == 1
    finally:
        db.close()


@pytest.mark.asyncio
async def test_end_session_finishes_local_when_client_not_found():
    db = SessionLocal()
    try:
        admin = make_admin(db)
        session = make_session(db)
        worker = FakeWorker(clients=[])

        result = await ops.end_session(db, session_id=session.id, admin=admin, reason="cliente saiu", worker=worker)

        db.refresh(session)
        assert result.unifi_confirmed is True
        assert session.status == SessionStatus.DISCONNECTED
        assert db.query(AuditLog).filter(AuditLog.event == "session.client_not_found").count() == 1
    finally:
        db.close()


@pytest.mark.asyncio
async def test_end_session_unifi_unavailable_does_not_mark_ended():
    db = SessionLocal()
    try:
        admin = make_admin(db)
        session = make_session(db)
        worker = FakeWorker(clients=[UniFiError("down", status_code=503)])

        with pytest.raises(HTTPException) as exc:
            await ops.end_session(db, session_id=session.id, admin=admin, reason="teste", worker=worker)

        db.refresh(session)
        assert exc.value.status_code == 502
        assert session.status == SessionStatus.AUTHORIZED
    finally:
        db.close()


@pytest.mark.asyncio
async def test_require_reauthentication_invalidates_pending_email_code():
    db = SessionLocal()
    try:
        admin = make_admin(db)
        session = make_session(db)
        code = EmailLoginCode(email_hash=secret_hash("user@example.com"), client_mac=session.client_mac, code_hash=secret_hash("123456"), expires_at=utcnow() + timedelta(minutes=10))
        db.add(code)
        db.commit()
        worker = FakeWorker(clients=[record("current-client", True), record("current-client", False)])

        result = await ops.require_reauthentication(db, session_id=session.id, admin=admin, reason="validar novamente", worker=worker)

        db.refresh(session)
        db.refresh(code)
        assert result.status == "reauthentication_required"
        assert session.reauth_required_at is not None
        assert code.consumed_at is not None
    finally:
        db.close()


@pytest.mark.asyncio
async def test_extend_session_updates_database_only_after_unifi_confirmation():
    db = SessionLocal()
    try:
        admin = make_admin(db)
        session = make_session(db)
        previous = session.expires_at
        worker = FakeWorker(clients=[record("current-client", True), record("current-client", True)])

        result = await ops.extend_session(db, session_id=session.id, admin=admin, additional_minutes=30, reason="mais tempo", worker=worker)

        db.refresh(session)
        assert result.status == "extended"
        assert session.expires_at == previous + timedelta(minutes=30)
        assert worker.authorized == [("Sede", "current-client", 30)]
    finally:
        db.close()


@pytest.mark.asyncio
async def test_reauthorize_creates_new_session_without_rewriting_history():
    db = SessionLocal()
    try:
        admin = make_admin(db)
        old = make_session(db, status=SessionStatus.EXPIRED, client_id="old-client")
        worker = FakeWorker(clients=[record("current-client", False), record("current-client", True)])

        result = await ops.reauthorize_session(db, session_id=old.id, admin=admin, duration_minutes=60, reason="retorno", worker=worker)

        db.refresh(old)
        assert result.new_session_id
        assert old.status == SessionStatus.EXPIRED
        assert db.get(GuestSession, result.new_session_id).status == SessionStatus.AUTHORIZED
    finally:
        db.close()


@pytest.mark.asyncio
async def test_block_session_creates_internal_block_after_confirmed_end():
    db = SessionLocal()
    try:
        admin = make_admin(db)
        session = make_session(db)
        worker = FakeWorker(clients=[record("current-client", True), record("current-client", False)])

        result = await ops.block_session_identity(db, session_id=session.id, admin=admin, scope="SITE", duration_minutes=60, reason="abuso", worker=worker)

        block = db.get(AccessBlock, result.block_id)
        assert block is not None
        assert block.site_id == "Sede"
        assert block.device_mac_hash == secret_hash("aa:bb:cc:dd:ee:ff")
        assert ops.active_block_for_client(db, client_mac="aa:bb:cc:dd:ee:ff", site_id="Sede") is not None
    finally:
        db.close()