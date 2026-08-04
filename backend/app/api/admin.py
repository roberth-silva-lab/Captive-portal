import json
import secrets
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, current_admin, require_csrf, require_role
from app.core.config import get_settings
from app.core.database import get_db
from app.integrations.email.service import EmailDeliveryError, admin_invitation_email, send_email
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
    PortalNotification,
    PortalSetting,
    PortalSiteSetting,
    SessionStatus,
    SiteProfile,
    Voucher,
)
from app.models.entities import utcnow
from app.schemas.admin import (
    AdminInviteAcceptRequest,
    AdminInviteCreate,
    AdminInviteResponse,
    AdminLoginRequest,
    AdminMe,
    AdminSiteAccessUpdateRequest,
    AllowedSiteResponse,
    CreatedVoucherCode,
    DashboardSummary,
    MaintenanceAdminResponse,
    MaintenanceUpdateRequest,
    NotificationAdminResponse,
    NotificationCreateRequest,
    NotificationUpdateRequest,
    PortalAppearanceRequest,
    PortalAppearanceResponse,
    PortalSiteAppearanceRequest,
    PortalSiteAppearanceResponse,
    SiteNode,
    VoucherBatchCreateResponse,
    VoucherCreateRequest,
    VoucherResponse,
)
from app.security.passwords import hash_password, verify_password
from app.security.tokens import random_token_urlsafe, secret_hash
from app.services.rate_limit import enforce_rate_limit, record_attempt
from app.services.sessions import dashboard_counts, duration_between, seconds_remaining
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
    "success_message": "Acesso liberado. Voce ja pode navegar na Internet.",
    "expired_message": "Sua sessao expirou. Autentique-se novamente para continuar usando o Wi-Fi.",
    "terms_text": "Ao continuar, voce aceita os termos de uso da rede.",
}


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
        updatedAt=(row.updated_at if row else base.updatedAt),
    )
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
def _maintenance_state(row: MaintenanceConfig | None) -> MaintenanceAdminResponse:
    now = utcnow()
    if (row and row.start_at and row.start_at.tzinfo is None) or (row and row.end_at and row.end_at.tzinfo is None):
        now = now.replace(tzinfo=None)
    if not row:
        return MaintenanceAdminResponse(maintenanceEnabled=False, maintenanceActive=False, maintenanceScheduled=False, maintenanceTitle="Portal em manutencao", maintenanceMessage="Estamos realizando ajustes para melhorar o acesso.")
    started = row.start_at is None or row.start_at <= now
    not_ended = row.end_at is None or row.end_at > now
    return MaintenanceAdminResponse(
        maintenanceEnabled=row.enabled,
        maintenanceActive=row.enabled and started and not_ended,
        maintenanceScheduled=row.enabled and row.start_at is not None and row.start_at > now,
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
    return str(uplink.get("macAddress") or uplink.get("mac") or wifi.get("apMacAddress") or row.get("apMac") or "")


def _client_authorized(row: dict[str, Any]) -> bool:
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


def _voucher_label(code: str) -> str:
    return code

def _notification_out(row: PortalNotification) -> NotificationAdminResponse:
    return NotificationAdminResponse(id=row.id, type=row.type, title=row.title, message=row.message, startsAt=row.starts_at, endsAt=row.ends_at, site=row.site, enabled=row.enabled, createdAt=row.created_at, updatedAt=row.updated_at)


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


@router.post("/login", response_model=AdminMe)
def login(payload: AdminLoginRequest, response: Response, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    enforce_rate_limit(db, payload.email, ip, "admin-login", max_attempts=5)
    admin = db.scalar(select(AdminUser).where(AdminUser.email == payload.email.lower(), AdminUser.is_active.is_(True)))
    if not admin or not verify_password(payload.password, admin.password_hash):
        record_attempt(db, payload.email, ip, "admin-login", False, "invalid_credentials")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciais invalidas.")
    settings = get_settings()
    raw_session = random_token_urlsafe()
    raw_csrf = random_token_urlsafe()
    db.add(AdminSession(id=secret_hash(raw_session), admin_id=admin.id, csrf_hash=secret_hash(raw_csrf), expires_at=utcnow() + timedelta(minutes=settings.admin_session_minutes)))
    db.commit()
    secure = settings.is_production
    response.set_cookie(settings.session_cookie_name, raw_session, httponly=True, secure=secure, samesite="lax", max_age=settings.admin_session_minutes * 60)
    response.set_cookie(settings.csrf_cookie_name, raw_csrf, httponly=False, secure=secure, samesite="lax", max_age=settings.admin_session_minutes * 60)
    record_attempt(db, payload.email, ip, "admin-login", True)
    return admin_out(admin, db)


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
            rows.append(SiteNode(name=_unifi_site_name(site), siteId=site_id, status=status, aps=len(aps), connectedClients=len(clients), sessions=_site_session_count(db, site_id)))
        return rows
    except UniFiError:
        configured = db.scalars(select(SiteProfile).order_by(SiteProfile.name)).all()
        return [SiteNode(name=site.name, siteId=site.slug or site.name, status="unavailable", aps=0, connectedClients=0, sessions=0) for site in configured if selected_sites is None or site.slug in selected_sites or site.name in selected_sites]


@router.post("/vouchers", response_model=VoucherBatchCreateResponse, dependencies=[Depends(require_csrf)])
def create_vouchers(payload: VoucherCreateRequest, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    selected_site = ensure_site_access(db, admin, payload.siteId or payload.site)
    site_name = payload.site
    max_devices = payload.maxDevices or payload.deviceLimit
    created = []
    for _ in range(payload.quantity):
        code = _new_voucher_code()
        while db.scalar(select(Voucher).where(Voucher.code_hash == secret_hash(code))):
            code = _new_voucher_code()
        voucher = Voucher(
            code_hash=secret_hash(code),
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
            site_name_snapshot=site_name,
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
        query = query.where(or_(Voucher.site_id.in_(selected_sites), Voucher.site.in_(selected_sites)))
    rows = db.scalars(query).all()
    return [_voucher_out(v) for v in rows]


@router.post("/vouchers/{voucher_id}/revoke", response_model=VoucherResponse, dependencies=[Depends(require_csrf)])
def revoke_voucher(voucher_id: str, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    voucher = db.get(Voucher, voucher_id)
    if voucher:
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
    return _maintenance_state(db.get(MaintenanceConfig, selected_site or "global"))


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
    return _maintenance_state(row)



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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comunicado nao encontrado.")
    if row.site == "ALL" and admin.role != AdminRole.SUPERADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso ao site nao permitido.")
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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comunicado nao encontrado.")
    if row.site == "ALL" and admin.role != AdminRole.SUPERADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso ao site nao permitido.")
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
                "remainingSeconds": remaining,
                "durationSeconds": session.duration_seconds,
                "canEndAccess": bool(session.site and session.unifi_client_id and session.status == SessionStatus.AUTHORIZED),
            }
        )
    return rows


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
    return [_invite_out(row) for row in rows]


@router.post("/admins/invitations/accept", response_model=AdminMe)
def accept_admin_invitation(payload: AdminInviteAcceptRequest, db: Session = Depends(get_db)):
    invite = db.scalar(select(AdminInvitation).where(AdminInvitation.token_hash == secret_hash(payload.token)))
    now = utcnow()
    if not invite:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Convite inválido ou expirado.")
    expires_at = invite.expires_at
    if expires_at.tzinfo is None:
        now = now.replace(tzinfo=None)
    if invite.revoked_at or invite.accepted_at or expires_at <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Convite inválido ou expirado.")
    admin = db.get(AdminUser, invite.admin_id) if invite.admin_id else None
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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Administrador nao encontrado.")
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
                    "ssid": (client.get("wifiConnection") or {}).get("ssid") or client.get("ssid"),
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


@router.post("/sessions/{session_id}/end", dependencies=[Depends(require_csrf)])
async def end_guest_session(session_id: str, db: Session = Depends(get_db), admin: AdminUser = Depends(require_role(AdminRole.ADMIN))):
    session = db.get(GuestSession, session_id)
    if session:
        ensure_site_access(db, admin, session.site)
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessao nao encontrada.")
    if not session.site or not session.unifi_client_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sessao sem contexto UniFi para encerramento.")
    await unifi_client.unauthorize_guest(site_id=session.site, client_id=session.unifi_client_id)
    try:
        confirmed = await unifi_client.get_client_by_mac(session.site, session.client_mac)
        if confirmed.authorized:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "UniFi ainda informa cliente autorizado.")
    except UniFiError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Nao foi possivel confirmar encerramento no UniFi.") from exc
    now = utcnow()
    session.status = SessionStatus.DISCONNECTED
    session.disconnected_at = now
    session.duration_seconds = duration_between(session.authorized_at or session.created_at, now)
    audit(db, admin, "session.ended", "guest_session", session.id, {"site": session.site})
    db.commit()
    return {"ok": True}


@router.get("/dashboard/charts")
def dashboard_charts(_admin: AdminUser = Depends(require_role(AdminRole.VIEWER))):
    return {"authMethods": [], "visitorsByDay": [], "connectionsByHour": [], "bandwidthByHour": [], "bandwidthAvailable": False}