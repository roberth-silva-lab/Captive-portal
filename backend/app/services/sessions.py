from datetime import datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import AuthorizationMethod, GuestSession, SessionStatus
from app.models.entities import utcnow
from app.security.pii import encrypt_text


def comparable_now(value: datetime | None = None) -> datetime:
    now = utcnow()
    if value is not None and value.tzinfo is None:
        return now.replace(tzinfo=None)
    return now


def seconds_remaining(session: GuestSession) -> int:
    if not session.expires_at:
        return 0
    return max(0, int((session.expires_at - comparable_now(session.expires_at)).total_seconds()))


def duration_between(start: datetime | None, end: datetime | None) -> int:
    if not start or not end:
        return 0
    if start.tzinfo is None and end.tzinfo is not None:
        end = end.replace(tzinfo=None)
    if start.tzinfo is not None and end.tzinfo is None:
        start = start.replace(tzinfo=None)
    return max(0, int((end - start).total_seconds()))


def authorize_session(
    db: Session,
    *,
    client_mac: str,
    ap_mac: str = "",
    ssid: str = "",
    site: str = "",
    method: AuthorizationMethod,
    minutes: int,
    unifi_client_id: str,
    name: str = "",
    email: str = "",
    cpf: str = "",
    phone: str = "",
    ip: str = "",
    voucher_id: str | None = None,
) -> GuestSession:
    now = utcnow()
    session = GuestSession(
        client_mac=client_mac,
        ap_mac=ap_mac,
        ssid=ssid,
        site=site,
        authorization_method=method,
        status=SessionStatus.AUTHORIZED,
        created_at=now,
        authorized_at=now,
        expires_at=now + timedelta(minutes=minutes),
        terms_accepted_at=now,
        unifi_client_id=unifi_client_id,
        name=name,
        email_encrypted=encrypt_text(email),
        cpf_encrypted=encrypt_text(cpf),
        phone_encrypted=encrypt_text(phone),
        client_ip_encrypted=encrypt_text(ip),
        voucher_id=voucher_id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def expire_due_sessions(db: Session) -> int:
    now = utcnow()
    sessions = db.scalars(
        select(GuestSession).where(
            GuestSession.status == SessionStatus.AUTHORIZED,
            GuestSession.expires_at.is_not(None),
            GuestSession.expires_at <= now,
            or_(GuestSession.site == "", GuestSession.unifi_client_id == ""),
        )
    ).all()
    for session in sessions:
        session.status = SessionStatus.EXPIRED
        session.duration_seconds = duration_between(session.authorized_at or session.created_at, session.expires_at or comparable_now(session.expires_at))
    db.commit()
    return len(sessions)


def dashboard_counts(db: Session) -> dict:
    now = utcnow()

    def count_since(days: int) -> int:
        return db.execute(select(func.count(GuestSession.id)).where(GuestSession.created_at >= now - timedelta(days=days))).scalar_one()

    active = db.execute(select(func.count(GuestSession.id)).where(GuestSession.status == SessionStatus.AUTHORIZED, GuestSession.expires_at > now)).scalar_one()
    avg_duration = db.execute(select(func.coalesce(func.avg(GuestSession.duration_seconds), 0))).scalar_one()
    devices = db.execute(select(func.count(func.distinct(GuestSession.client_mac)))).scalar_one()
    expired = db.execute(select(func.count(GuestSession.id)).where(GuestSession.status == SessionStatus.EXPIRED)).scalar_one()
    return {
        "connectedNow": active,
        "activeSessions": active,
        "connections24h": count_since(1),
        "connections7d": count_since(7),
        "connections30d": count_since(30),
        "averageDurationSeconds": int(avg_duration or 0),
        "deviceCount": devices,
        "expiredSessions": expired,
    }
