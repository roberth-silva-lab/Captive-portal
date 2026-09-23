import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


class AdminRole(str, enum.Enum):
    SUPERADMIN = "SUPERADMIN"
    ADMIN = "ADMIN"
    VIEWER = "VIEWER"


class SessionStatus(str, enum.Enum):
    PENDING = "PENDING"
    AUTHORIZED = "AUTHORIZED"
    EXPIRED = "EXPIRED"
    DISCONNECTED = "DISCONNECTED"
    BLOCKED = "BLOCKED"
    ANONYMIZED = "ANONYMIZED"


class AuthorizationMethod(str, enum.Enum):
    VOUCHER = "VOUCHER"
    CPF = "CPF"
    EMAIL = "EMAIL"
    PROVISIONAL = "PROVISIONAL"


class NotificationType(str, enum.Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    MAINTENANCE = "MAINTENANCE"
    CRITICAL = "CRITICAL"


class AdminUser(Base):
    __tablename__ = "admin_users"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("adm"))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[AdminRole] = mapped_column(Enum(AdminRole), default=AdminRole.VIEWER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

class AdminSiteAccess(Base):
    __tablename__ = "admin_site_access"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("asa"))
    admin_id: Mapped[str] = mapped_column(ForeignKey("admin_users.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[str] = mapped_column(String(128), index=True)
    site_name_snapshot: Mapped[str] = mapped_column(String(128), default="")
    granted_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (Index("uq_admin_site_access_admin_site", "admin_id", "site_id", unique=True),)

class AdminSession(Base):
    __tablename__ = "admin_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    admin_id: Mapped[str] = mapped_column(ForeignKey("admin_users.id", ondelete="CASCADE"), index=True)
    csrf_hash: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    admin: Mapped[AdminUser] = relationship()


class Voucher(Base):
    __tablename__ = "vouchers"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("vou"))
    code_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    code_label: Mapped[str] = mapped_column(String(32), index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer)
    unlimited_duration: Mapped[bool] = mapped_column(Boolean, default=False)
    time_limit_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data_limit_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    download_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    upload_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    device_limit: Mapped[int] = mapped_column(Integer, default=1)
    max_devices: Mapped[int] = mapped_column(Integer, default=1)
    site: Mapped[str] = mapped_column(String(128), default="Default", index=True)
    site_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    site_name_snapshot: Mapped[str] = mapped_column(String(128), default="")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str] = mapped_column(String(240), default="")
    created_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    revoked_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GuestSession(Base):
    __tablename__ = "guest_sessions"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("gst"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    authorized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    unlimited_access: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    unifi_refresh_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    disconnected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    ended_by: Mapped[str] = mapped_column(String(64), default="")
    admin_end_reason: Mapped[str] = mapped_column(String(300), default="")
    reauth_required_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    reauth_required_by: Mapped[str] = mapped_column(String(64), default="")
    reauth_reason: Mapped[str] = mapped_column(String(300), default="")
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    site: Mapped[str] = mapped_column(String(128), default="")
    ap_mac: Mapped[str] = mapped_column(String(32), default="", index=True)
    client_mac: Mapped[str] = mapped_column(String(32), index=True)
    ssid: Mapped[str] = mapped_column(String(128), default="", index=True)
    client_ip_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    cpf_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str] = mapped_column(String(160), default="")
    authorization_method: Mapped[AuthorizationMethod] = mapped_column(Enum(AuthorizationMethod))
    status: Mapped[SessionStatus] = mapped_column(Enum(SessionStatus), default=SessionStatus.PENDING, index=True)
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    terms_version: Mapped[str] = mapped_column(String(32), default="v1")
    unifi_client_id: Mapped[str] = mapped_column(String(128), default="")
    voucher_id: Mapped[str | None] = mapped_column(ForeignKey("vouchers.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (
        Index("ix_guest_sessions_client_status", "client_mac", "status"),
        Index("ix_guest_sessions_site_created", "site", "created_at"),
    )


class AuthAttempt(Base):
    __tablename__ = "auth_attempts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    identifier_hash: Mapped[str] = mapped_column(String(128), index=True)
    ip_hash: Mapped[str] = mapped_column(String(128), index=True)
    method: Mapped[str] = mapped_column(String(64), index=True)
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[str] = mapped_column(String(160), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    event: Mapped[str] = mapped_column(String(96), index=True)
    target_type: Mapped[str] = mapped_column(String(64), default="")
    target_id: Mapped[str] = mapped_column(String(128), default="")
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

class AccessBlock(Base):
    __tablename__ = "access_blocks"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("blk"))
    site_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    scope: Mapped[str] = mapped_column(String(16), default="SITE")
    device_mac_hash: Mapped[str] = mapped_column(String(128), default="", index=True)
    device_mac_label: Mapped[str] = mapped_column(String(32), default="")
    visitor_id: Mapped[str | None] = mapped_column(ForeignKey("guest_sessions.id", ondelete="SET NULL"), nullable=True)
    identity_fingerprint: Mapped[str] = mapped_column(String(128), default="", index=True)
    reason: Mapped[str] = mapped_column(String(300))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    revoked_by: Mapped[str] = mapped_column(String(64), default="")
    revoke_reason: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

class EmailLoginCode(Base):
    __tablename__ = "email_login_codes"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("elc"))
    email_hash: Mapped[str] = mapped_column(String(128), index=True)
    client_mac: Mapped[str] = mapped_column(String(32), index=True)
    code_hash: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (Index("ix_email_login_codes_email_mac", "email_hash", "client_mac"),)



class AdminInvitation(Base):
    __tablename__ = "admin_invitations"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("inv"))
    email: Mapped[str] = mapped_column(String(255), index=True)
    name: Mapped[str] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(32))
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    invited_by: Mapped[str] = mapped_column(String(64), default="")
    admin_id: Mapped[str | None] = mapped_column(ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    permitted_site_ids_json: Mapped[str] = mapped_column(Text, default="[]")

class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("prt"))
    admin_id: Mapped[str] = mapped_column(ForeignKey("admin_users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

class MediaAsset(Base):
    __tablename__ = "media_assets"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("med"))
    asset_type: Mapped[str] = mapped_column(String(32), index=True)
    original_filename: Mapped[str] = mapped_column(String(255), default="")
    stored_filename: Mapped[str] = mapped_column(String(255), unique=True)
    content_type: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(Integer)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    public_url: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class MaintenanceConfig(Base):
    __tablename__ = "maintenance_configs"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: "global")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    title: Mapped[str] = mapped_column(String(160), default="Portal em manutenção")
    message: Mapped[str] = mapped_column(Text, default="Estamos realizando ajustes para melhorar o acesso.")
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    image_url: Mapped[str] = mapped_column(Text, default="")
    visual_config_json: Mapped[str] = mapped_column(Text, default="{}")
    updated_by: Mapped[str] = mapped_column(String(64), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class PortalNotification(Base):
    __tablename__ = "portal_notifications"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("ntf"))
    type: Mapped[NotificationType] = mapped_column(Enum(NotificationType), default=NotificationType.INFO, index=True)
    title: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(Text)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    site: Mapped[str] = mapped_column(String(128), default="ALL", index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    updated_by: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("ix_portal_notifications_site_window", "site", "starts_at", "ends_at"),)

class SiteProfile(Base):
    __tablename__ = "site_profiles"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("site"))
    name: Mapped[str] = mapped_column(String(128), unique=True)
    slug: Mapped[str] = mapped_column(String(128), unique=True)
    status: Mapped[str] = mapped_column(String(32), default="active")
    latitude: Mapped[str] = mapped_column(String(64), default="")
    longitude: Mapped[str] = mapped_column(String(64), default="")

class PortalSiteSetting(Base):
    __tablename__ = "portal_site_settings"
    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: new_id("pss"))
    site_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    site_name: Mapped[str] = mapped_column(String(128), default="")
    display_name: Mapped[str] = mapped_column(String(160), default="")
    logo_url: Mapped[str] = mapped_column(Text, default="")
    primary_color: Mapped[str] = mapped_column(String(16), default="")
    public_title: Mapped[str] = mapped_column(String(160), default="")
    welcome_text: Mapped[str] = mapped_column(Text, default="")
    success_message: Mapped[str] = mapped_column(Text, default="")
    reauthentication_message: Mapped[str] = mapped_column(Text, default="")
    terms_text: Mapped[str] = mapped_column(Text, default="")
    auth_methods_json: Mapped[str] = mapped_column(Text, default='["voucher","cpf","email"]')
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

class PortalSetting(Base):
    __tablename__ = "portal_settings"
    key: Mapped[str] = mapped_column(String(96), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
