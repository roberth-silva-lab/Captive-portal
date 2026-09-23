from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import AuthAttempt
from app.models.entities import utcnow
from app.security.tokens import secret_hash


def record_attempt(db: Session, identifier: str, ip: str, method: str, success: bool, reason: str = "") -> None:
    db.add(
        AuthAttempt(
            identifier_hash=secret_hash(identifier),
            ip_hash=secret_hash(ip),
            method=method,
            success=success,
            reason=reason[:160],
        )
    )
    db.commit()


def enforce_rate_limit(
    db: Session,
    identifier: str,
    ip: str,
    method: str,
    max_attempts: int | None = None,
    *,
    include_successes: bool = False,
) -> None:
    settings = get_settings()
    cutoff = utcnow() - timedelta(seconds=settings.rate_limit_window_seconds)
    limit = max_attempts or settings.rate_limit_max_attempts
    conditions = [
        AuthAttempt.created_at >= cutoff,
        AuthAttempt.method == method,
        (AuthAttempt.identifier_hash == secret_hash(identifier)) | (AuthAttempt.ip_hash == secret_hash(ip)),
    ]
    if not include_successes:
        conditions.append(AuthAttempt.success.is_(False))
    stmt = select(func.count(AuthAttempt.id)).where(*conditions)
    attempts = db.execute(stmt).scalar_one()
    if attempts >= limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Muitas tentativas. Aguarde e tente novamente.")
