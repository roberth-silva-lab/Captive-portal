import asyncio
import json
import logging
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip
from app.core.config import get_settings
from app.core.database import get_db
from app.integrations.email import EmailDeliveryError, send_email
from app.integrations.email.service import wifi_code_email
from app.integrations.unifi import UniFiError, unifi_client
from app.models import (
    AuthorizationMethod,
    EmailLoginCode,
    GuestSession,
    MaintenanceConfig,
    MediaAsset,
    NotificationType,
    PortalNotification,
    PortalSetting,
    PortalSiteSetting,
    SessionStatus,
    Voucher,
)
from app.models.entities import utcnow
from app.schemas.public import (
    AuthResponse,
    CpfAuthRequest,
    EmailCodeRequest,
    EmailCodeVerify,
    MaintenanceResponse,
    NotificationResponse,
    PortalSettingsResponse,
    ProvisionalAccessRequest,
    SessionStatusResponse,
    VoucherAuthRequest,
)
from app.security.tokens import random_token_urlsafe, secret_hash
from app.services.media_storage import LocalMediaStorage
from app.services.rate_limit import enforce_rate_limit, record_attempt
from app.services.session_operations import active_block_for_client
from app.services.sessions import authorize_session, duration_between, seconds_remaining

router = APIRouter(prefix="/api", tags=["public"])
logger = logging.getLogger(__name__)
media_router = APIRouter(tags=["media"])
EXPIRATION_WARNINGS = [30, 10, 5]


def _ensure_client_not_blocked(db: Session, *, client_mac: str, site_id: str) -> None:
    if active_block_for_client(db, client_mac=client_mac, site_id=site_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "O acesso deste dispositivo está temporariamente bloqueado.")

def portal_setting(db: Session, key: str, default: str) -> str:
    row = db.get(PortalSetting, key)
    return row.value if row else default


def _json_dict(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def _same_window(now, starts_at, ends_at) -> tuple[bool, bool]:
    if (starts_at and starts_at.tzinfo is None) or (ends_at and ends_at.tzinfo is None):
        now = now.replace(tzinfo=None)
    started = starts_at is None or starts_at <= now
    not_ended = ends_at is None or ends_at > now
    active = started and not_ended
    scheduled = starts_at is not None and starts_at > now
    return active, scheduled


def get_maintenance(db: Session, site_id: str | None = None) -> MaintenanceResponse:
    row = db.get(MaintenanceConfig, site_id) if site_id else None
    if not row:
        row = db.get(MaintenanceConfig, "global")
    if not row:
        return MaintenanceResponse()
    active, scheduled = _same_window(utcnow(), row.start_at, row.end_at)
    active = row.enabled and active
    return MaintenanceResponse(
        enabled=row.enabled,
        active=active,
        scheduled=row.enabled and scheduled,
        title=row.title,
        message=row.message,
        startsAt=row.start_at,
        endsAt=row.end_at,
        imageUrl=row.image_url,
        visualConfig=_json_dict(row.visual_config_json),
    )


def active_notifications(db: Session, site: str | None = None) -> list[NotificationResponse]:
    now = utcnow()
    selected_site = site or "Default"
    rows = db.scalars(
        select(PortalNotification)
        .where(
            PortalNotification.enabled.is_(True),
            or_(PortalNotification.starts_at.is_(None), PortalNotification.starts_at <= now),
            or_(PortalNotification.ends_at.is_(None), PortalNotification.ends_at > now),
            PortalNotification.site.in_(["ALL", selected_site]),
        )
        .order_by(PortalNotification.created_at.desc())
    ).all()
    return [
        NotificationResponse(id=row.id, type=row.type, title=row.title, message=row.message, startsAt=row.starts_at, endsAt=row.ends_at, site=row.site)
        for row in rows
    ]


def ensure_not_in_maintenance(db: Session, site_id: str | None = None) -> None:
    maintenance = get_maintenance(db, site_id)
    if maintenance.active:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, maintenance.message or "Portal temporariamente em manutenção.")



VALID_AUTH_METHODS = {"voucher", "cpf", "email"}
DEFAULT_AUTH_METHODS = ["voucher", "cpf", "email"]


def _normalize_voucher_code(code: str) -> str:
    return "".join(char for char in code.strip().upper() if char.isalnum())


def _voucher_hash_candidates(code: str) -> set[str]:
    normalized = _normalize_voucher_code(code)
    candidates = {normalized, code.strip().upper()}
    if normalized.startswith("RF") and len(normalized) == 10:
        candidates.add(f"RF-{normalized[2:6]}-{normalized[6:10]}")
    return {secret_hash(candidate) for candidate in candidates if candidate}


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


def _site_setting_value(row: PortalSiteSetting | None, attr: str, fallback: str) -> str:
    value = getattr(row, attr, "") if row else ""
    return value or fallback


def allowed_auth_methods(db: Session, site_id: str | None = None) -> list[str]:
    row = db.scalar(select(PortalSiteSetting).where(PortalSiteSetting.site_id == site_id, PortalSiteSetting.enabled.is_(True))) if site_id else None
    if row:
        return _auth_methods_from_json(row.auth_methods_json)
    return _auth_methods_from_json(portal_setting(db, "auth_methods", '["voucher","cpf","email"]'))


def ensure_auth_method_allowed(db: Session, site_id: str | None, method: str) -> None:
    if method.lower() not in allowed_auth_methods(db, site_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esta forma de acesso não está habilitada para esta unidade.")


@media_router.get("/media/{media_id}")
def get_media(media_id: str, db: Session = Depends(get_db)):
    row = db.get(MediaAsset, media_id)
    if not row or row.deleted_at:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Imagem não encontrada.")
    path = LocalMediaStorage(get_settings()).public_path(row.stored_filename)
    if not path.exists() or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Imagem não encontrada.")
    return FileResponse(path, media_type=row.content_type, filename=row.stored_filename, headers={"Cache-Control": "public, max-age=86400"})


@router.get("/settings", response_model=PortalSettingsResponse)
async def settings(site: str | None = None, clientMac: str | None = None, apMac: str | None = None, db: Session = Depends(get_db)):
    site_id = site
    if clientMac:
        try:
            context = await unifi_client.resolve_client_context(client_mac=clientMac, ap_mac=apMac, requested_site=None)
            site_id = context.site_id
        except UniFiError:
            site_id = site
    site_row = db.scalar(select(PortalSiteSetting).where(PortalSiteSetting.site_id == site_id, PortalSiteSetting.enabled.is_(True))) if site_id else None
    maintenance = get_maintenance(db, site_id)
    notices = active_notifications(db, site_id)
    if maintenance.enabled and maintenance.scheduled:
        notices.insert(
            0,
            NotificationResponse(
                id="maintenance-scheduled",
                type=NotificationType.MAINTENANCE,
                title=maintenance.title or "Manutencao programada",
                message=maintenance.message or "O portal passará por manutenção programada.",
                startsAt=maintenance.startsAt,
                endsAt=maintenance.endsAt,
                site=site_id or "ALL",
            ),
        )
    return PortalSettingsResponse(
        networkName=portal_setting(db, "network_name", "Wi-Fi Visitante"),
        establishmentName=_site_setting_value(site_row, "display_name", portal_setting(db, "establishment_name", "Gabinete Itinerante")),
        logoUrl=_site_setting_value(site_row, "logo_url", portal_setting(db, "logo_url", "")),
        primaryColor=_site_setting_value(site_row, "primary_color", portal_setting(db, "primary_color", "#176b87")),
        bannerText=_site_setting_value(site_row, "public_title", portal_setting(db, "banner_text", "Portal de Acesso Wi-Fi")),
        welcomeText=_site_setting_value(site_row, "welcome_text", portal_setting(db, "welcome_text", "Conecte-se de forma segura a rede de visitantes.")),
        termsText=_site_setting_value(site_row, "terms_text", portal_setting(db, "terms_text", "Ao continuar, você aceita os termos de uso da rede.")),
        maintenanceMode=maintenance.active,
        maintenance=maintenance,
        notifications=notices,
        expirationWarningMinutes=EXPIRATION_WARNINGS,
        allowedAuthMethods=allowed_auth_methods(db, site_id),
    )

async def _confirm_unifi_authorized(site_id: str, client_mac: str, *, attempts: int = 6, delay_seconds: float = 0.35):
    last = None
    for attempt in range(attempts):
        last = await unifi_client.get_client_by_mac(site_id, client_mac)
        if last.authorized:
            return last
        if attempt < attempts - 1:
            await asyncio.sleep(delay_seconds)
    raise UniFiError("UniFi não confirmou authorized=true para o cliente.")


async def _authorize_unifi(db_or_payload, payload_or_minutes, minutes: int | None = None, data_limit_mb: int | None = None, download_limit: int | None = None, upload_limit: int | None = None, requested_site: str | None = None, auth_method: str | None = None) -> tuple[str, str]:
    db = db_or_payload if isinstance(db_or_payload, Session) else None
    payload = payload_or_minutes if db is not None else db_or_payload
    selected_minutes = minutes if db is not None else int(payload_or_minutes)
    if selected_minutes is None:
        raise UniFiError("Duração de autorização ausente.")
    context = await unifi_client.resolve_client_context(
        client_mac=payload.clientMac,
        ap_mac=payload.apMac,
        requested_site=requested_site,
    )
    if db is not None:
        ensure_not_in_maintenance(db, context.site_id)
        if auth_method:
            ensure_auth_method_allowed(db, context.site_id, auth_method)
        _ensure_client_not_blocked(db, client_mac=payload.clientMac, site_id=context.site_id)
    await unifi_client.authorize_guest(site_id=context.site_id, client_id=context.client_id, minutes=selected_minutes, data_limit_mb=data_limit_mb, rx_kbps=download_limit, tx_kbps=upload_limit)
    confirmed = await _confirm_unifi_authorized(context.site_id, payload.clientMac)
    return context.site_id, confirmed.id


def _auth_response(session: GuestSession, minutes: int) -> AuthResponse:
    if session.expires_at is None or session.authorized_at is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Sessão sem confirmação de autorização.")
    total_seconds = duration_between(session.authorized_at, session.expires_at)
    return AuthResponse(
        sessionId=session.id,
        sessionMinutes=minutes,
        authorizedAt=session.authorized_at,
        expiresAt=session.expires_at,
        remainingSeconds=seconds_remaining(session),
        totalSeconds=total_seconds,
        authorized=True,
    )


@router.post("/auth/voucher", response_model=AuthResponse)
async def auth_voucher(payload: VoucherAuthRequest, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    enforce_rate_limit(db, payload.clientMac, ip, "voucher")
    code_hashes = _voucher_hash_candidates(payload.code)
    now = utcnow()
    voucher = db.scalar(select(Voucher).where(Voucher.code_hash.in_(code_hashes), Voucher.is_active.is_(True)))
    if not voucher or (voucher.expires_at and voucher.expires_at <= now):
        record_attempt(db, payload.clientMac, ip, "voucher", False, "invalid_voucher")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Voucher inválido.")
    try:
        context = await unifi_client.resolve_client_context(client_mac=payload.clientMac, ap_mac=payload.apMac, requested_site=None)
    except UniFiError as exc:
        record_attempt(db, payload.clientMac, ip, "voucher", False, "unifi_error")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Não foi possível identificar o site real no UniFi.") from exc
    ensure_not_in_maintenance(db, context.site_id)
    voucher_site = voucher.site_id or voucher.site
    if voucher_site and voucher_site not in {"ALL", "global", context.site_id, context.site_name}:
        record_attempt(db, payload.clientMac, ip, "voucher", False, "site_mismatch")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Este voucher não é válido para esta unidade.")
    ensure_auth_method_allowed(db, context.site_id, "voucher")
    _ensure_client_not_blocked(db, client_mac=payload.clientMac, site_id=context.site_id)
    used_devices = db.scalars(select(GuestSession.client_mac).where(GuestSession.voucher_id == voucher.id).distinct()).all()
    max_devices = voucher.max_devices or voucher.device_limit
    if payload.clientMac not in used_devices and len(used_devices) >= max_devices:
        record_attempt(db, payload.clientMac, ip, "voucher", False, "device_limit")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Limite de dispositivos do voucher atingido.")
    minutes = voucher.time_limit_minutes or voucher.duration_minutes
    try:
        await unifi_client.authorize_guest(site_id=context.site_id, client_id=context.client_id, minutes=minutes, data_limit_mb=voucher.data_limit_mb, rx_kbps=voucher.download_limit, tx_kbps=voucher.upload_limit)
        confirmed = await _confirm_unifi_authorized(context.site_id, payload.clientMac)
    except UniFiError as exc:
        record_attempt(db, payload.clientMac, ip, "voucher", False, "unifi_error")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Não foi possível confirmar a autorização no UniFi.") from exc
    session = authorize_session(db, client_mac=payload.clientMac, ap_mac=payload.apMac or "", ssid=payload.ssid or "", site=context.site_id, method=AuthorizationMethod.VOUCHER, minutes=minutes, unifi_client_id=confirmed.id, ip=payload.ip or ip, voucher_id=voucher.id)
    voucher.used_count += 1
    db.commit()
    record_attempt(db, payload.clientMac, ip, "voucher", True)
    return _auth_response(session, minutes)


@router.post("/auth/cpf", response_model=AuthResponse)
async def auth_cpf(payload: CpfAuthRequest, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    enforce_rate_limit(db, payload.clientMac, ip, "cpf")
    try:
        site_id, client_id = await _authorize_unifi(db, payload, 60, auth_method="cpf")
    except UniFiError as exc:
        record_attempt(db, payload.clientMac, ip, "cpf", False, "unifi_error")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Não foi possível confirmar a autorização no UniFi.") from exc
    session = authorize_session(db, client_mac=payload.clientMac, ap_mac=payload.apMac or "", ssid=payload.ssid or "", site=site_id, method=AuthorizationMethod.CPF, minutes=60, unifi_client_id=client_id, name=payload.name, cpf=payload.cpf, phone=payload.phone or "", ip=payload.ip or ip)
    record_attempt(db, payload.clientMac, ip, "cpf", True)
    return _auth_response(session, 60)


@router.post("/auth/email/request-code")
async def request_email_code(payload: EmailCodeRequest, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    enforce_rate_limit(db, payload.email.lower(), ip, "email", max_attempts=8, include_successes=True)
    try:
        context = await unifi_client.resolve_client_context(client_mac=payload.clientMac, ap_mac=payload.apMac, requested_site=None)
        ensure_not_in_maintenance(db, context.site_id)
        ensure_auth_method_allowed(db, context.site_id, "email")
    except UniFiError as exc:
        record_attempt(db, payload.email.lower(), ip, "email", False, "unifi_error")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Não foi possível identificar a unidade no UniFi.") from exc
    code = str(int(random_token_urlsafe(4).encode().hex(), 16))[-6:].zfill(6)
    ttl_minutes = get_settings().email_code_ttl_minutes
    expires_at = utcnow() + timedelta(minutes=ttl_minutes)
    email_hash = secret_hash(payload.email.lower())
    previous_codes = db.scalars(select(EmailLoginCode).where(EmailLoginCode.email_hash == email_hash, EmailLoginCode.client_mac == payload.clientMac, EmailLoginCode.consumed_at.is_(None))).all()
    for previous in previous_codes:
        previous.consumed_at = utcnow()
    db.add(EmailLoginCode(email_hash=email_hash, client_mac=payload.clientMac, code_hash=secret_hash(code), expires_at=expires_at))
    text_body, html_body = wifi_code_email(code, ttl_minutes)
    try:
        send_email(payload.email, "Seu código de confirmação", text_body, html_body)
    except EmailDeliveryError as exc:
        db.rollback()
        reason = getattr(exc, "reason", "smtp_error")
        record_attempt(db, payload.email.lower(), ip, "email", False, reason)
        logger.warning("Public email code delivery failed", extra={"reason": reason})
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Não foi possível enviar o código por e-mail agora. Tente novamente em instantes.") from exc
    db.commit()
    record_attempt(db, payload.email.lower(), ip, "email", True)
    return {"expiresAt": expires_at}


@router.post("/auth/email/verify-code", response_model=AuthResponse)
async def verify_email_code(payload: EmailCodeVerify, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    enforce_rate_limit(db, payload.clientMac, ip, "email-verify")
    row = db.scalar(select(EmailLoginCode).where(EmailLoginCode.email_hash == secret_hash(payload.email.lower()), EmailLoginCode.client_mac == payload.clientMac, EmailLoginCode.consumed_at.is_(None)).order_by(EmailLoginCode.expires_at.desc()).limit(1))
    if not row or row.expires_at <= utcnow():
        record_attempt(db, payload.clientMac, ip, "email-verify", False, "expired")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Código inválido ou expirado.")
    row.attempts += 1
    if row.attempts > 5:
        row.consumed_at = utcnow()
        db.commit()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Muitas tentativas.")
    if row.code_hash != secret_hash(payload.code.strip()):
        db.commit()
        record_attempt(db, payload.clientMac, ip, "email-verify", False, "invalid")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Código inválido.")
    row.consumed_at = utcnow()
    db.commit()
    try:
        site_id, client_id = await _authorize_unifi(db, payload, 60, auth_method="email")
    except UniFiError as exc:
        record_attempt(db, payload.clientMac, ip, "email-verify", False, "unifi_error")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Não foi possível confirmar a autorização no UniFi.") from exc
    session = authorize_session(db, client_mac=payload.clientMac, ap_mac=payload.apMac or "", ssid=payload.ssid or "", site=site_id, method=AuthorizationMethod.EMAIL, minutes=60, unifi_client_id=client_id, email=payload.email, ip=payload.ip or ip)
    record_attempt(db, payload.clientMac, ip, "email-verify", True)
    return _auth_response(session, 60)


async def _provisional(payload: ProvisionalAccessRequest, request: Request, db: Session, method: str, minutes: int):
    ip = client_ip(request)
    enforce_rate_limit(db, payload.clientMac, ip, method, max_attempts=8, include_successes=True)
    try:
        site_id, client_id = await _authorize_unifi(db, payload, minutes)
    except UniFiError as exc:
        record_attempt(db, payload.clientMac, ip, method, False, "unifi_error")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Não foi possível confirmar acesso provisório no UniFi.") from exc
    authorize_session(db, client_mac=payload.clientMac, ap_mac=payload.apMac or "", ssid=payload.ssid or "", site=site_id, method=AuthorizationMethod.PROVISIONAL, minutes=minutes, unifi_client_id=client_id, ip=payload.ip or ip)
    record_attempt(db, payload.clientMac, ip, method, True)
    return {"ok": True}


@router.post("/portal/require-auth")
async def require_auth(payload: ProvisionalAccessRequest, request: Request, db: Session = Depends(get_db)):
    return await _provisional(payload, request, db, "provisional", get_settings().provisional_access_minutes)


@router.post("/portal/extend-provisional")
async def extend_provisional(payload: ProvisionalAccessRequest, request: Request, db: Session = Depends(get_db)):
    return await _provisional(payload, request, db, "provisional-extend", get_settings().auth_form_access_minutes)


@router.get("/session/status", response_model=SessionStatusResponse)
def session_status(clientMac: str | None = None, mac: str | None = None, db: Session = Depends(get_db)):
    selected_mac = clientMac or mac
    if not selected_mac:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "clientMac obrigatorio.")
    session = db.scalar(select(GuestSession).where(GuestSession.client_mac == selected_mac).order_by(GuestSession.created_at.desc()).limit(1))
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessão não encontrada.")
    if session.status == SessionStatus.AUTHORIZED and session.expires_at and session.expires_at <= utcnow() and not (session.site and session.unifi_client_id):
        session.status = SessionStatus.EXPIRED
        session.duration_seconds = duration_between(session.authorized_at or session.created_at, session.expires_at)
        db.commit()
    remaining = seconds_remaining(session)
    warning_minutes = next((minutes for minutes in sorted(EXPIRATION_WARNINGS) if 0 < remaining <= minutes * 60), None)
    total_seconds = duration_between(session.authorized_at, session.expires_at)
    return SessionStatusResponse(
        status=session.status.value.lower(),
        authorized=session.status == SessionStatus.AUTHORIZED and remaining > 0,
        authorizedAt=session.authorized_at,
        remainingSeconds=remaining,
        remainingMinutes=remaining // 60,
        sessionMinutes=max(1, total_seconds // 60) if total_seconds else max(1, remaining // 60),
        totalSeconds=total_seconds,
        expiresAt=session.expires_at,
        serverNow=utcnow(),
        networkName="Wi-Fi Visitante",
        establishmentName="Gabinete Itinerante",
        ssid=session.ssid,
        warningMinutes=warning_minutes,
        warningMessage=f"Sua sessão expira em menos de {warning_minutes} minutos." if warning_minutes else None,
        nextCheckSeconds=30,
    )


@router.post("/session/end")
async def end_session(payload: ProvisionalAccessRequest, db: Session = Depends(get_db)):
    session = db.scalar(select(GuestSession).where(GuestSession.client_mac == payload.clientMac).order_by(GuestSession.created_at.desc()).limit(1))
    if not session:
        return {"ok": True}
    session.status = SessionStatus.DISCONNECTED
    session.disconnected_at = utcnow()
    if session.authorized_at:
        session.duration_seconds = int((session.disconnected_at - session.authorized_at).total_seconds())
    db.commit()
    try:
        if session.site and session.unifi_client_id:
            await unifi_client.unauthorize_guest(site_id=session.site, client_id=session.unifi_client_id)
    except UniFiError:
        pass
    return {"ok": True}
