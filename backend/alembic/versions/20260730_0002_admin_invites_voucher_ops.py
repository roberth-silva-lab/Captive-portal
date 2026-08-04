"""admin invites and voucher operations

Revision ID: 20260730_0002
Revises: 20260727_0001
Create Date: 2026-07-30
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260730_0002"
down_revision: Union[str, None] = "20260727_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("vouchers", sa.Column("description", sa.String(length=240), nullable=False, server_default=""))
    op.add_column("vouchers", sa.Column("created_by", sa.String(length=64), nullable=False, server_default=""))
    op.add_column("vouchers", sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("vouchers", sa.Column("revoked_by", sa.String(length=64), nullable=False, server_default=""))
    op.create_index("ix_vouchers_created_by", "vouchers", ["created_by"])
    op.create_index("ix_vouchers_revoked_at", "vouchers", ["revoked_at"])

    op.create_table(
        "admin_invitations",
        sa.Column("id", sa.String(length=48), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("invited_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("admin_id", sa.String(length=48), sa.ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_admin_invitations_token_hash"),
    )
    op.create_index("ix_admin_invitations_email", "admin_invitations", ["email"])
    op.create_index("ix_admin_invitations_expires_at", "admin_invitations", ["expires_at"])
    op.create_index("ix_admin_invitations_admin_id", "admin_invitations", ["admin_id"])


def downgrade() -> None:
    op.drop_index("ix_admin_invitations_admin_id", table_name="admin_invitations")
    op.drop_index("ix_admin_invitations_expires_at", table_name="admin_invitations")
    op.drop_index("ix_admin_invitations_email", table_name="admin_invitations")
    op.drop_table("admin_invitations")

    op.drop_index("ix_vouchers_revoked_at", table_name="vouchers")
    op.drop_index("ix_vouchers_created_by", table_name="vouchers")
    op.drop_column("vouchers", "revoked_by")
    op.drop_column("vouchers", "revoked_at")
    op.drop_column("vouchers", "created_by")
    op.drop_column("vouchers", "description")