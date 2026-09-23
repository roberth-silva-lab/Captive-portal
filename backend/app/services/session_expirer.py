import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.integrations.unifi import UniFiClientRecord, UniFiError, unifi_client
from app.models import AuditLog, GuestSession, SessionStatus
from app.models.entities import utcnow
from app.services.session_operations import is_not_found as _is_not_found
from app.services.session_operations import is_transient as _is_transient
from app.services.session_operations import resolve_current_unifi_client
from app.services.sessions import comparable_now, duration_between

logger = logging.getLogger(__name__)



@dataclass(frozen=True)
class ExpirationResult:
    expired: int = 0
    skipped_missing_unifi_context: int = 0
    failed_unifi: int = 0
    renewed_unlimited: int = 0
    failed_unlimited: int = 0


UNLIMITED_UNIFI_GRANT_MINUTES = 1440
UNLIMITED_REFRESH_INTERVAL = timedelta(hours=12)


class GuestUnauthorizer:
    async def get_current_client(self, *, site_id: str, client_mac: str) -> UniFiClientRecord:
        return await unifi_client.get_client_by_mac(site_id, client_mac)

    async def unauthorize_guest(self, *, site_id: str, client_id: str) -> dict:
        return await unifi_client.unauthorize_guest(site_id=site_id, client_id=client_id)

    async def authorize_guest(self, *, site_id: str, client_id: str, minutes: int) -> dict:
        return await unifi_client.authorize_guest(site_id=site_id, client_id=client_id, minutes=minutes)


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


def _mark_expired(db: Session, session: GuestSession, event: str = "session.expired", metadata: dict[str, object] | None = None) -> None:
    session.status = SessionStatus.EXPIRED
    session.duration_seconds = duration_between(session.authorized_at or session.created_at, session.expires_at or comparable_now(session.expires_at))
    _audit(db, event, session, metadata or {"site": session.site, "unifiConfirmed": bool(session.site)})


async def _get_current_client(worker: GuestUnauthorizer, session: GuestSession, db: Session) -> UniFiClientRecord | None:
    return await resolve_current_unifi_client(db, session, worker)


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
            current = await _get_current_client(worker, session, db)
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
                refreshed = await _get_current_client(worker, session, db)
                if refreshed is None or not refreshed.authorized:
                    _mark_expired(db, session, "session.expired_action_client_not_found", {"site": session.site, "clientId": current.id})
                    expired += 1
                    db.commit()
                    continue
                raise

            confirmed = await _get_current_client(worker, session, db)
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


async def refresh_unlimited_sessions_with_unifi(
    db: Session,
    unauthorizer: GuestUnauthorizer | None = None,
    limit: int = 50,
) -> ExpirationResult:
    worker = unauthorizer or GuestUnauthorizer()
    now = utcnow()
    refresh_before = now - UNLIMITED_REFRESH_INTERVAL
    sessions = db.scalars(
        select(GuestSession)
        .where(
            GuestSession.status == SessionStatus.AUTHORIZED,
            GuestSession.unlimited_access.is_(True),
            (GuestSession.unifi_refresh_at.is_(None) | (GuestSession.unifi_refresh_at <= refresh_before)),
        )
        .order_by(GuestSession.unifi_refresh_at.asc().nullsfirst())
        .limit(limit)
        .with_for_update(skip_locked=True)
    ).all()

    renewed = 0
    failed = 0
    for session in sessions:
        if not session.site:
            session.unifi_refresh_at = now
            _audit(db, "session.unlimited_refresh_skipped", session, {"reason": "missing_site"})
            db.commit()
            continue
        try:
            current = await _get_current_client(worker, session, db)
            if current is None:
                session.unifi_refresh_at = now
                _audit(db, "session.unlimited_client_offline", session, {"site": session.site})
                db.commit()
                continue
            if session.unifi_client_id != current.id:
                session.unifi_client_id = current.id
            await worker.authorize_guest(
                site_id=session.site,
                client_id=current.id,
                minutes=UNLIMITED_UNIFI_GRANT_MINUTES,
            )
            confirmed = await _get_current_client(worker, session, db)
            if confirmed is None or not confirmed.authorized:
                failed += 1
                _audit(db, "session.unlimited_refresh_not_confirmed", session, {"site": session.site, "clientId": current.id})
                db.commit()
                continue
            session.unifi_client_id = confirmed.id
            session.unifi_refresh_at = now
            renewed += 1
            _audit(
                db,
                "session.unlimited_refreshed",
                session,
                {"site": session.site, "clientId": confirmed.id, "rollingMinutes": UNLIMITED_UNIFI_GRANT_MINUTES},
            )
            db.commit()
        except (UniFiError, TimeoutError) as exc:
            failed += 1
            db.rollback()
            logger.warning("Could not refresh unlimited UniFi guest session %s: %s", session.id, exc.__class__.__name__)
    return ExpirationResult(renewed_unlimited=renewed, failed_unlimited=failed)


async def run_session_expirer_once(limit: int = 50) -> ExpirationResult:
    db = SessionLocal()
    try:
        expired = await expire_due_sessions_with_unifi(db, limit=limit)
        unlimited = await refresh_unlimited_sessions_with_unifi(db, limit=limit)
        return ExpirationResult(
            expired=expired.expired,
            skipped_missing_unifi_context=expired.skipped_missing_unifi_context,
            failed_unifi=expired.failed_unifi,
            renewed_unlimited=unlimited.renewed_unlimited,
            failed_unlimited=unlimited.failed_unlimited,
        )
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
            if result.expired or result.failed_unifi or result.renewed_unlimited or result.failed_unlimited:
                logger.info(
                    "Session expirer result: expired=%s failed_unifi=%s skipped_missing_context=%s renewed_unlimited=%s failed_unlimited=%s",
                    result.expired,
                    result.failed_unifi,
                    result.skipped_missing_unifi_context,
                    result.renewed_unlimited,
                    result.failed_unlimited,
                )
        except Exception:  # noqa: BLE001
            logger.exception("Session expirer loop failed.")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        except TimeoutError:
            continue
