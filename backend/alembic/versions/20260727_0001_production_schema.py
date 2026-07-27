"""production schema

Revision ID: 20260727_0001
Revises: 
Create Date: 2026-07-27
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260727_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

admin_role = postgresql.ENUM("SUPERADMIN", "ADMIN", "VIEWER", name="adminrole", create_type=False)
session_status = postgresql.ENUM("PENDING", "AUTHORIZED", "EXPIRED", "DISCONNECTED", "BLOCKED", "ANONYMIZED", name="sessionstatus", create_type=False)
auth_method = postgresql.ENUM("VOUCHER", "CPF", "EMAIL", "PROVISIONAL", name="authorizationmethod", create_type=False)
notification_type = postgresql.ENUM("INFO", "WARNING", "MAINTENANCE", "CRITICAL", name="notificationtype", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    admin_role.create(bind, checkfirst=True)
    session_status.create(bind, checkfirst=True)
    auth_method.create(bind, checkfirst=True)
    notification_type.create(bind, checkfirst=True)

    op.create_table(
        "admin_users",
        sa.Column("id", sa.String(48), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", admin_role, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("email", name="uq_admin_users_email"),
    )
    op.create_index("ix_admin_users_email", "admin_users", ["email"])

    op.create_table(
        "admin_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("admin_id", sa.String(48), sa.ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("csrf_hash", sa.String(128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_admin_sessions_admin_id", "admin_sessions", ["admin_id"])
    op.create_index("ix_admin_sessions_expires_at", "admin_sessions", ["expires_at"])

    op.create_table(
        "vouchers",
        sa.Column("id", sa.String(48), primary_key=True),
        sa.Column("code_hash", sa.String(128), nullable=False),
        sa.Column("code_label", sa.String(32), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("time_limit_minutes", sa.Integer(), nullable=True),
        sa.Column("data_limit_mb", sa.Integer(), nullable=True),
        sa.Column("download_limit", sa.Integer(), nullable=True),
        sa.Column("upload_limit", sa.Integer(), nullable=True),
        sa.Column("device_limit", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("max_devices", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("site", sa.String(128), nullable=False, server_default="Default"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("duration_minutes > 0", name="ck_vouchers_duration_positive"),
        sa.CheckConstraint("device_limit > 0", name="ck_vouchers_device_limit_positive"),
        sa.UniqueConstraint("code_hash", name="uq_vouchers_code_hash"),
    )
    op.create_index("ix_vouchers_code_hash", "vouchers", ["code_hash"])
    op.create_index("ix_vouchers_code_label", "vouchers", ["code_label"])
    op.create_index("ix_vouchers_site", "vouchers", ["site"])
    op.create_index("ix_vouchers_expires_at", "vouchers", ["expires_at"])

    op.create_table(
        "guest_sessions",
        sa.Column("id", sa.String(48), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disconnected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("site", sa.String(128), nullable=False, server_default=""),
        sa.Column("ap_mac", sa.String(32), nullable=False, server_default=""),
        sa.Column("client_mac", sa.String(32), nullable=False),
        sa.Column("ssid", sa.String(128), nullable=False, server_default=""),
        sa.Column("client_ip_encrypted", sa.Text(), nullable=True),
        sa.Column("email_encrypted", sa.Text(), nullable=True),
        sa.Column("cpf_encrypted", sa.Text(), nullable=True),
        sa.Column("phone_encrypted", sa.Text(), nullable=True),
        sa.Column("name", sa.String(160), nullable=False, server_default=""),
        sa.Column("authorization_method", auth_method, nullable=False),
        sa.Column("status", session_status, nullable=False),
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("terms_version", sa.String(32), nullable=False, server_default="v1"),
        sa.Column("unifi_client_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("voucher_id", sa.String(48), sa.ForeignKey("vouchers.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_guest_sessions_created_at", "guest_sessions", ["created_at"])
    op.create_index("ix_guest_sessions_expires_at", "guest_sessions", ["expires_at"])
    op.create_index("ix_guest_sessions_ap_mac", "guest_sessions", ["ap_mac"])
    op.create_index("ix_guest_sessions_client_mac", "guest_sessions", ["client_mac"])
    op.create_index("ix_guest_sessions_ssid", "guest_sessions", ["ssid"])
    op.create_index("ix_guest_sessions_status", "guest_sessions", ["status"])
    op.create_index("ix_guest_sessions_client_status", "guest_sessions", ["client_mac", "status"])
    op.create_index("ix_guest_sessions_site_created", "guest_sessions", ["site", "created_at"])

    op.create_table(
        "auth_attempts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("identifier_hash", sa.String(128), nullable=False),
        sa.Column("ip_hash", sa.String(128), nullable=False),
        sa.Column("method", sa.String(64), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.String(160), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_auth_attempts_identifier_hash", "auth_attempts", ["identifier_hash"])
    op.create_index("ix_auth_attempts_ip_hash", "auth_attempts", ["ip_hash"])
    op.create_index("ix_auth_attempts_method", "auth_attempts", ["method"])
    op.create_index("ix_auth_attempts_created_at", "auth_attempts", ["created_at"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("actor_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("event", sa.String(96), nullable=False),
        sa.Column("target_type", sa.String(64), nullable=False, server_default=""),
        sa.Column("target_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_logs_actor_id", "audit_logs", ["actor_id"])
    op.create_index("ix_audit_logs_event", "audit_logs", ["event"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])

    op.create_table(
        "email_login_codes",
        sa.Column("id", sa.String(48), primary_key=True),
        sa.Column("email_hash", sa.String(128), nullable=False),
        sa.Column("client_mac", sa.String(32), nullable=False),
        sa.Column("code_hash", sa.String(128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_email_login_codes_email_hash", "email_login_codes", ["email_hash"])
    op.create_index("ix_email_login_codes_client_mac", "email_login_codes", ["client_mac"])
    op.create_index("ix_email_login_codes_expires_at", "email_login_codes", ["expires_at"])
    op.create_index("ix_email_login_codes_email_mac", "email_login_codes", ["email_hash", "client_mac"])
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.String(48), primary_key=True),
        sa.Column("admin_id", sa.String(48), sa.ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_password_reset_tokens_token_hash"),
    )
    op.create_index("ix_password_reset_tokens_admin_id", "password_reset_tokens", ["admin_id"])
    op.create_index("ix_password_reset_tokens_expires_at", "password_reset_tokens", ["expires_at"])


    op.create_table(
        "maintenance_configs",
        sa.Column("id", sa.String(48), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("title", sa.String(160), nullable=False, server_default="Portal em manutencao"),
        sa.Column("message", sa.Text(), nullable=False, server_default="Estamos realizando ajustes para melhorar o acesso."),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("visual_config_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("updated_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_maintenance_configs_enabled", "maintenance_configs", ["enabled"])
    op.create_index("ix_maintenance_configs_start_at", "maintenance_configs", ["start_at"])
    op.create_index("ix_maintenance_configs_end_at", "maintenance_configs", ["end_at"])

    op.create_table(
        "portal_notifications",
        sa.Column("id", sa.String(48), primary_key=True),
        sa.Column("type", notification_type, nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("site", sa.String(128), nullable=False, server_default="ALL"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("updated_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_portal_notifications_type", "portal_notifications", ["type"])
    op.create_index("ix_portal_notifications_starts_at", "portal_notifications", ["starts_at"])
    op.create_index("ix_portal_notifications_ends_at", "portal_notifications", ["ends_at"])
    op.create_index("ix_portal_notifications_site", "portal_notifications", ["site"])
    op.create_index("ix_portal_notifications_enabled", "portal_notifications", ["enabled"])
    op.create_index("ix_portal_notifications_created_at", "portal_notifications", ["created_at"])
    op.create_index("ix_portal_notifications_site_window", "portal_notifications", ["site", "starts_at", "ends_at"])

    op.create_table(
        "site_profiles",
        sa.Column("id", sa.String(48), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("slug", sa.String(128), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("latitude", sa.String(64), nullable=False, server_default=""),
        sa.Column("longitude", sa.String(64), nullable=False, server_default=""),
        sa.UniqueConstraint("name", name="uq_site_profiles_name"),
        sa.UniqueConstraint("slug", name="uq_site_profiles_slug"),
    )

    op.create_table(
        "portal_settings",
        sa.Column("key", sa.String(96), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("portal_settings")
    op.drop_table("site_profiles")
    op.drop_index("ix_portal_notifications_site_window", table_name="portal_notifications")
    op.drop_index("ix_portal_notifications_created_at", table_name="portal_notifications")
    op.drop_index("ix_portal_notifications_enabled", table_name="portal_notifications")
    op.drop_index("ix_portal_notifications_site", table_name="portal_notifications")
    op.drop_index("ix_portal_notifications_ends_at", table_name="portal_notifications")
    op.drop_index("ix_portal_notifications_starts_at", table_name="portal_notifications")
    op.drop_index("ix_portal_notifications_type", table_name="portal_notifications")
    op.drop_table("portal_notifications")
    op.drop_index("ix_maintenance_configs_end_at", table_name="maintenance_configs")
    op.drop_index("ix_maintenance_configs_start_at", table_name="maintenance_configs")
    op.drop_index("ix_maintenance_configs_enabled", table_name="maintenance_configs")
    op.drop_table("maintenance_configs")
    op.drop_index("ix_password_reset_tokens_expires_at", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_admin_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
    op.drop_index("ix_email_login_codes_email_mac", table_name="email_login_codes")
    op.drop_index("ix_email_login_codes_expires_at", table_name="email_login_codes")
    op.drop_index("ix_email_login_codes_client_mac", table_name="email_login_codes")
    op.drop_index("ix_email_login_codes_email_hash", table_name="email_login_codes")
    op.drop_table("email_login_codes")
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_index("ix_audit_logs_event", table_name="audit_logs")
    op.drop_index("ix_audit_logs_actor_id", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_auth_attempts_created_at", table_name="auth_attempts")
    op.drop_index("ix_auth_attempts_method", table_name="auth_attempts")
    op.drop_index("ix_auth_attempts_ip_hash", table_name="auth_attempts")
    op.drop_index("ix_auth_attempts_identifier_hash", table_name="auth_attempts")
    op.drop_table("auth_attempts")
    op.drop_index("ix_guest_sessions_site_created", table_name="guest_sessions")
    op.drop_index("ix_guest_sessions_client_status", table_name="guest_sessions")
    op.drop_index("ix_guest_sessions_status", table_name="guest_sessions")
    op.drop_index("ix_guest_sessions_ssid", table_name="guest_sessions")
    op.drop_index("ix_guest_sessions_client_mac", table_name="guest_sessions")
    op.drop_index("ix_guest_sessions_ap_mac", table_name="guest_sessions")
    op.drop_index("ix_guest_sessions_expires_at", table_name="guest_sessions")
    op.drop_index("ix_guest_sessions_created_at", table_name="guest_sessions")
    op.drop_table("guest_sessions")
    op.drop_index("ix_vouchers_expires_at", table_name="vouchers")
    op.drop_index("ix_vouchers_site", table_name="vouchers")
    op.drop_index("ix_vouchers_code_label", table_name="vouchers")
    op.drop_index("ix_vouchers_code_hash", table_name="vouchers")
    op.drop_table("vouchers")
    op.drop_index("ix_admin_sessions_expires_at", table_name="admin_sessions")
    op.drop_index("ix_admin_sessions_admin_id", table_name="admin_sessions")
    op.drop_table("admin_sessions")
    op.drop_index("ix_admin_users_email", table_name="admin_users")
    op.drop_table("admin_users")
    bind = op.get_bind()
    notification_type.drop(bind, checkfirst=True)
    auth_method.drop(bind, checkfirst=True)
    session_status.drop(bind, checkfirst=True)
    admin_role.drop(bind, checkfirst=True)


