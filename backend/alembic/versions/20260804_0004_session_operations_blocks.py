"""session operations and access blocks

Revision ID: 20260804_0004
Revises: 20260730_0003
Create Date: 2026-08-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260804_0004"
down_revision: Union[str, None] = "20260730_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("guest_sessions", sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("guest_sessions", sa.Column("ended_by", sa.String(length=64), nullable=False, server_default=""))
    op.add_column("guest_sessions", sa.Column("admin_end_reason", sa.String(length=300), nullable=False, server_default=""))
    op.add_column("guest_sessions", sa.Column("reauth_required_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("guest_sessions", sa.Column("reauth_required_by", sa.String(length=64), nullable=False, server_default=""))
    op.add_column("guest_sessions", sa.Column("reauth_reason", sa.String(length=300), nullable=False, server_default=""))
    op.create_index("ix_guest_sessions_ended_at", "guest_sessions", ["ended_at"])
    op.create_index("ix_guest_sessions_reauth_required_at", "guest_sessions", ["reauth_required_at"])

    op.create_table(
        "access_blocks",
        sa.Column("id", sa.String(length=48), primary_key=True),
        sa.Column("site_id", sa.String(length=128), nullable=True),
        sa.Column("scope", sa.String(length=16), nullable=False, server_default="SITE"),
        sa.Column("device_mac_hash", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("device_mac_label", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("visitor_id", sa.String(length=48), nullable=True),
        sa.Column("identity_fingerprint", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("reason", sa.String(length=300), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("revoke_reason", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["visitor_id"], ["guest_sessions.id"], name="fk_access_blocks_visitor_id_guest_sessions", ondelete="SET NULL"),
    )
    op.create_index("ix_access_blocks_site_id", "access_blocks", ["site_id"])
    op.create_index("ix_access_blocks_device_mac_hash", "access_blocks", ["device_mac_hash"])
    op.create_index("ix_access_blocks_identity_fingerprint", "access_blocks", ["identity_fingerprint"])
    op.create_index("ix_access_blocks_expires_at", "access_blocks", ["expires_at"])
    op.create_index("ix_access_blocks_revoked_at", "access_blocks", ["revoked_at"])


def downgrade() -> None:
    op.drop_index("ix_access_blocks_revoked_at", table_name="access_blocks")
    op.drop_index("ix_access_blocks_expires_at", table_name="access_blocks")
    op.drop_index("ix_access_blocks_identity_fingerprint", table_name="access_blocks")
    op.drop_index("ix_access_blocks_device_mac_hash", table_name="access_blocks")
    op.drop_index("ix_access_blocks_site_id", table_name="access_blocks")
    op.drop_table("access_blocks")

    op.drop_index("ix_guest_sessions_reauth_required_at", table_name="guest_sessions")
    op.drop_index("ix_guest_sessions_ended_at", table_name="guest_sessions")
    op.drop_column("guest_sessions", "reauth_reason")
    op.drop_column("guest_sessions", "reauth_required_by")
    op.drop_column("guest_sessions", "reauth_required_at")
    op.drop_column("guest_sessions", "admin_end_reason")
    op.drop_column("guest_sessions", "ended_by")
    op.drop_column("guest_sessions", "ended_at")