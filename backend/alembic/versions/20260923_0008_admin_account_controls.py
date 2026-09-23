"""admin account controls and support requests

Revision ID: 20260923_0008
Revises: 20260923_0007
Create Date: 2026-09-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260923_0008"
down_revision: Union[str, None] = "20260923_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("admin_users", sa.Column("failed_login_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("admin_users", sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("admin_users", sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("admin_users", sa.Column("suspended_reason", sa.String(length=300), nullable=False, server_default=""))
    op.add_column("admin_users", sa.Column("suspended_by", sa.String(length=64), nullable=False, server_default=""))
    op.add_column("admin_users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("admin_users", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_admin_users_locked_at", "admin_users", ["locked_at"], unique=False)
    op.create_index("ix_admin_users_suspended_at", "admin_users", ["suspended_at"], unique=False)
    op.create_index("ix_admin_users_last_login_at", "admin_users", ["last_login_at"], unique=False)
    op.create_index("ix_admin_users_last_seen_at", "admin_users", ["last_seen_at"], unique=False)

    op.add_column(
        "admin_sessions",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_admin_sessions_last_seen_at", "admin_sessions", ["last_seen_at"], unique=False)

    op.create_table(
        "admin_reactivation_requests",
        sa.Column("id", sa.String(length=48), primary_key=True),
        sa.Column("admin_id", sa.String(length=48), sa.ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="PENDING"),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("resolution_note", sa.String(length=500), nullable=False, server_default=""),
    )
    op.create_index("ix_admin_reactivation_requests_admin_id", "admin_reactivation_requests", ["admin_id"], unique=False)
    op.create_index("ix_admin_reactivation_requests_status", "admin_reactivation_requests", ["status"], unique=False)
    op.create_index("ix_admin_reactivation_requests_requested_at", "admin_reactivation_requests", ["requested_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_admin_reactivation_requests_requested_at", table_name="admin_reactivation_requests")
    op.drop_index("ix_admin_reactivation_requests_status", table_name="admin_reactivation_requests")
    op.drop_index("ix_admin_reactivation_requests_admin_id", table_name="admin_reactivation_requests")
    op.drop_table("admin_reactivation_requests")

    op.drop_index("ix_admin_sessions_last_seen_at", table_name="admin_sessions")
    op.drop_column("admin_sessions", "last_seen_at")

    op.drop_index("ix_admin_users_last_seen_at", table_name="admin_users")
    op.drop_index("ix_admin_users_last_login_at", table_name="admin_users")
    op.drop_index("ix_admin_users_suspended_at", table_name="admin_users")
    op.drop_index("ix_admin_users_locked_at", table_name="admin_users")
    op.drop_column("admin_users", "last_seen_at")
    op.drop_column("admin_users", "last_login_at")
    op.drop_column("admin_users", "suspended_by")
    op.drop_column("admin_users", "suspended_reason")
    op.drop_column("admin_users", "suspended_at")
    op.drop_column("admin_users", "locked_at")
    op.drop_column("admin_users", "failed_login_attempts")
