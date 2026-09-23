"""unlimited voucher access

Revision ID: 20260923_0007
Revises: 20260806_0006
Create Date: 2026-09-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260923_0007"
down_revision: Union[str, None] = "20260806_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "vouchers",
        sa.Column("unlimited_duration", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "guest_sessions",
        sa.Column("unlimited_access", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "guest_sessions",
        sa.Column("unifi_refresh_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_guest_sessions_unlimited_access",
        "guest_sessions",
        ["unlimited_access"],
        unique=False,
    )
    op.create_index(
        "ix_guest_sessions_unifi_refresh_at",
        "guest_sessions",
        ["unifi_refresh_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_guest_sessions_unifi_refresh_at", table_name="guest_sessions")
    op.drop_index("ix_guest_sessions_unlimited_access", table_name="guest_sessions")
    op.drop_column("guest_sessions", "unifi_refresh_at")
    op.drop_column("guest_sessions", "unlimited_access")
    op.drop_column("vouchers", "unlimited_duration")
