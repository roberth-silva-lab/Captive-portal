import hashlib
import hmac
from datetime import UTC, datetime, timedelta

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models import AdminRole, AdminSession, AdminUser
from app.security.tokens import secret_hash

ROLE_ORDER = {AdminRole.VIEWER: 1, AdminRole.ADMIN: 2, AdminRole.SUPERADMIN: 3}


def client_ip(request: Request) -> str:
    settings = get_settings()
    peer = request.client.host if request.client else ""
    trusted = {item.strip() for item in settings.trusted_proxy_ips.split(",") if item.strip()}
    if peer in trusted:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",", 1)[0].strip()
    return peer


def current_admin(
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=get_settings().session_cookie_name),
) -> AdminUser:
    if not session_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessao administrativa ausente.")
    session_id = secret_hash(session_token)
    session = db.get(AdminSession, session_id)
    now = datetime.now(UTC)
    if session and session.expires_at.tzinfo is None:
        now = now.replace(tzinfo=None)
    if not session or session.revoked_at or session.expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessao administrativa invalida ou expirada.")
    admin = db.get(AdminUser, session.admin_id)
    if not admin or not admin.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Administrador inativo.")
    if session.last_seen_at.tzinfo is None:
        compare_now = now.replace(tzinfo=None)
    else:
        compare_now = now
    if session.last_seen_at <= compare_now - timedelta(seconds=60):
        session.last_seen_at = compare_now
        admin.last_seen_at = compare_now
        db.commit()
    return admin


def require_role(min_role: AdminRole):
    def checker(admin: AdminUser = Depends(current_admin)) -> AdminUser:
        if ROLE_ORDER[admin.role] < ROLE_ORDER[min_role]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Permissao insuficiente.")
        return admin

    return checker


def require_csrf(
    request: Request,
    db: Session = Depends(get_db),
    x_csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    csrf_cookie: str | None = Cookie(default=None, alias=get_settings().csrf_cookie_name),
    session_token: str | None = Cookie(default=None, alias=get_settings().session_cookie_name),
) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    settings = get_settings()
    origin = request.headers.get("origin")
    if origin and origin not in settings.cors_origins:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Origem administrativa invalida.")
    if not x_csrf_token or not csrf_cookie or not session_token:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF invalido.")

    cookie_digest = hashlib.sha256(csrf_cookie.encode()).hexdigest()
    header_digest = hashlib.sha256(x_csrf_token.encode()).hexdigest()
    if not hmac.compare_digest(header_digest, cookie_digest):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF invalido.")

    session = db.get(AdminSession, secret_hash(session_token))
    if not session or session.revoked_at:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF invalido.")
    if not hmac.compare_digest(session.csrf_hash, secret_hash(csrf_cookie)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF invalido.")
