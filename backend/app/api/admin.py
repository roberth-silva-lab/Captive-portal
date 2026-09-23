import json
import secrets
from datetime import datetime, timedelta
from typing import Any, cast

from fastapi import APIRouter, Cookie, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import func, inspect, or_, select, text
from sqlalchemy.orm import Session

from app.api.deps import client_ip, current_admin, require_csrf, require_role
from app.api.health import _schema_findings
from app.core.config import get_settings
from app.core.database import engine, get_db
from app.integrations.email.service import (
    EmailDeliveryError,
    admin_invitation_email,
    admin_login_code_email,
    admin_password_reset_code_email,
    send_email,
)
from app.integrations.unifi import UniFiError, unifi_client
from app.models import (
    AdminInvitation,
    AdminRole,
    AdminSession,
    AdminSiteAccess,
    AdminUser,
    AuditLog,
    AuthAttempt,
    GuestSession,
    MaintenanceConfig,
    MediaAsset,
    PasswordResetToken,
    PortalNotification,
    PortalSetting,
    PortalSiteSetting,
    SessionStatus,
    SiteProfile,
    Voucher,
)
from app.models.entities import utcnow
from app.schemas.admin import (
    AdminEmailTestRequest,
    AdminInviteAcceptRequest,
    AdminInviteCreate,
    AdminInviteResponse,
    AdminInviteValidateResponse,
    AdminLoginChallengeResponse,
    AdminLoginCodeRequest,
    AdminLoginRequest,
    AdminMe,
    AdminPasswordResetConfirmRequest,
    AdminPasswordResetRequest,
    AdminSiteAccessUpdateRequest,
    AllowedSiteResponse,
    AuthAttemptResponse,
    CreatedVoucherCode,
    DashboardSummary,
    MaintenanceAdminResponse,
    MaintenanceUpdateRequest,
    MediaAssetResponse,
    NotificationAdminResponse,
    NotificationCreateRequest,
    NotificationUpdateRequest,
    PortalAppearanceRequest,
    PortalAppearanceResponse,
    PortalSiteAppearanceRequest,
    PortalSiteAppearanceResponse,
    SensitiveSessionRevealRequest,
    SensitiveSessionRevealResponse,
    SessionActionRequest,
    SessionBlockRequest,
    SessionExtendRequest,
    SessionOperationResponse,
    SessionReauthorizeRequest,
    SiteNode,
    VoucherBatchCreateResponse,
    VoucherCreateRequest,
    VoucherResponse,
    VoucherUpdateRequest,
)
from app.security.passwords import hash_password, verify_password
from app.security.pii import decrypt_text
from app.security.tokens import random_token_urlsafe, secret_hash
from app.services.media_storage import LocalMediaStorage
from app.services.rate_limit import enforce_rate_limit, record_attempt
from app.services.session_operations import (
    block_session_identity,
    end_session,
    extend_session,
    reauthorize_session,
    require_reauthentication,
    unblock_identity,
)
from app.services.sessions import dashboard_counts, seconds_remaining
from app.services.site_access import (
    allowed_site_ids,
    ensure_site_access,
    invitation_sites,
    replace_admin_site_access,
    require_invite_sites_for_role,
    visible_site_filter,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])
PORTAL_APPEARANCE_DEFAULTS = {
    "network_name": "Wi-Fi Visitante",
    "establishment_name": "Gabinete Itinerante",
    "logo_url": "",
    "primary_color": "#176b87",
    "banner_text": "Portal de Acesso Wi-Fi",
    "welcome_text": "Conecte-se de forma segura a rede de visitantes.",
    "success_message": "Acesso liberado. Você já pode navegar na Internet.",
    "expired_message": "Sua sessão expirou. Autentique-se novamente para continuar usando o Wi-Fi.",
    "terms_text": "Ao continuar, você aceita os termos de uso da rede.",
    "auth_methods": '["voucher","cpf","email"]',
}


VALID_AUTH_METHODS = {"voucher", "cpf", "email"}
DEFAULT_AUTH_METHODS = ["voucher", "cpf", "email"]


def _auth_methods_from_json(raw: str | None) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except json.JSONDecodeError:
        value = []
    methods: list[str] = []
    if isinstance(value, list):
        for item in value:
            method = str(item).strip().lower()
            if method in VALID_AUTH_METHODS and method not in methods:
                methods.append(method)
    return methods or DEFAULT_AUTH_METHODS.copy()


def _auth_methods_json(methods: list[str]) -> str:
    cleaned: list[str] = []
    for item in methods:
        method = str(item).strip().lower()
        if method in VALID_AUTH_METHODS and method not in cleaned:
            cleaned.append(method)
    return json.dumps(cleaned or DEFAULT_AUTH_METHODS, separators=(",", ":"))


def portal_setting_value(db: Session, key: str) -> str:
    row = db.get(PortalSetting, key)
    return row.value if row else PORTAL_APPEARANCE_DEFAULTS[key]


def set_portal_setting(db: Session, key: str, value: str) -> None:
    row = db.get(PortalSetting, key)
    if not row:
        row = PortalSetting(key=key)
        db.add(row)
    row.value = value


def _portal_appearance(db: Session) -> PortalAppearanceResponse:
    updated_raw = db.get(PortalSetting, "appearance_updated_at")
    updated_at = None
    if updated_raw and updated_raw.value:
        try:
            updated_at = datetime.fromisoformat(updated_raw.value)
        except ValueError:
            updated_at = None
    return PortalAppearanceResponse(
        networkName=portal_setting_value(db, "network_name"),
        establishmentName=portal_setting_value(db, "establishment_name"),
        logoUrl=portal_setting_value(db, "logo_url"),
        primaryColor=portal_setting_value(db, "primary_color"),
        bannerText=portal_setting_value(db, "banner_text"),
        welcomeText=portal_setting_value(db, "welcome_text"),
        successMessage=portal_setting_value(db, "success_message"),
        expiredMessage=portal_setting_value(db, "expired_message"),
        termsText=portal_setting_value(db, "terms_text"),
        authMethods=_auth_methods_from_json(portal_setting_value(db, "auth_methods")),
        updatedAt=updated_at,
    )



def _invite_url(token: str) -> str:
    settings = get_settings()
    return f"{settings.admin_base_url.rstrip('/')}/admin/accept-invite?token={token}"



def _portal_site_appearance(db: Session, site_id: str, site_name: str | None = None) -> PortalSiteAppearanceResponse:
    base = _portal_appearance(db)
    row = db.scalar(select(PortalSiteSetting).where(PortalSiteSetting.site_id == site_id))
    return PortalSiteAppearanceResponse(
        siteId=site_id,
        siteName=(row.site_name if row and row.site_name else site_name or site_id),
        enabled=row.enabled if row else True,
        hasOverride=row is not None,
        networkName=base.networkName,
        establishmentName=(row.display_name if row and row.display_name else base.establishmentName),
        logoUrl=(row.logo_url if row and row.logo_url else base.logoUrl),
        primaryColor=(row.primary_color if row and row.primary_color else base.primaryColor),
        bannerText=(row.public_title if row and row.public_title else base.bannerText),
        welcomeText=(row.welcome_text if row and row.welcome_text else base.welcomeText),
        successMessage=(row.success_message if row and row.success_message else base.successMessage),
        expiredMessage=(row.reauthentication_message if row and row.reauthentication_message else base.expiredMessage),
        termsText=(row.terms_text if row and row.terms_text else base.termsText),
        authMethods=(_auth_methods_from_json(row.auth_methods_json) if row else base.authMethods),
        updatedAt=(row.updated_at if row else base.updatedAt),
    )

def _now_for_expires_at(expires_at: datetime) -> datetime:
    now = utcnow()
    if expires_at.tzinfo is None:
        return now.replace(tzinfo=None)
    return now


def _invite_delivery_status(invite: AdminInvitation) -> str:
    now = _now_for_expires_at(invite.expires_at)
    if invite.revoked_at:
        return "REVOKED"
    if invite.accepted_at:
        return "ACCEPTED"
    if invite.expires_at <= now:
        return "EXPIRED"
    return "PENDING"


def _invite_for_token(db: Session, token: str) -> AdminInvitation:
    cleaned = token.strip()
    if not cleaned:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Link de convite inválido ou incompleto.")
    invite = db.scalar(select(AdminInvitation).where(AdminInvitation.token_hash == secret_hash(cleaned)))
    if not invite:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Convite inexistente.")
    state = _invite_delivery_status(invite)
    if state == "ACCEPTED":
        raise HTTPException(status.HTTP_409_CONFLICT, "Este convite já foi usado.")
    if state in {"EXPIRED", "REVOKED"}:
        raise HTTPException(status.HTTP_410_GONE, "Este convite expirou ou foi revogado.")
    return invite
def _invite_out(invite: AdminInvitation, delivery_status: str = "pending", invite_url: str | None = None) -> AdminInviteResponse:
    return AdminInviteResponse(
        id=invite.id,
        email=invite.email,
        name=invite.name,
        role=AdminRole(invite.role),
        expiresAt=invite.expires_at,
        acceptedAt=invite.accepted_at,
        revokedAt=invite.revoked_at,
        deliveryStatus=delivery_status,
        inviteUrl=invite_url,
        siteIds=invitation_sites(invite.permitted_site_ids_json),
    )

def admin_out(admin: AdminUser, db: Session | None = None) -> AdminMe:
    sites = [] if db is None else (allowed_site_ids(db, admin) or [])
    return AdminMe(id=admin.id, email=admin.email, name=admin.name, role=admin.role, siteIds=sites, canSelectAllSites=admin.role == AdminRole.SUPERADMIN)


def audit(db: Session, admin: AdminUser, event: str, target_type: str, target_id: str, metadata: dict[str, Any] | None = None) -> None:
    db.add(AuditLog(actor_id=admin.id, event=event, target_type=target_type, target_id=target_id, metadata_json=json.dumps(metadata or {}, separators=(",", ":"))))


def _json_dict(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}



def _audit_site_label(row: AuditLog) -> str:
    metadata = _json_dict(row.metadata_json)
    for key in ("siteName", "site", "siteId"):
        value = metadata.get(key)
        if value:
            return str(value)
    site_ids = metadata.get("siteIds")
    if isinstance(site_ids, list) and site_ids:
        return ", ".join(str(item) for item in site_ids)
    if row.target_type in {"maintenance", "portal_site_settings"} and row.target_id != "global":
        return row.target_id
    return "global"


def _audit_out(row: AuditLog) -> dict[str, Any]:
    return {
        "id": row.id,
        "actorId": row.actor_id,
        "event": row.event,
        "createdAt": row.created_at,
        "targetId": row.target_id,
        "targetType": row.target_type,
        "siteLabel": _audit_site_label(row),
    }
def _maintenance_state(
    row: MaintenanceConfig | None,
    *,
    scope: str = "global",
    inherited: bool = False,
) -> MaintenanceAdminResponse:
    now = utcnow()
    if (row and row.start_at and row.start_at.tzinfo is None) or (row and row.end_at and row.end_at.tzinfo is None):
        now = now.replace(tzinfo=None)
    if not row:
        return MaintenanceAdminResponse(
            maintenanceEnabled=False,
            maintenanceActive=False,
            maintenanceScheduled=False,
            maintenanceExpired=False,
            maintenanceStatus="disabled",
            maintenanceScope=scope,
            maintenanceInherited=inherited,
            maintenanceTitle="Portal em manutenção",
            maintenanceMessage="Estamos realizando ajustes para melhorar o acesso.",
        )

    started = row.start_at is None or row.start_at <= now
    not_ended = row.end_at is None or row.end_at > now
    active = row.enabled and started and not_ended
    scheduled = row.enabled and row.start_at is not None and row.start_at > now
    expired = row.enabled and row.end_at is not None and row.end_at <= now
    if active:
        state = "active"
        next_change = row.end_at
    elif scheduled:
        state = "scheduled"
        next_change = row.start_at
    elif expired:
        state = "expired"
        next_change = None
    else:
        state = "disabled"
        next_change = None

    return MaintenanceAdminResponse(
        maintenanceEnabled=row.enabled,
        maintenanceActive=active,
        maintenanceScheduled=scheduled,
        maintenanceExpired=expired,
        maintenanceStatus=state,
        maintenanceNextChangeAt=next_change,
        maintenanceScope=scope,
        maintenanceInherited=inherited,
        maintenanceTitle=row.title,
        maintenanceMessage=row.message,
        maintenanceStartAt=row.start_at,
        maintenanceEndAt=row.end_at,
        maintenanceImageUrl=row.image_url,
        maintenanceVisualConfig=_json_dict(row.visual_config_json),
        updatedAt=row.updated_at,
    )




def _unifi_site_id(site: dict[str, Any]) -> str:
    return str(site.get("id") or site.get("siteId") or site.get("_id") or "")


def _unifi_site_name(site: dict[str, Any]) -> str:
    return str(site.get("name") or site.get("displayName") or site.get("description") or _unifi_site_id(site))


def _device_mac(row: dict[str, Any]) -> str:
    return str(row.get("macAddress") or row.get("mac") or "")


def _device_id(row: dict[str, Any]) -> str:
    return str(row.get("id") or row.get("_id") or row.get("deviceId") or _device_mac(row))


def _device_status(row: dict[str, Any]) -> str | None:
    value = row.get("state") or row.get("status") or row.get("connectionState")
    return str(value) if value is not None else None


def _client_mac(row: dict[str, Any]) -> str:
    return str(row.get("macAddress") or row.get("mac") or row.get("clientMac") or "")


def _client_id(row: dict[str, Any]) -> str:
    return str(row.get("id") or row.get("_id") or row.get("clientId") or _client_mac(row))


def _client_ap_mac(row: dict[str, Any]) -> str:
    uplink = row.get("uplinkDevice") or {}
    wifi = row.get("wifiConnection") or {}
    access_point = row.get("accessPoint") or {}
    return str(
        access_point.get("macAddress")
        or access_point.get("mac")
        or uplink.get("macAddress")
        or uplink.get("mac")
        or wifi.get("apMacAddress")
        or wifi.get("apMac")
        or row.get("apMacAddress")
        or row.get("apMac")
        or row.get("ap_mac")
        or ""
    )


def _client_authorized(row: dict[str, Any]) -> bool:
    if "authorized" in row:
        return bool(row.get("authorized"))
    access = row.get("access") or {}
    return bool(access.get("authorized"))


def _site_session_count(db: Session, site_id: str) -> int:
    return db.execute(select(func.count(GuestSession.id)).where(GuestSession.site == site_id)).scalar_one()

def _client_portal_session(db: Session, client_mac: str) -> dict[str, Any]:
    if not client_mac:
        return {}
    session = db.scalar(select(GuestSession).where(GuestSession.client_mac == client_mac.lower()).order_by(GuestSession.created_at.desc()).limit(1))
    if not session:
        return {}
    return {
        "sessionId": session.id,
        "portalStatus": session.status.value.lower(),
        "authorizationMethod": session.authorization_method.value,
        "authorizedAt": session.authorized_at,
        "expiresAt": session.expires_at,
        "remainingSeconds": seconds_remaining(session),
        "canEndAccess": bool(session.site and session.unifi_client_id and session.status == SessionStatus.AUTHORIZED),
    }



VOUCHER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _voucher_status(voucher: Voucher) -> str:
    now = utcnow()
    if voucher.revoked_at:
        return "Revogado"
    if voucher.expires_at and voucher.expires_at <= now:
        return "Expirado"
    if not voucher.is_active:
        return "Revogado"
    if voucher.used_count >= max(1, voucher.max_devices):
        return "Utilizado"
    if voucher.used_count > 0:
        return "Em uso"
    return "Disponível"


def _new_voucher_code() -> str:
    chunks = []
    for _ in range(2):
        chunks.append("".join(secrets.choice(VOUCHER_ALPHABET) for _ in range(4)))
    return "RF-" + "-".join(chunks)


def _normalize_voucher_code(code: str) -> str:
    return "".join(char for char in code.strip().upper() if char.isalnum())


def _voucher_hash_candidates(code: str) -> set[str]:
    normalized = _normalize_voucher_code(code)
    candidates = {normalized, code.strip().upper()}
    if normalized.startswith("RF") and len(normalized) == 10:
        candidates.add(f"RF-{normalized[2:6]}-{normalized[6:10]}")
    return {secret_hash(candidate) for candidate in candidates if candidate}


def _voucher_label(code: str) -> str:
    return code



def _media_out(row: MediaAsset) -> MediaAssetResponse:
    return MediaAssetResponse(
        id=row.id,
        assetType=row.asset_type,
        originalFilename=row.original_filename,
        contentType=row.content_type,
        byteSize=row.byte_size,
        width=row.width,
        height=row.height,
        publicUrl=row.public_url,
        createdAt=row.created_at,
    )

def _notification_out(row: PortalNotification) -> NotificationAdminResponse:
    return NotificationAdminResponse(id=row.id, type=row.type, title=row.title, message=row.message, startsAt=row.starts_at, endsAt=row.ends_at, site=row.site, enabled=row.enabled, createdAt=row.created_at, updatedAt=row.updated_at)


def _voucher_site_payload(db: Session, admin: AdminUser, site_id: str | None, site_name: str) -> tuple[str, str]:
    requested = (site_id or site_name or "").strip()
    if requested.upper() == "ALL":
        if admin.role != AdminRole.SUPERADMIN:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas SUPERADMIN pode criar voucher valido para todos os sites.")
        return "ALL", "ALL"
    selected_site = ensure_site_access(db, admin, site_id or site_name)
    return selected_site or site_name, site_name

def _voucher_out(voucher: Voucher) -> VoucherResponse:
    return VoucherResponse(
        id=voucher.id,
        codeLabel=voucher.code_label,
        description=voucher.description,
        status=_voucher_status(voucher),
        durationMinutes=voucher.duration_minutes,
        timeLimitMinutes=voucher.time_limit_minutes,
        dataLimitMb=voucher.data_limit_mb,
        downloadLimit=voucher.download_limit,
        uploadLimit=voucher.upload_limit,
        deviceLimit=voucher.device_limit,
        maxDevices=voucher.max_devices,
        site=voucher.site_name_snapshot or voucher.site,
        siteId=voucher.site_id or voucher.site,
        siteName=voucher.site_name_snapshot or voucher.site,
        enabled=voucher.is_active and voucher.revoked_at is None,
        expiresAt=voucher.expires_at,
        usedCount=voucher.used_count,
        isActive=voucher.is_active and voucher.revoked_at is None,
        createdAt=voucher.created_at,
        revokedAt=voucher.revoked_at,
    )



def _admin_code_hash(purpose: str, admin_id: str, code: str) -> str:
    return secret_hash(f"{purpose}:{admin_id}:{code.strip()}")


def _six_digit_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _set_admin_session(admin: AdminUser, response: Response, db: Session) -> None:
    settings = get_settings()
    raw_session = random_token_urlsafe()
    raw_csrf = random_token_urlsafe()
    db.add(AdminSession(id=secret_hash(raw_session), admin_id=admin.id, csrf_hash=secret_hash(raw_csrf), expires_at=utcnow() + timedelta(minutes=settings.admin_session_minutes)))
    secure = settings.is_production
    response.set_cookie(settings.session_cookie_name, raw_session, httponly=True, secure=secure, samesite="lax", max_age=settings.admin_session_minutes * 60)
    response.set_cookie(settings.csrf_cookie_name, raw_csrf, httponly=False, secure=secure, samesite="lax", max_age=settings.admin_session_minutes * 60)

@router.post("/login", response_model=None)
def login(payload: AdminLoginRequest, response: Response, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    enforce_rate_limit(db, payload.email, ip, "admin-login", max_attempts=5)
    admin = db.scalar(select(AdminUser).where(AdminUser.email == payload.email.lower(), AdminUser.is_active.is_(True)))
    if not admin or not verify_password(payload.password, admin.password_hash):
        record_attempt(db, payload.email, ip, "admin-login", False, "invalid_credentials")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciais inválidas.")
    settings = get_settings()
    if settings.require_admin_email_mfa:
        code = _six_digit_code()
        expires_at = utcnow() + timedelta(minutes=settings.admin_mfa_code_ttl_minutes)
        db.add(PasswordResetToken(admin_id=admin.id, token_hash=_admin_code_hash("admin-login", admin.id, code), expires_at=expires_at))
        text_body, html_body = admin_login_code_email(code, settings.admin_mfa_code_ttl_minutes)
        try:
            send_email(admin.email, "Código de acesso ao painel", text_body, html_body)
        except EmailDeliveryError as exc:
            db.rollback()
            record_attempt(db, payload.email, ip, "admin-login", False, "smtp_error")
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Não foi possível enviar o código de verificação agora.") from exc
        db.commit()
        record_attempt(db, payload.email, ip, "admin-login", True, "mfa_sent")
        return AdminLoginChallengeResponse(email=admin.email, expiresAt=expires_at)
    _set_admin_session(admin, response, db)
    db.commit()
    record_attempt(db, payload.email, ip, "admin-login", True)
    return admin_out(admin, db)


@router.post("/login/verify-code", response_model=AdminMe)
def verify_admin_login_code(payload: AdminLoginCodeRequest, response: Response, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    enforce_rate_limit(db, payload.email, ip, "admin-login-code", max_attempts=5)
    admin = db.scalar(select(AdminUser).where(AdminUser.email == payload.email.lower(), AdminUser.is_active.is_(True)))
    if not admin or not verify_password(payload.password, admin.password_hash):
        record_attempt(db, payload.email, ip, "admin-login-code", False, "invalid_credentials")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Código ou credenciais inválidas.")
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.admin_id == admin.id, PasswordResetToken.token_hash == _admin_code_hash("admin-login", admin.id, payload.code), PasswordResetToken.consumed_at.is_(None)).order_by(PasswordResetToken.expires_at.desc()).limit(1))
    if not row or row.expires_at <= _now_for_expires_at(row.expires_at):
        record_attempt(db, payload.email, ip, "admin-login-code", False, "invalid_code")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Código ou credenciais inválidas.")
    row.consumed_at = utcnow()
    _set_admin_session(admin, response, db)
    db.commit()
    record_attempt(db, payload.email, ip, "admin-login-code", True)
    return admin_out(admin, db)


@router.post("/password/forgot")
def forgot_admin_password(payload: AdminPasswordResetRequest, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    enforce_rate_limit(db, payload.email, ip, "admin-password-forgot", max_attempts=5)
    admin = db.scalar(select(AdminUser).where(AdminUser.email == payload.email.lower(), AdminUser.is_active.is_(True)))
    if not admin:
        record_attempt(db, payload.email, ip, "admin-password-forgot", True, "unknown_email")
        return {"ok": True}
    settings = get_settings()
    code = _six_digit_code()
    expires_at = utcnow() + timedelta(minutes=settings.admin_password_reset_ttl_minutes)
    db.add(PasswordResetToken(admin_id=admin.id, token_hash=_admin_code_hash("admin-reset", admin.id, code), expires_at=expires_at))
    text_body, html_body = admin_password_reset_code_email(code, settings.admin_password_reset_ttl_minutes)
    try:
        send_email(admin.email, "Recuperação de senha do painel", text_body, html_body)
    except EmailDeliveryError as exc:
        db.rollback()
        record_attempt(db, payload.email, ip, "admin-password-forgot", False, "smtp_error")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Não foi possível enviar o código de recuperação agora.") from exc
    db.commit()
    record_attempt(db, payload.email, ip, "admin-password-forgot", True)
    return {"ok": True}


@router.post("/password/reset")
def reset_admin_password(payload: AdminPasswordResetConfirmRequest, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    enforce_rate_limit(db, payload.email, ip, "admin-password-reset", max_attempts=5)
    admin = db.scalar(select(AdminUser).where(AdminUser.email == payload.email.lower(), AdminUser.is_active.is_(True)))
    if not admin:
        record_attempt(db, payload.email, ip, "admin-password-reset", False, "invalid_code")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Código inválido ou expirado.")
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.admin_id == admin.id, PasswordResetToken.token_hash == _admin_code_hash("admin-reset", admin.id, payload.code), PasswordResetToken.consumed_at.is_(None)).order_by(PasswordResetToken.expires_at.desc()).limit(1))
    if not row or row.expires_at <= _now_for_expires_at(row.expires_at):
        record_attempt(db, payload.email, ip, "admin-password-reset", False, "invalid_code")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Código inválido ou expirado.")
    row.consumed_at = utcnow()
    admin.password_hash = hash_password(payload.password)
    admin.updated_at = utcnow()
    revoked_at = utcnow()
    active_sessions = db.scalars(
        select(AdminSession).where(
            AdminSession.admin_id == admin.id,
            AdminSession.revoked_at.is_(None),
        )
    ).all()
    for active_session in active_sessions:
        active_session.revoked_at = revoked_at
    db.commit()
    record_attempt(db, payload.email, ip, "admin-password-reset", True)
    return {"ok": True}


@router.post("/logout", dependencies=[Depends(require_csrf)])
def logout(response: Response, db: Session = Depends(get_db), admin: AdminUser = Depends(current_admin), session_cookie: str | None = Cookie(default=None, alias=get_settings().session_cookie_name)):
    settings = get_settings()
    if session_cookie:
        session = db.get(AdminSession, secret_hash(session_cookie))
        if session and session.admin_id == admin.id:
            session.revoked_at = utcnow()
            db.commit()
    response.delete_cookie(settings.session_cookie_name)
    response.delete_cookie(settings.csrf_cookie_name)
    return {"ok": True}


@router.get("/me", response_model=AdminMe)
def me(admin: AdminUser = Depends(current_admin), db: Session = Depends(get_db)):
    return admin_out(admin, db)


@router.get("/system-health")
async def system_health(_admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    settings = get_settings()
    database_status = "ok"
    schema_status = "ok"
    schema_findings: list[str] = []
    alembic_revision = None
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
            schema_findings = _schema_findings(conn)
            tables = set(inspect(conn).get_table_names())
            if engine.dialect.name == "postgresql" and "alembic_version" not in tables:
                schema_findings.append("missing_table:alembic_version")
            if "alembic_version" in tables:
                alembic_revision = conn.execute(text("select version_num from alembic_version limit 1")).scalar_one_or_none()
            if schema_findings:
                schema_status = "incompatible"
    except Exception:  # noqa: BLE001
        database_status = "unavailable"
        schema_status = "unknown"

    unifi_status = "ok"
    unifi_sites = 0
    unifi_error = ""
    try:
        unifi_sites = len(await unifi_client.list_sites())
    except UniFiError as exc:
        unifi_status = "degraded"
        unifi_error = str(exc)
    except Exception:  # noqa: BLE001
        unifi_status = "degraded"
        unifi_error = "UniFi indisponível."

    media_status = "ok"
    media_message = ""
    try:
        storage = LocalMediaStorage(settings)
        probe_path = storage.root / f".health-{secrets.token_hex(4)}"
        probe_path.write_text("ok", encoding="utf-8")
        probe_path.unlink(missing_ok=True)
    except PermissionError:
        media_status = "degraded"
        media_message = "Armazenamento de mídia sem permissão de escrita."
    except OSError as exc:
        media_status = "degraded"
        media_message = f"Armazenamento de mídia indisponível: {exc.__class__.__name__}."

    smtp_configured = bool(settings.smtp_host and settings.smtp_from)
    status_value = "ok" if database_status == "ok" and schema_status == "ok" and unifi_status == "ok" and media_status == "ok" and smtp_configured else "degraded"
    return {
        "status": status_value,
        "database": {"status": database_status},
        "schema": {"status": schema_status, "findings": schema_findings, "alembicRevision": alembic_revision},
        "unifi": {"status": unifi_status, "sites": unifi_sites, "message": unifi_error},
        "media": {"status": media_status, "message": media_message, "publicBaseUrl": settings.media_public_base_url},
        "smtp": {"configured": smtp_configured, "host": settings.smtp_host, "port": settings.smtp_port, "from": settings.smtp_from},
        "runtime": {
            "environment": settings.app_env,
            "adminEmailMfaRequired": settings.require_admin_email_mfa,
            "mediaPublicBaseUrl": settings.media_public_base_url,
            "publicBaseUrl": settings.public_base_url,
            "adminBaseUrl": settings.admin_base_url,
        },
    }


@router.post("/system-health/test-email", dependencies=[Depends(require_csrf)])
def test_system_email(payload: AdminEmailTestRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    settings = get_settings()
    subject = "Teste de e-mail do Portal Wi-Fi"
    text_body = (
        "Este e-mail confirma que o SMTP do Portal Wi-Fi conseguiu enviar mensagens.\n\n"
        f"Ambiente: {settings.app_env}\n"
        "Se você recebeu esta mensagem, o envio está operacional."
    )
    html_body = (
        "<p>Este e-mail confirma que o SMTP do Portal Wi-Fi conseguiu enviar mensagens.</p>"
        f"<p><strong>Ambiente:</strong> {settings.app_env}</p>"
        "<p>Se você recebeu esta mensagem, o envio está operacional.</p>"
    )
    try:
        send_email(str(payload.email), subject, text_body, html_body)
    except EmailDeliveryError as exc:
        audit(db, admin, "system_health.email_test_failed", "email", str(payload.email), {"reason": exc.reason})
        db.commit()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"Falha no envio de e-mail: {exc.reason}") from exc
    audit(db, admin, "system_health.email_test_sent", "email", str(payload.email), {"smtpHost": settings.smtp_host})
    db.commit()
    return {"ok": True, "sentTo": payload.email}


@router.get("/dashboard", response_model=DashboardSummary)
def dashboard(siteId: str | None = None, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    selected_sites = visible_site_filter(db, admin, siteId)
    site_filter = [GuestSession.site.in_(selected_sites)] if selected_sites is not None else []
    voucher_filter = [or_(Voucher.site_id.in_(selected_sites), Voucher.site.in_(selected_sites))] if selected_sites is not None else []
    notice_filter = [or_(PortalNotification.site == "ALL", PortalNotification.site.in_(selected_sites))] if selected_sites is not None else []
    maintenance_filter = [or_(MaintenanceConfig.id == "global", MaintenanceConfig.id.in_(selected_sites))] if selected_sites is not None else []
    counts = dashboard_counts(db, selected_sites)
    auth_attempts = db.execute(select(func.count(AuthAttempt.id))).scalar_one()
    auth_failures = db.execute(select(func.count(AuthAttempt.id)).where(AuthAttempt.success.is_(False))).scalar_one()
    vouchers_used = db.execute(select(func.coalesce(func.sum(Voucher.used_count), 0)).where(*voucher_filter)).scalar_one()
    vouchers_available = db.execute(select(func.count(Voucher.id)).where(Voucher.is_active.is_(True), or_(Voucher.expires_at.is_(None), Voucher.expires_at > now), *voucher_filter)).scalar_one()
    expiring_30 = db.execute(select(func.count(GuestSession.id)).where(GuestSession.status == SessionStatus.AUTHORIZED, GuestSession.expires_at > now, GuestSession.expires_at <= now + timedelta(minutes=30), *site_filter)).scalar_one()
    expiring_10 = db.execute(select(func.count(GuestSession.id)).where(GuestSession.status == SessionStatus.AUTHORIZED, GuestSession.expires_at > now, GuestSession.expires_at <= now + timedelta(minutes=10), *site_filter)).scalar_one()
    scheduled_maint = db.execute(select(func.count(MaintenanceConfig.id)).where(MaintenanceConfig.enabled.is_(True), MaintenanceConfig.start_at > now, *maintenance_filter)).scalar_one()
    active_notices = db.execute(select(func.count(PortalNotification.id)).where(PortalNotification.enabled.is_(True), or_(PortalNotification.starts_at.is_(None), PortalNotification.starts_at <= now), or_(PortalNotification.ends_at.is_(None), PortalNotification.ends_at > now), *notice_filter)).scalar_one()
    ended_today = db.execute(select(func.count(GuestSession.id)).where(or_(GuestSession.disconnected_at >= today_start, GuestSession.expires_at >= today_start), GuestSession.status.in_([SessionStatus.DISCONNECTED, SessionStatus.EXPIRED]), *site_filter)).scalar_one()
    average_session = counts["averageDurationSeconds"]
    return DashboardSummary(
        **counts,
        vouchersUsed=vouchers_used,
        vouchersAvailable=vouchers_available,
        authAttempts=auth_attempts,
        authFailures=auth_failures,
        onlineUsers=counts["connectedNow"],
        expiringIn30Minutes=expiring_30,
        expiringIn10Minutes=expiring_10,
        scheduledMaintenances=scheduled_maint,
        activeNotifications=active_notices,
        sessionsEndedToday=ended_today,
        averageSessionSeconds=average_session,
    )



@router.get("/sites/allowed", response_model=list[AllowedSiteResponse])
async def allowed_sites(db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    allowed = allowed_site_ids(db, admin)
    rows: list[AllowedSiteResponse] = []
    try:
        for site in await unifi_client.list_sites():
            site_id = _unifi_site_id(site)
            if not site_id:
                continue
            if allowed is not None and site_id not in allowed:
                continue
            rows.append(AllowedSiteResponse(siteId=site_id, name=_unifi_site_name(site), allowed=True))
    except UniFiError:
        for row in db.scalars(select(AdminSiteAccess).where(AdminSiteAccess.admin_id == admin.id).order_by(AdminSiteAccess.site_name_snapshot)).all():
            rows.append(AllowedSiteResponse(siteId=row.site_id, name=row.site_name_snapshot or row.site_id, allowed=True))
    return rows
@router.get("/sites", response_model=list[SiteNode])
async def sites(siteId: str | None = None, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    selected_sites = visible_site_filter(db, admin, siteId)
    try:
        rows = []
        for site in await unifi_client.list_sites():
            site_id = _unifi_site_id(site)
            if not site_id or (selected_sites is not None and site_id not in selected_sites):
                continue
            devices = await unifi_client.list_devices(site_id)
            clients = await unifi_client.list_clients(site_id)
            aps = await unifi_client.list_access_points(site_id)
            status = "connected" if devices or clients else "empty"
            rows.append(SiteNode(name=_unifi_site_name(site), siteId=site_id, status=status, aps=len(aps), connectedClients=len(clients), sessions=_site_session_count(db, site_id), authMethods=_portal_site_appearance(db, site_id, _unifi_site_name(site)).authMethods))
        return rows
    except UniFiError:
        configured = db.scalars(select(SiteProfile).order_by(SiteProfile.name)).all()
        return [SiteNode(name=site.name, siteId=site.slug or site.name, status="unavailable", aps=0, connectedClients=0, sessions=0, authMethods=_portal_site_appearance(db, site.slug or site.name, site.name).authMethods) for site in configured if selected_sites is None or site.slug in selected_sites or site.name in selected_sites]


@router.post("/vouchers", response_model=VoucherBatchCreateResponse, dependencies=[Depends(require_csrf)])
def create_vouchers(payload: VoucherCreateRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    selected_site, site_name = _voucher_site_payload(db, admin, payload.siteId, payload.site)
    max_devices = payload.maxDevices or payload.deviceLimit
    created = []
    for _ in range(payload.quantity):
        code = _new_voucher_code()
        normalized_code = _normalize_voucher_code(code)
        while db.scalar(select(Voucher).where(Voucher.code_hash.in_(_voucher_hash_candidates(code)))):
            code = _new_voucher_code()
            normalized_code = _normalize_voucher_code(code)
        voucher = Voucher(
            code_hash=secret_hash(normalized_code),
            code_label=_voucher_label(code),
            description=payload.description,
            duration_minutes=payload.durationMinutes,
            time_limit_minutes=payload.timeLimitMinutes,
            data_limit_mb=payload.dataLimitMb,
            download_limit=payload.downloadLimit,
            upload_limit=payload.uploadLimit,
            device_limit=payload.deviceLimit,
            max_devices=max_devices,
            site=site_name,
            site_id=selected_site,
            site_name_snapshot="Todos os sites" if selected_site == "ALL" else site_name,
            expires_at=payload.expiresAt,
            is_active=payload.enabled,
            created_by=admin.id,
        )
        db.add(voucher)
        db.flush()
        created.append(CreatedVoucherCode(id=voucher.id, code=code, codeLabel=voucher.code_label, site=voucher.site_name_snapshot or voucher.site, durationMinutes=voucher.duration_minutes, expiresAt=voucher.expires_at))
    audit(db, admin, "voucher.created", "voucher", "batch", {"siteId": selected_site, "siteName": site_name, "quantity": payload.quantity, "advancedLimitsStoredOnly": True})
    db.commit()
    return VoucherBatchCreateResponse(created=len(created), vouchers=created)


@router.get("/vouchers", response_model=list[VoucherResponse])
def list_vouchers(siteId: str | None = None, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    selected_sites = visible_site_filter(db, admin, siteId)
    query = select(Voucher).order_by(Voucher.created_at.desc())
    if selected_sites is not None:
        query = query.where(or_(Voucher.site_id.in_(selected_sites), Voucher.site.in_(selected_sites), Voucher.site_id == "ALL", Voucher.site == "ALL"))
    rows = db.scalars(query).all()
    return [_voucher_out(v) for v in rows]


@router.put("/vouchers/{voucher_id}", response_model=VoucherResponse, dependencies=[Depends(require_csrf)])
def update_voucher(voucher_id: str, payload: VoucherUpdateRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    voucher = db.get(Voucher, voucher_id)
    if not voucher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voucher não encontrado.")
    if (voucher.site_id or voucher.site) == "ALL":
        if admin.role != AdminRole.SUPERADMIN:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso ao site não permitido.")
    else:
        ensure_site_access(db, admin, voucher.site_id or voucher.site)
    if voucher.revoked_at and payload.enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Voucher revogado não pode ser reativado.")
    selected_site, site_name = _voucher_site_payload(db, admin, payload.siteId, payload.site)
    voucher.description = payload.description
    voucher.duration_minutes = payload.durationMinutes
    voucher.time_limit_minutes = payload.timeLimitMinutes
    voucher.data_limit_mb = payload.dataLimitMb
    voucher.download_limit = payload.downloadLimit
    voucher.upload_limit = payload.uploadLimit
    voucher.device_limit = payload.deviceLimit
    voucher.max_devices = payload.maxDevices or payload.deviceLimit
    voucher.site = site_name
    voucher.site_id = selected_site
    voucher.site_name_snapshot = "Todos os sites" if selected_site == "ALL" else site_name
    voucher.expires_at = payload.expiresAt
    voucher.is_active = payload.enabled and voucher.revoked_at is None
    audit(db, admin, "voucher.updated", "voucher", voucher.id, {"siteId": selected_site, "siteName": site_name})
    db.commit()
    db.refresh(voucher)
    return _voucher_out(voucher)

@router.post("/vouchers/{voucher_id}/revoke", response_model=VoucherResponse, dependencies=[Depends(require_csrf)])
def revoke_voucher(voucher_id: str, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    voucher = db.get(Voucher, voucher_id)
    if voucher:
        if (voucher.site_id or voucher.site) == "ALL":
            if admin.role != AdminRole.SUPERADMIN:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso ao site não permitido.")
        else:
            ensure_site_access(db, admin, voucher.site_id or voucher.site)
    if not voucher:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voucher não encontrado.")
    if voucher.revoked_at:
        return _voucher_out(voucher)
    voucher.is_active = False
    voucher.revoked_at = utcnow()
    voucher.revoked_by = admin.id
    audit(db, admin, "voucher.revoked", "voucher", voucher.id, {"site": voucher.site})
    db.commit()
    db.refresh(voucher)
    return _voucher_out(voucher)




@router.post("/media", response_model=MediaAssetResponse, dependencies=[Depends(require_csrf)])
async def upload_media(
    request: Request,
    assetType: str = Form(default="logo"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: AdminUser = Depends(require_role(AdminRole.ADMIN)),
):
    enforce_rate_limit(db, f"media:{admin.id}", client_ip(request), "admin-media-upload", max_attempts=30)
    stored = await LocalMediaStorage(get_settings()).store_upload(file, asset_type=assetType)
    row = MediaAsset(
        id=stored.id,
        asset_type=stored.asset_type,
        original_filename=stored.original_filename,
        stored_filename=stored.stored_filename,
        content_type=stored.content_type,
        byte_size=stored.byte_size,
        width=stored.width,
        height=stored.height,
        public_url=stored.public_url,
        created_by=admin.id,
        created_at=utcnow(),
    )
    db.add(row)
    audit(db, admin, "media.uploaded", "media", row.id, {"assetType": row.asset_type, "contentType": row.content_type, "byteSize": row.byte_size, "width": row.width, "height": row.height})
    db.commit()
    db.refresh(row)
    return _media_out(row)


@router.delete("/media/{media_id}", dependencies=[Depends(require_csrf)])
def delete_media(media_id: str, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    row = db.get(MediaAsset, media_id)
    if not row or row.deleted_at:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Imagem não encontrada.")
    row.deleted_at = utcnow()
    row.deleted_by = admin.id
    LocalMediaStorage(get_settings()).delete(row.stored_filename)
    audit(db, admin, "media.deleted", "media", row.id, {"assetType": row.asset_type})
    db.commit()
    return {"deleted": True, "id": row.id}


@router.get("/portal-appearance", response_model=PortalAppearanceResponse)
def get_portal_appearance(db: Session = Depends(get_db), _admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    return _portal_appearance(db)


@router.put("/portal-appearance", response_model=PortalAppearanceResponse, dependencies=[Depends(require_csrf)])
def update_portal_appearance(payload: PortalAppearanceRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    before = _portal_appearance(db).model_dump(mode="json")
    values = {
        "network_name": payload.networkName,
        "establishment_name": payload.establishmentName,
        "logo_url": payload.logoUrl,
        "primary_color": payload.primaryColor,
        "banner_text": payload.bannerText,
        "welcome_text": payload.welcomeText,
        "success_message": payload.successMessage,
        "expired_message": payload.expiredMessage,
        "terms_text": payload.termsText,
        "auth_methods": _auth_methods_json(payload.authMethods),
        "appearance_updated_at": utcnow().isoformat(),
    }
    for key, value in values.items():
        set_portal_setting(db, key, value)
    audit(db, admin, "portal_appearance.updated", "portal_settings", "appearance", {"before": before, "after": payload.model_dump(mode="json")})
    db.commit()
    return _portal_appearance(db)


@router.get("/portal-appearance/site/{site_id}", response_model=PortalSiteAppearanceResponse)
def get_site_portal_appearance(site_id: str, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    selected_site = ensure_site_access(db, admin, site_id)
    return _portal_site_appearance(db, selected_site or site_id)


@router.put("/portal-appearance/site/{site_id}", response_model=PortalSiteAppearanceResponse, dependencies=[Depends(require_csrf)])
def update_site_portal_appearance(site_id: str, payload: PortalSiteAppearanceRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    selected_site = ensure_site_access(db, admin, site_id)
    if selected_site is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "siteId obrigatorio.")
    row = db.scalar(select(PortalSiteSetting).where(PortalSiteSetting.site_id == selected_site))
    before = _portal_site_appearance(db, selected_site).model_dump(mode="json")
    if not row:
        row = PortalSiteSetting(site_id=selected_site)
        db.add(row)
    row.site_name = payload.siteName or selected_site
    row.display_name = payload.establishmentName
    row.logo_url = payload.logoUrl
    row.primary_color = payload.primaryColor
    row.public_title = payload.bannerText
    row.welcome_text = payload.welcomeText
    row.success_message = payload.successMessage
    row.reauthentication_message = payload.expiredMessage
    row.terms_text = payload.termsText
    row.auth_methods_json = _auth_methods_json(payload.authMethods)
    row.enabled = payload.enabled
    row.updated_at = utcnow()
    audit(db, admin, "portal_appearance.site_updated", "portal_site_settings", selected_site, {"siteId": selected_site, "before": before, "after": payload.model_dump(mode="json")})
    db.commit()
    return _portal_site_appearance(db, selected_site)

@router.delete("/portal-appearance/site/{site_id}", dependencies=[Depends(require_csrf)])
def delete_site_portal_appearance(site_id: str, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    selected_site = ensure_site_access(db, admin, site_id)
    if selected_site is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "siteId obrigatorio.")
    row = db.scalar(select(PortalSiteSetting).where(PortalSiteSetting.site_id == selected_site))
    if not row:
        return {"ok": True, "siteId": selected_site, "removed": False}
    before = _portal_site_appearance(db, selected_site).model_dump(mode="json")
    db.delete(row)
    audit(db, admin, "portal_appearance.site_deleted", "portal_site_settings", selected_site, {"siteId": selected_site, "before": before})
    db.commit()
    return {"ok": True, "siteId": selected_site, "removed": True}
@router.get("/maintenance", response_model=MaintenanceAdminResponse)
def get_maintenance(siteId: str | None = None, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    selected_site = ensure_site_access(db, admin, siteId, allow_all=True)
    if selected_site:
        site_row = db.get(MaintenanceConfig, selected_site)
        if site_row:
            return _maintenance_state(site_row, scope=selected_site)
        global_row = db.get(MaintenanceConfig, "global")
        if global_row:
            return _maintenance_state(global_row, scope="global", inherited=True)
        return _maintenance_state(None, scope=selected_site)
    return _maintenance_state(db.get(MaintenanceConfig, "global"), scope="global")


@router.put("/maintenance", response_model=MaintenanceAdminResponse, dependencies=[Depends(require_csrf)])
def update_maintenance(payload: MaintenanceUpdateRequest, siteId: str | None = None, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    selected_site = ensure_site_access(db, admin, siteId, allow_all=admin.role == AdminRole.SUPERADMIN)
    maintenance_id = selected_site or "global"
    row = db.get(MaintenanceConfig, maintenance_id)
    before = _maintenance_state(row).model_dump(mode="json") if row else {}
    if not row:
        row = MaintenanceConfig(id=maintenance_id)
        db.add(row)
    row.enabled = payload.maintenanceEnabled
    row.title = payload.maintenanceTitle
    row.message = payload.maintenanceMessage
    row.start_at = payload.maintenanceStartAt
    row.end_at = payload.maintenanceEndAt
    row.image_url = payload.maintenanceImageUrl
    row.visual_config_json = json.dumps(payload.maintenanceVisualConfig, separators=(",", ":"))
    row.updated_by = admin.id
    row.updated_at = utcnow()
    audit(db, admin, "maintenance.updated", "maintenance", maintenance_id, {"siteId": selected_site, "before": before, "after": payload.model_dump(mode="json")})
    db.commit()
    db.refresh(row)
    return _maintenance_state(row, scope=maintenance_id)



@router.get("/audit")
def audit_log(siteId: str | None = None, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    selected_sites = visible_site_filter(db, admin, siteId)
    rows = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(200)).all()
    visible = []
    for row in rows:
        site_label = _audit_site_label(row)
        if selected_sites is not None and site_label not in {"global", "ALL"} and site_label not in selected_sites:
            continue
        visible.append(_audit_out(row))
        if len(visible) >= 80:
            break
    return visible


@router.get("/auth-attempts", response_model=list[AuthAttemptResponse])
def auth_attempts(limit: int = Query(default=120, ge=1, le=300), db: Session = Depends(get_db), _admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    rows = db.scalars(select(AuthAttempt).order_by(AuthAttempt.created_at.desc()).limit(limit)).all()
    return [AuthAttemptResponse(id=row.id, method=row.method, success=row.success, reason=row.reason, createdAt=row.created_at) for row in rows]


@router.get("/maintenance/audit")
def maintenance_audit(db: Session = Depends(get_db), _admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    rows = db.scalars(select(AuditLog).where(AuditLog.target_type == "maintenance").order_by(AuditLog.created_at.desc()).limit(50)).all()
    return [_audit_out(row) for row in rows]


@router.post("/notifications", response_model=NotificationAdminResponse, dependencies=[Depends(require_csrf)])
def create_notification(payload: NotificationCreateRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    selected_site: str | None
    if payload.site == "ALL":
        if admin.role != AdminRole.SUPERADMIN:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas SUPERADMIN pode criar aviso global.")
        selected_site = "ALL"
    else:
        selected_site = ensure_site_access(db, admin, payload.site)
    row = PortalNotification(type=payload.type, title=payload.title, message=payload.message, starts_at=payload.startsAt, ends_at=payload.endsAt, site=selected_site or payload.site, enabled=payload.enabled, created_by=admin.id, updated_by=admin.id)
    db.add(row)
    audit(db, admin, "notification.created", "notification", row.id, {"siteId": selected_site, "type": payload.type.value})
    db.commit()
    db.refresh(row)
    return _notification_out(row)


@router.get("/notifications", response_model=list[NotificationAdminResponse])
def list_notifications(siteId: str | None = None, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    selected_sites = visible_site_filter(db, admin, siteId)
    query = select(PortalNotification).order_by(PortalNotification.created_at.desc()).limit(200)
    if selected_sites is not None:
        query = query.where(or_(PortalNotification.site == "ALL", PortalNotification.site.in_(selected_sites)))
    rows = db.scalars(query).all()
    return [_notification_out(row) for row in rows]


@router.put("/notifications/{notification_id}", response_model=NotificationAdminResponse, dependencies=[Depends(require_csrf)])
def update_notification(notification_id: str, payload: NotificationUpdateRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    row = db.get(PortalNotification, notification_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comunicado não encontrado.")
    if row.site == "ALL" and admin.role != AdminRole.SUPERADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso ao site não permitido.")
    if row.site != "ALL":
        ensure_site_access(db, admin, row.site)
    selected_site: str | None
    if payload.site == "ALL":
        if admin.role != AdminRole.SUPERADMIN:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas SUPERADMIN pode publicar aviso global.")
        selected_site = "ALL"
    else:
        selected_site = ensure_site_access(db, admin, payload.site)
    row.type = payload.type
    row.title = payload.title
    row.message = payload.message
    row.starts_at = payload.startsAt
    row.ends_at = payload.endsAt
    row.site = selected_site or payload.site
    row.enabled = payload.enabled
    row.updated_by = admin.id
    row.updated_at = utcnow()
    audit(db, admin, "notification.updated", "notification", row.id, {"siteId": selected_site, "type": payload.type.value})
    db.commit()
    db.refresh(row)
    return _notification_out(row)


@router.delete("/notifications/{notification_id}", dependencies=[Depends(require_csrf)])
def delete_notification(notification_id: str, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    row = db.get(PortalNotification, notification_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comunicado não encontrado.")
    if row.site == "ALL" and admin.role != AdminRole.SUPERADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso ao site não permitido.")
    if row.site != "ALL":
        ensure_site_access(db, admin, row.site)
    audit(db, admin, "notification.deleted", "notification", row.id, {"site": row.site, "type": row.type.value})
    db.delete(row)
    db.commit()
    return {"deleted": True}


@router.get("/sessions")
def list_sessions(siteId: str | None = None, q: str | None = None, status_filter: str | None = None, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    selected_sites = visible_site_filter(db, admin, siteId)
    query = select(GuestSession).order_by(GuestSession.created_at.desc()).limit(300)
    if selected_sites is not None:
        query = query.where(GuestSession.site.in_(selected_sites))
    sessions = db.scalars(query).all()
    rows = []
    needle = (q or "").strip().lower()
    for session in sessions:
        current_status = session.status.value.lower()
        remaining = seconds_remaining(session)
        if status_filter and status_filter != "all":
            if status_filter == "online" and not (session.status == SessionStatus.AUTHORIZED and remaining > 0):
                continue
            if status_filter == "expiring-30" and not (session.status == SessionStatus.AUTHORIZED and 0 < remaining <= 1800):
                continue
            if status_filter == "expiring-10" and not (session.status == SessionStatus.AUTHORIZED and 0 < remaining <= 600):
                continue
            if status_filter == "ended" and current_status != "disconnected":
                continue
            if status_filter == "expired" and current_status != "expired":
                continue
        searchable = " ".join([session.client_mac, session.name or "", session.ssid or "", session.site or "", session.ap_mac or ""]).lower()
        if needle and needle not in searchable:
            continue
        rows.append(
            {
                "id": session.id,
                "name": session.name,
                "clientMac": session.client_mac,
                "apMac": session.ap_mac,
                "ssid": session.ssid,
                "site": session.site,
                "method": session.authorization_method.value,
                "status": current_status,
                "createdAt": session.created_at,
                "authorizedAt": session.authorized_at,
                "expiresAt": session.expires_at,
                "disconnectedAt": session.disconnected_at,
                "endedAt": session.ended_at,
                "endedBy": session.ended_by,
                "adminEndReason": session.admin_end_reason,
                "reauthRequiredAt": session.reauth_required_at,
                "reauthReason": session.reauth_reason,
                "remainingSeconds": remaining,
                "durationSeconds": session.duration_seconds,
                "canEndAccess": bool(session.site and session.status == SessionStatus.AUTHORIZED),
                "canRequireReauth": bool(session.site and session.status == SessionStatus.AUTHORIZED),
                "canExtend": bool(session.site and session.status == SessionStatus.AUTHORIZED and remaining > 0),
                "canReauthorize": bool(session.site and session.status != SessionStatus.AUTHORIZED),
                "canBlock": bool(session.site and session.client_mac),
            }
        )
    return rows


@router.post("/sessions/{session_id}/reveal-sensitive", response_model=SensitiveSessionRevealResponse, dependencies=[Depends(require_csrf)])
def reveal_session_sensitive_data(session_id: str, payload: SensitiveSessionRevealRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.SUPERADMIN))):
    session = db.get(GuestSession, session_id)
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessão não encontrada.")
    fields = []
    email = decrypt_text(session.email_encrypted)
    cpf = decrypt_text(session.cpf_encrypted)
    phone = decrypt_text(session.phone_encrypted)
    if session.name:
        fields.append("name")
    if email:
        fields.append("email")
    if cpf:
        fields.append("cpf")
    if phone:
        fields.append("phone")
    audit(db, admin, "session.sensitive_revealed", "guest_session", session.id, {"reason": payload.reason, "fields": fields, "site": session.site})
    db.commit()
    return SensitiveSessionRevealResponse(sessionId=session.id, name=session.name or "", email=email, cpf=cpf, phone=phone, revealedAt=utcnow())


@router.post("/admins/invitations", response_model=AdminInviteResponse, dependencies=[Depends(require_csrf)])
def create_admin_invitation(payload: AdminInviteCreate, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.SUPERADMIN))):
    email = payload.email.lower()
    existing = db.scalar(select(AdminUser).where(AdminUser.email == email))
    if existing and existing.is_active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Administrador já existe.")
    require_invite_sites_for_role(payload.role, payload.siteIds)
    raw_token = random_token_urlsafe(48)
    expires_at = utcnow() + timedelta(hours=24)
    invite = AdminInvitation(email=email, name=payload.name, role=payload.role.value, token_hash=secret_hash(raw_token), invited_by=admin.id, admin_id=existing.id if existing else None, expires_at=expires_at, created_at=utcnow(), permitted_site_ids_json=json.dumps(payload.siteIds, separators=(",", ":")))
    db.add(invite)
    audit(db, admin, "admin_invitation.created", "admin_invitation", invite.id, {"email": email, "role": payload.role.value, "siteIds": payload.siteIds})
    db.commit()
    db.refresh(invite)
    invite_url = _invite_url(raw_token)
    delivery_status = "sent"
    try:
        text_body, html_body = admin_invitation_email(payload.name, invite_url, 24)
        send_email(email, "Convite para administrar o Portal Wi-Fi", text_body, html_body)
    except EmailDeliveryError:
        delivery_status = "email_failed"
    return _invite_out(invite, delivery_status, invite_url)


@router.get("/admins/invitations", response_model=list[AdminInviteResponse])
def list_admin_invitations(db: Session = Depends(get_db), _admin: AdminUser = Depends(require_role(AdminRole.SUPERADMIN))):
    rows = db.scalars(select(AdminInvitation).order_by(AdminInvitation.created_at.desc()).limit(100)).all()
    return [_invite_out(row, _invite_delivery_status(row)) for row in rows]






@router.post("/admins/invitations/{invite_id}/revoke", response_model=AdminInviteResponse, dependencies=[Depends(require_csrf)])
def revoke_admin_invitation(invite_id: str, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.SUPERADMIN))):
    invite = db.get(AdminInvitation, invite_id)
    if not invite:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Convite não encontrado.")
    if invite.accepted_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "Convite já utilizado não pode ser revogado.")
    if not invite.revoked_at:
        invite.revoked_at = utcnow()
        audit(db, admin, "admin_invitation.revoked", "admin_invitation", invite.id, {"email": invite.email, "role": invite.role})
        db.commit()
        db.refresh(invite)
    return _invite_out(invite, _invite_delivery_status(invite))


@router.post("/admins/invitations/{invite_id}/renew", response_model=AdminInviteResponse, dependencies=[Depends(require_csrf)])
def renew_admin_invitation(invite_id: str, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.SUPERADMIN))):
    invite = db.get(AdminInvitation, invite_id)
    if not invite:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Convite não encontrado.")
    if invite.accepted_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "Convite já utilizado não pode gerar novo link.")
    raw_token = random_token_urlsafe(48)
    invite.token_hash = secret_hash(raw_token)
    invite.expires_at = utcnow() + timedelta(hours=24)
    invite.revoked_at = None
    invite_url = _invite_url(raw_token)
    delivery_status = "sent"
    try:
        text_body, html_body = admin_invitation_email(invite.name, invite_url, 24)
        send_email(invite.email, "Convite para administrar o Portal Wi-Fi", text_body, html_body)
    except EmailDeliveryError:
        delivery_status = "email_failed"
    audit(db, admin, "admin_invitation.renewed", "admin_invitation", invite.id, {"email": invite.email, "role": invite.role})
    db.commit()
    db.refresh(invite)
    return _invite_out(invite, delivery_status, invite_url)


@router.get("/admins/invitations/validate", response_model=AdminInviteValidateResponse)
def validate_admin_invitation(token: str = Query(default="", max_length=256), db: Session = Depends(get_db)):
    invite = _invite_for_token(db, token)
    return AdminInviteValidateResponse(
        email=invite.email,
        name=invite.name,
        role=AdminRole(invite.role),
        expiresAt=invite.expires_at,
        siteIds=invitation_sites(invite.permitted_site_ids_json),
    )


@router.post("/admins/invitations/accept", response_model=AdminMe)
def accept_admin_invitation(payload: AdminInviteAcceptRequest, db: Session = Depends(get_db)):
    invite = _invite_for_token(db, payload.token)
    now = _now_for_expires_at(invite.expires_at)
    admin = db.get(AdminUser, invite.admin_id) if invite.admin_id else None
    existing = db.scalar(select(AdminUser).where(AdminUser.email == invite.email, AdminUser.id != invite.admin_id))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Administrador já existe para este e-mail.")
    if not admin:
        admin = AdminUser(email=invite.email, name=invite.name, role=AdminRole(invite.role), password_hash=hash_password(payload.password), is_active=True)
        db.add(admin)
        db.flush()
        invite.admin_id = admin.id
    else:
        admin.name = invite.name
        admin.role = AdminRole(invite.role)
        admin.password_hash = hash_password(payload.password)
        admin.is_active = True
        admin.updated_at = now
    invite.accepted_at = now
    site_ids = invitation_sites(invite.permitted_site_ids_json)
    if admin.role != AdminRole.SUPERADMIN:
        replace_admin_site_access(db, target_admin_id=admin.id, site_ids=site_ids, site_names={}, granted_by=invite.invited_by)
    db.add(AuditLog(actor_id=admin.id, event="admin_invitation.accepted", target_type="admin_invitation", target_id=invite.id, metadata_json=json.dumps({"email": invite.email, "role": invite.role, "siteIds": site_ids}, separators=(",", ":"))))
    db.commit()
    db.refresh(admin)
    return admin_out(admin, db)


@router.put("/admins/{admin_id}/site-access", dependencies=[Depends(require_csrf)])
def update_admin_site_access(admin_id: str, payload: AdminSiteAccessUpdateRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.SUPERADMIN))):
    target = db.get(AdminUser, admin_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Administrador não encontrado.")
    if target.role == AdminRole.SUPERADMIN:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "SUPERADMIN sempre possui acesso global.")
    replace_admin_site_access(db, target_admin_id=target.id, site_ids=payload.siteIds, site_names={}, granted_by=admin.id)
    audit(db, admin, "admin.site_access_granted", "admin", target.id, {"siteIds": payload.siteIds})
    db.commit()
    return {"ok": True, "siteIds": payload.siteIds}
@router.get("/admins")
def list_admins(_admin: AdminUser = Depends(require_role(AdminRole.SUPERADMIN)), db: Session = Depends(get_db)):
    rows = db.scalars(select(AdminUser).order_by(AdminUser.created_at.desc())).all()
    return [
        {
            "id": row.id,
            "name": row.name,
            "email": row.email,
            "role": row.role.value,
            "status": "active" if row.is_active else "inactive",
            "mfa": "not_configured",
            "createdAt": row.created_at,
            "lastLogin": None,
        }
        for row in rows
    ]


@router.get("/users")
async def list_users(siteId: str | None = None, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    selected_sites = visible_site_filter(db, admin, siteId)
    rows: list[dict[str, Any]] = []
    for site in await unifi_client.list_sites():
        site_id = _unifi_site_id(site)
        if not site_id or (selected_sites is not None and site_id not in selected_sites):
            continue
        for client in await unifi_client.list_clients(site_id):
            rows.append(
                {
                    "id": _client_id(client),
                    "mac": _client_mac(client),
                    "ip": client.get("ipAddress") or client.get("ip"),
                    "name": client.get("name") or client.get("hostname"),
                    "siteId": site_id,
                    "siteName": _unifi_site_name(site),
                    "apMac": _client_ap_mac(client),
                    "authorized": _client_authorized(client),
                    "ssid": (client.get("wifiConnection") or {}).get("ssid") or client.get("ssid") or client.get("essid"),
                    "signal": client.get("signal"),
                    **_client_portal_session(db, _client_mac(client)),
                }
            )
    return rows


@router.get("/access-points")
async def list_access_points(siteId: str | None = None, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    selected_sites = visible_site_filter(db, admin, siteId)
    rows: list[dict[str, Any]] = []
    for site in await unifi_client.list_sites():
        site_id = _unifi_site_id(site)
        if not site_id or (selected_sites is not None and site_id not in selected_sites):
            continue
        clients = await unifi_client.list_clients(site_id)
        client_count_by_ap: dict[str, int] = {}
        for client in clients:
            ap_mac = _client_ap_mac(client).lower()
            if ap_mac:
                client_count_by_ap[ap_mac] = client_count_by_ap.get(ap_mac, 0) + 1
        for ap in await unifi_client.list_access_points(site_id):
            mac = _device_mac(ap)
            radio = ap.get("radio") or ap.get("radioTable") or {}
            rows.append(
                {
                    "id": _device_id(ap),
                    "name": ap.get("name") or ap.get("displayName"),
                    "model": ap.get("model") or ap.get("modelName"),
                    "mac": mac,
                    "ip": ap.get("ipAddress") or ap.get("ip"),
                    "siteId": site_id,
                    "siteName": _unifi_site_name(site),
                    "status": _device_status(ap),
                    "uptime": ap.get("uptime") or ap.get("upTime"),
                    "clientes": client_count_by_ap.get(mac.lower(), None),
                    "canal": ap.get("channel") or radio.get("channel"),
                    "banda": ap.get("band") or radio.get("band"),
                }
            )
    return rows


def _operation_response(session_id: str, result) -> SessionOperationResponse:
    return SessionOperationResponse(
        status=result.status,
        unifiConfirmed=result.unifi_confirmed,
        message=result.message,
        sessionId=session_id,
        operationState=result.operation_state,
        blockId=result.block_id,
        newSessionId=result.new_session_id,
        expiresAt=result.expires_at,
    )


@router.post("/sessions/{session_id}/end", response_model=SessionOperationResponse, dependencies=[Depends(require_csrf)])
async def end_guest_session(session_id: str, payload: SessionActionRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    result = await end_session(db, session_id=session_id, admin=admin, reason=payload.reason)
    return _operation_response(session_id, result)


@router.post("/sessions/{session_id}/require-reauthentication", response_model=SessionOperationResponse, dependencies=[Depends(require_csrf)])
async def require_guest_reauthentication(session_id: str, payload: SessionActionRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    result = await require_reauthentication(db, session_id=session_id, admin=admin, reason=payload.reason)
    return _operation_response(session_id, result)


@router.post("/sessions/{session_id}/extend", response_model=SessionOperationResponse, dependencies=[Depends(require_csrf)])
async def extend_guest_session(session_id: str, payload: SessionExtendRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    result = await extend_session(db, session_id=session_id, admin=admin, additional_minutes=payload.additionalMinutes, reason=payload.reason)
    return _operation_response(session_id, result)


@router.post("/sessions/{session_id}/reauthorize", response_model=SessionOperationResponse, dependencies=[Depends(require_csrf)])
async def reauthorize_guest_session(session_id: str, payload: SessionReauthorizeRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    result = await reauthorize_session(db, session_id=session_id, admin=admin, duration_minutes=payload.durationMinutes, reason=payload.reason)
    return _operation_response(session_id, result)


@router.post("/sessions/{session_id}/block", response_model=SessionOperationResponse, dependencies=[Depends(require_csrf)])
async def block_guest_session(session_id: str, payload: SessionBlockRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    result = await block_session_identity(db, session_id=session_id, admin=admin, scope=payload.scope, duration_minutes=payload.durationMinutes, reason=payload.reason)
    return _operation_response(session_id, result)


@router.post("/blocks/{block_id}/revoke", response_model=SessionOperationResponse, dependencies=[Depends(require_csrf)])
def revoke_access_block(block_id: str, payload: SessionActionRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    result = unblock_identity(db, block_id=block_id, admin=admin, reason=payload.reason)
    return _operation_response(block_id, result)

@router.get("/dashboard/charts")
def dashboard_charts(siteId: str | None = None, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    now = utcnow()
    start = now - timedelta(days=29)
    selected_sites = visible_site_filter(db, admin, siteId)
    site_filter = [GuestSession.site.in_(selected_sites)] if selected_sites is not None else []
    rows = db.scalars(select(GuestSession).where(GuestSession.created_at >= start, *site_filter).order_by(GuestSession.created_at.asc())).all()

    days = {}
    for index in range(30):
        day = (start + timedelta(days=index)).date().isoformat()
        days[day] = 0
    method_counts = {"VOUCHER": 0, "CPF": 0, "EMAIL": 0, "PROVISIONAL": 0}
    longest = []
    for session in rows:
        day_key = session.created_at.date().isoformat()
        if day_key in days:
            days[day_key] += 1
        method = getattr(session.authorization_method, "value", str(session.authorization_method)).upper()
        method_counts[method] = method_counts.get(method, 0) + 1
        duration = session.duration_seconds or 0
        if not duration and session.authorized_at and session.expires_at:
            duration = max(0, int((session.expires_at - session.authorized_at).total_seconds()))
        if duration > 0:
            label = session.name.strip() if session.name else f"Dispositivo {session.client_mac[-8:]}"
            longest.append({"sessionId": session.id, "label": label, "site": session.site, "method": method, "durationSeconds": duration})

    connections_by_day = [{"date": day, "label": day[5:], "count": count} for day, count in days.items()]
    ranked_days = sorted(connections_by_day, key=lambda item: cast(int, item["count"]), reverse=True)
    quiet_days = sorted(connections_by_day, key=lambda item: (cast(int, item["count"]), cast(str, item["date"])))
    return {
        "connectionsByDay": connections_by_day,
        "bestDays": ranked_days[:5],
        "quietDays": quiet_days[:5],
        "authMethods": [{"method": method.lower(), "count": count} for method, count in method_counts.items() if count > 0],
        "longestSessions": sorted(longest, key=lambda item: cast(int, item["durationSeconds"]), reverse=True)[:5],
        "periodDays": 30,
    }
