import json
from dataclasses import dataclass
from datetime import timedelta
from typing import Protocol

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.integrations.unifi import UniFiClientRecord, UniFiError, unifi_client
from app.models import AccessBlock, AdminRole, AdminUser, AuditLog, EmailLoginCode, GuestSession, SessionStatus
from app.models.entities import new_id, utcnow
from app.security.tokens import secret_hash
from app.services.sessions import duration_between
from app.services.site_access import ensure_site_access

TRANSIENT_UNIFI_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class SessionOperationWorker(Protocol):
    async def get_current_client(self, *, site_id: str, client_mac: str) -> UniFiClientRecord: ...
    async def unauthorize_guest(self, *, site_id: str, client_id: str) -> dict: ...
    async def authorize_guest(self, *, site_id: str, client_id: str, minutes: int) -> dict: ...


class UniFiSessionOperationWorker:
    async def get_current_client(self, *, site_id: str, client_mac: str) -> UniFiClientRecord:
        return await unifi_client.get_client_by_mac(site_id, client_mac)

    async def unauthorize_guest(self, *, site_id: str, client_id: str) -> dict:
        return await unifi_client.unauthorize_guest(site_id=site_id, client_id=client_id)

    async def authorize_guest(self, *, site_id: str, client_id: str, minutes: int) -> dict:
        return await unifi_client.authorize_guest(site_id=site_id, client_id=client_id, minutes=minutes)


@dataclass(frozen=True)
class OperationResult:
    status: str
    unifi_confirmed: bool
    message: str
    operation_state: str = "SUCCESS"
    block_id: str | None = None
    new_session_id: str | None = None
    expires_at: object | None = None


def normalize_mac(value: str | None) -> str:
    return str(value or "").strip().lower()


def mask_mac(value: str | None) -> str:
    mac = normalize_mac(value)
    if len(mac) < 5:
        return ""
    return f"***:{mac[-5:]}"


def _audit(db: Session, admin: AdminUser | None, event: str, session: GuestSession, metadata: dict[str, object] | None = None) -> None:
    safe = {"sessionId": session.id, "siteId": session.site, "clientMac": mask_mac(session.client_mac), **(metadata or {})}
    db.add(AuditLog(actor_id=admin.id if admin else "system", event=event, target_type="guest_session", target_id=session.id, metadata_json=json.dumps(safe, separators=(",", ":"))))


def _audit_block(db: Session, admin: AdminUser, event: str, block: AccessBlock, metadata: dict[str, object] | None = None) -> None:
    safe = {"blockId": block.id, "siteId": block.site_id, "scope": block.scope, "deviceMac": block.device_mac_label, **(metadata or {})}
    db.add(AuditLog(actor_id=admin.id, event=event, target_type="access_block", target_id=block.id, metadata_json=json.dumps(safe, separators=(",", ":"))))


def is_not_found(exc: UniFiError) -> bool:
    return exc.status_code == 404 or "not found" in str(exc).lower()


def is_transient(exc: BaseException) -> bool:
    return isinstance(exc, TimeoutError) or (isinstance(exc, UniFiError) and exc.status_code in TRANSIENT_UNIFI_STATUS)


async def resolve_current_unifi_client(db: Session, session: GuestSession, worker: SessionOperationWorker | None = None) -> UniFiClientRecord | None:
    if not session.site or not session.client_mac:
        return None
    worker = worker or UniFiSessionOperationWorker()
    try:
        current = await worker.get_current_client(site_id=session.site, client_mac=normalize_mac(session.client_mac))
    except UniFiError as exc:
        if is_not_found(exc):
            return None
        raise
    if current.id and session.unifi_client_id != current.id:
        _audit(db, None, "session.unifi_client_id_refreshed", session, {"previousClientId": session.unifi_client_id, "currentClientId": current.id})
        session.unifi_client_id = current.id
    return current


async def _unauthorize_current(db: Session, session: GuestSession, worker: SessionOperationWorker, current: UniFiClientRecord) -> UniFiClientRecord | None:
    try:
        await worker.unauthorize_guest(site_id=session.site, client_id=current.id)
    except UniFiError as exc:
        if not is_not_found(exc):
            raise
        refreshed = await resolve_current_unifi_client(db, session, worker)
        if refreshed is None or not refreshed.authorized:
            return refreshed
        if refreshed.id != current.id:
            await worker.unauthorize_guest(site_id=session.site, client_id=refreshed.id)
    return await resolve_current_unifi_client(db, session, worker)


def _load_session_for_admin(db: Session, session_id: str, admin: AdminUser) -> GuestSession:
    session = db.get(GuestSession, session_id)
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessão não encontrada.")
    ensure_site_access(db, admin, session.site)
    return session


def _require_reason(reason: str) -> str:
    cleaned = reason.strip()
    if len(cleaned) < 3:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Informe o motivo administrativo.")
    return cleaned[:300]


def _mark_ended(session: GuestSession, admin: AdminUser, reason: str) -> None:
    now = utcnow()
    session.status = SessionStatus.DISCONNECTED
    session.disconnected_at = now
    session.ended_at = now
    session.ended_by = admin.id
    session.admin_end_reason = reason
    session.duration_seconds = duration_between(session.authorized_at or session.created_at, now)


async def end_session(db: Session, *, session_id: str, admin: AdminUser, reason: str, worker: SessionOperationWorker | None = None) -> OperationResult:
    reason = _require_reason(reason)
    session = _load_session_for_admin(db, session_id, admin)
    worker = worker or UniFiSessionOperationWorker()
    if session.status != SessionStatus.AUTHORIZED:
        _mark_ended(session, admin, reason)
        _audit(db, admin, "session.admin_ended", session, {"reason": reason, "idempotent": True})
        db.commit()
        return OperationResult("ended", True, "Sessão já estava encerrada.")
    try:
        current = await resolve_current_unifi_client(db, session, worker)
        if current is None:
            _mark_ended(session, admin, reason)
            _audit(db, admin, "session.client_not_found", session, {"reason": reason})
            db.commit()
            return OperationResult("ended", True, "O dispositivo não foi encontrado na UniFi. A sessão local foi finalizada.")
        if not current.authorized:
            _mark_ended(session, admin, reason)
            _audit(db, admin, "session.client_already_unauthorized", session, {"reason": reason, "clientId": current.id})
            db.commit()
            return OperationResult("ended", True, "O dispositivo já estava sem acesso.")
        confirmed = await _unauthorize_current(db, session, worker, current)
        if confirmed is not None and confirmed.authorized:
            _audit(db, admin, "session.unifi_action_failed", session, {"reason": reason, "result": "still_authorized"})
            db.commit()
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Não foi possível confirmar a ação na UniFi. Nenhuma alteração falsa foi registrada.")
        _mark_ended(session, admin, reason)
        _audit(db, admin, "session.admin_ended", session, {"reason": reason, "unifiConfirmed": True})
        db.commit()
        return OperationResult("ended", True, "Acesso encerrado com sucesso.")
    except (UniFiError, TimeoutError) as exc:
        db.rollback()
        _audit(db, admin, "session.unifi_action_failed", session, {"reason": reason, "error": exc.__class__.__name__})
        db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "UniFi temporariamente indisponível. Tente novamente.") from exc


async def require_reauthentication(db: Session, *, session_id: str, admin: AdminUser, reason: str, worker: SessionOperationWorker | None = None) -> OperationResult:
    result = await end_session(db, session_id=session_id, admin=admin, reason=reason, worker=worker)
    session = db.get(GuestSession, session_id)
    if session:
        now = utcnow()
        session.reauth_required_at = now
        session.reauth_required_by = admin.id
        session.reauth_reason = _require_reason(reason)
        db.execute(update(EmailLoginCode).where(EmailLoginCode.client_mac == session.client_mac, EmailLoginCode.consumed_at.is_(None)).values(consumed_at=now))
        _audit(db, admin, "session.reauthentication_required", session, {"reason": reason})
        db.commit()
    return OperationResult("reauthentication_required", result.unifi_confirmed, "Acesso encerrado. O visitante precisará autenticar-se novamente.")


async def extend_session(db: Session, *, session_id: str, admin: AdminUser, additional_minutes: int, reason: str, worker: SessionOperationWorker | None = None) -> OperationResult:
    reason = _require_reason(reason)
    if additional_minutes <= 0 or additional_minutes > 1440:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Duração inválida.")
    session = _load_session_for_admin(db, session_id, admin)
    if session.status != SessionStatus.AUTHORIZED or not session.expires_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "Somente sessões autorizadas podem ser estendidas.")
    worker = worker or UniFiSessionOperationWorker()
    previous = session.expires_at
    try:
        current = await resolve_current_unifi_client(db, session, worker)
        if current is None or not current.authorized:
            raise HTTPException(status.HTTP_409_CONFLICT, "Cliente não está conectado ou autorizado.")
        await worker.authorize_guest(site_id=session.site, client_id=current.id, minutes=additional_minutes)
        confirmed = await resolve_current_unifi_client(db, session, worker)
        if confirmed is None or not confirmed.authorized:
            _audit(db, admin, "session.unifi_action_failed", session, {"reason": reason, "operation": "extend"})
            db.commit()
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Não foi possível confirmar a extensão na UniFi.")
        session.expires_at = previous + timedelta(minutes=additional_minutes)
        _audit(db, admin, "session.extended", session, {"reason": reason, "previousExpiresAt": previous.isoformat(), "newExpiresAt": session.expires_at.isoformat(), "minutes": additional_minutes})
        db.commit()
        return OperationResult("extended", True, "Sessão estendida com sucesso.", expires_at=session.expires_at)
    except HTTPException:
        raise
    except (UniFiError, TimeoutError) as exc:
        db.rollback()
        _audit(db, admin, "session.unifi_action_failed", session, {"reason": reason, "operation": "extend", "error": exc.__class__.__name__})
        db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "UniFi temporariamente indisponível. A sessão não foi alterada.") from exc


async def reauthorize_session(db: Session, *, session_id: str, admin: AdminUser, duration_minutes: int, reason: str, worker: SessionOperationWorker | None = None) -> OperationResult:
    reason = _require_reason(reason)
    if duration_minutes <= 0 or duration_minutes > 1440:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Duração inválida.")
    old = _load_session_for_admin(db, session_id, admin)
    if old.status == SessionStatus.AUTHORIZED:
        raise HTTPException(status.HTTP_409_CONFLICT, "A sessão ainda está autorizada.")
    if active_block_for_session(db, old):
        raise HTTPException(status.HTTP_409_CONFLICT, "Cliente bloqueado.")
    worker = worker or UniFiSessionOperationWorker()
    try:
        current = await resolve_current_unifi_client(db, old, worker)
        if current is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Cliente não está conectado.")
        await worker.authorize_guest(site_id=old.site, client_id=current.id, minutes=duration_minutes)
        confirmed = await resolve_current_unifi_client(db, old, worker)
        if confirmed is None or not confirmed.authorized:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Não foi possível confirmar a autorização na UniFi.")
        now = utcnow()
        new_session = GuestSession(client_mac=old.client_mac, ap_mac=old.ap_mac, ssid=old.ssid, site=old.site, authorization_method=old.authorization_method, status=SessionStatus.AUTHORIZED, created_at=now, authorized_at=now, expires_at=now + timedelta(minutes=duration_minutes), terms_accepted_at=now, unifi_client_id=current.id, name=old.name)
        db.add(new_session)
        db.flush()
        _audit(db, admin, "session.reauthorized", old, {"reason": reason, "newSessionId": new_session.id, "minutes": duration_minutes})
        db.commit()
        return OperationResult("reauthorized", True, "Acesso autorizado novamente.", new_session_id=new_session.id)
    except HTTPException:
        raise
    except (UniFiError, TimeoutError) as exc:
        db.rollback()
        _audit(db, admin, "session.unifi_action_failed", old, {"reason": reason, "operation": "reauthorize", "error": exc.__class__.__name__})
        db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "UniFi temporariamente indisponível. Tente novamente.") from exc


def active_block_for_session(db: Session, session: GuestSession) -> AccessBlock | None:
    now = utcnow()
    device_hash = secret_hash(normalize_mac(session.client_mac))
    return db.scalar(
        select(AccessBlock)
        .where(
            AccessBlock.revoked_at.is_(None),
            AccessBlock.starts_at <= now,
            (AccessBlock.expires_at.is_(None)) | (AccessBlock.expires_at > now),
            AccessBlock.device_mac_hash == device_hash,
            (AccessBlock.site_id.is_(None)) | (AccessBlock.site_id == session.site),
        )
        .order_by(AccessBlock.created_at.desc())
        .limit(1)
    )


def active_block_for_client(db: Session, *, client_mac: str, site_id: str) -> AccessBlock | None:
    now = utcnow()
    return db.scalar(
        select(AccessBlock)
        .where(
            AccessBlock.revoked_at.is_(None),
            AccessBlock.starts_at <= now,
            (AccessBlock.expires_at.is_(None)) | (AccessBlock.expires_at > now),
            AccessBlock.device_mac_hash == secret_hash(normalize_mac(client_mac)),
            (AccessBlock.site_id.is_(None)) | (AccessBlock.site_id == site_id),
        )
        .order_by(AccessBlock.created_at.desc())
        .limit(1)
    )


async def block_session_identity(db: Session, *, session_id: str, admin: AdminUser, scope: str, duration_minutes: int | None, reason: str, worker: SessionOperationWorker | None = None) -> OperationResult:
    reason = _require_reason(reason)
    _load_session_for_admin(db, session_id, admin)
    scope = scope.upper()
    if scope == "GLOBAL" and admin.role != AdminRole.SUPERADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Somente SUPERADMIN pode criar bloqueio global.")
    await end_session(db, session_id=session_id, admin=admin, reason=f"Bloqueio: {reason}", worker=worker)
    ended_session = db.get(GuestSession, session_id)
    if not ended_session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessão não encontrada.")
    expires_at = utcnow() + timedelta(minutes=duration_minutes) if duration_minutes else None
    now = utcnow()
    block = AccessBlock(
        id=new_id("blk"),
        site_id=None if scope == "GLOBAL" else ended_session.site,
        scope=scope,
        device_mac_hash=secret_hash(normalize_mac(ended_session.client_mac)),
        device_mac_label=mask_mac(ended_session.client_mac),
        visitor_id=ended_session.id,
        reason=reason,
        starts_at=now,
        expires_at=expires_at,
        created_by=admin.id,
        created_at=now,
        updated_at=now,
    )
    db.add(block)
    _audit_block(db, admin, "access_block.created", block, {"reason": reason})
    db.commit()
    return OperationResult("blocked", True, "Dispositivo bloqueado no portal.", block_id=block.id)


def unblock_identity(db: Session, *, block_id: str, admin: AdminUser, reason: str) -> OperationResult:
    reason = _require_reason(reason)
    block = db.get(AccessBlock, block_id)
    if not block:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bloqueio não encontrado.")
    if block.site_id:
        ensure_site_access(db, admin, block.site_id)
    elif admin.role != AdminRole.SUPERADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Somente SUPERADMIN pode revogar bloqueio global.")
    if block.revoked_at:
        return OperationResult("revoked", True, "Bloqueio já estava revogado.", block_id=block.id)
    block.revoked_at = utcnow()
    block.revoked_by = admin.id
    block.revoke_reason = reason
    _audit_block(db, admin, "access_block.revoked", block, {"reason": reason})
    db.commit()
    return OperationResult("revoked", True, "Bloqueio revogado. O dispositivo poderá tentar autenticar novamente.", block_id=block.id)
