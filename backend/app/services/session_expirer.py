import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.integrations.unifi import UniFiClientRecord, UniFiError, unifi_client
from app.models import AuditLog, GuestSession, SessionStatus
from app.models.entities import utcnow
from app.services.sessions import comparable_now, duration_between

logger = logging.getLogger(__name__)
TRANSIENT_UNIFI_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


@dataclass(frozen=True)
class ExpirationResult:
    expired: int = 0
    skipped_missing_unifi_context: int = 0
    failed_unifi: int = 0


class GuestUnauthorizer:
    async def get_current_client(self, *, site_id: str, client_mac: str) -> UniFiClientRecord:
        return await unifi_client.get_client_by_mac(site_id, client_mac)

    async def unauthorize_guest(self, *, site_id: str, client_id: str) -> dict:
        return await unifi_client.unauthorize_guest(site_id=site_id, client_id=client_id)


def _audit(db: Session, event: str, session: GuestSession, metadata: dict[str, object] | None = None) -> None:
    db.add(
        AuditLog(
            actor_id="system",
            event=event,
            target_type="guest_session",
            target_id=session.id,
            metadata_json=json.dumps(metadata or {}, separators=(",", ":")),
        )
    )


def _is_not_found(exc: UniFiError) -> bool:
    return exc.status_code == 404 or "not found" in str(exc).lower()


def _is_transient(exc: BaseException) -> bool:
    return isinstance(exc, TimeoutError) or (isinstance(exc, UniFiError) and exc.status_code in TRANSIENT_UNIFI_STATUS)


def _mark_expired(db: Session, session: GuestSession, event: str = "session.expired", metadata: dict[str, object] | None = None) -> None:
    session.status = SessionStatus.EXPIRED
    session.duration_seconds = duration_between(session.authorized_at or session.created_at, session.expires_at or comparable_now(session.expires_at))
    _audit(db, event, session, metadata or {"site": session.site, "unifiConfirmed": bool(session.site)})


async def _get_current_client(worker: GuestUnauthorizer, session: GuestSession) -> UniFiClientRecord | None:
    try:
        return await worker.get_current_client(site_id=session.site, client_mac=session.client_mac)
    except UniFiError as exc:
        if _is_not_found(exc):
            return None
        raise


async def _unauthorize_with_retry(worker: GuestUnauthorizer, *, site_id: str, client_id: str, attempts: int = 2) -> None:
    last_error: BaseException | None = None
    for attempt in range(attempts):
        try:
            await worker.unauthorize_guest(site_id=site_id, client_id=client_id)
            return
        except (UniFiError, TimeoutError) as exc:
            last_error = exc
            if attempt >= attempts - 1 or not _is_transient(exc):
                raise
            await asyncio.sleep(0.2 * (attempt + 1))
    if last_error:
        raise last_error


async def expire_due_sessions_with_unifi(db: Session, unauthorizer: GuestUnauthorizer | None = None, limit: int = 50) -> ExpirationResult:
    worker = unauthorizer or GuestUnauthorizer()
    now = utcnow()
    sessions = db.scalars(
        select(GuestSession)
        .where(
            GuestSession.status == SessionStatus.AUTHORIZED,
            GuestSession.expires_at.is_not(None),
            GuestSession.expires_at <= now,
        )
        .order_by(GuestSession.expires_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    ).all()

    expired = 0
    skipped = 0
    failed = 0
    for session in sessions:
        if not session.site:
            _mark_expired(db, session, "session.expired_without_unifi_context", {"reason": "missing_site"})
            expired += 1
            skipped += 1
            db.commit()
            continue
        try:
            current = await _get_current_client(worker, session)
            if current is None:
                _mark_expired(db, session, "session.expired_client_not_found", {"site": session.site, "clientMac": session.client_mac})
                expired += 1
                db.commit()
                continue

            if session.unifi_client_id != current.id:
                _audit(db, "session.unifi_client_id_refreshed", session, {"site": session.site, "previousClientId": session.unifi_client_id, "currentClientId": current.id})
                session.unifi_client_id = current.id

            if not current.authorized:
                _mark_expired(db, session, "session.expired_already_unauthorized", {"site": session.site, "clientId": current.id})
                expired += 1
                db.commit()
                continue

            try:
                await _unauthorize_with_retry(worker, site_id=session.site, client_id=current.id)
            except UniFiError as exc:
                if not _is_not_found(exc):
                    raise
                refreshed = await _get_current_client(worker, session)
                if refreshed is None or not refreshed.authorized:
                    _mark_expired(db, session, "session.expired_action_client_not_found", {"site": session.site, "clientId": current.id})
                    expired += 1
                    db.commit()
                    continue
                raise

            confirmed = await _get_current_client(worker, session)
            if confirmed is not None and confirmed.authorized:
                failed += 1
                _audit(db, "session.expire_unifi_still_authorized", session, {"site": session.site, "clientId": confirmed.id})
                db.commit()
                continue

            _mark_expired(db, session, "session.expired", {"site": session.site, "clientId": current.id, "unifiConfirmed": True})
            expired += 1
            db.commit()
        except (UniFiError, TimeoutError) as exc:
            failed += 1
            db.rollback()
            logger.warning("Could not expire UniFi guest session %s: %s", session.id, exc.__class__.__name__)
    return ExpirationResult(expired=expired, skipped_missing_unifi_context=skipped, failed_unifi=failed)


async def run_session_expirer_once(limit: int = 50) -> ExpirationResult:
    db = SessionLocal()
    try:
        return await expire_due_sessions_with_unifi(db, limit=limit)
    finally:
        db.close()


async def session_expirer_loop(
    *,
    stop_event: asyncio.Event,
    interval_seconds: int,
    batch_size: int,
    run_once: Callable[[int], Awaitable[ExpirationResult]] = run_session_expirer_once,
) -> None:
    while not stop_event.is_set():
        try:
            result = await run_once(batch_size)
            if result.expired or result.failed_unifi:
                logger.info("Session expirer result: expired=%s failed_unifi=%s skipped_missing_context=%s", result.expired, result.failed_unifi, result.skipped_missing_unifi_context)
        except Exception:  # noqa: BLE001
            logger.exception("Session expirer loop failed.")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        except TimeoutError:
            continue