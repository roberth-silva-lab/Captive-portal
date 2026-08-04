"""site scoping and portal site settings

Revision ID: 20260730_0003
Revises: 20260730_0002
Create Date: 2026-07-30
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260730_0003"
down_revision: Union[str, None] = "20260730_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_site_access",
        sa.Column("id", sa.String(length=48), primary_key=True),
        sa.Column("admin_id", sa.String(length=48), sa.ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("site_id", sa.String(length=128), nullable=False),
        sa.Column("site_name_snapshot", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("granted_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("admin_id", "site_id", name="uq_admin_site_access_admin_site"),
    )
    op.create_index("ix_admin_site_access_admin_id", "admin_site_access", ["admin_id"])
    op.create_index("ix_admin_site_access_site_id", "admin_site_access", ["site_id"])

    op.create_table(
        "portal_site_settings",
        sa.Column("id", sa.String(length=48), primary_key=True),
        sa.Column("site_id", sa.String(length=128), nullable=False),
        sa.Column("site_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("display_name", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("logo_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("primary_color", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("public_title", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("welcome_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("success_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("reauthentication_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("terms_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("site_id", name="uq_portal_site_settings_site_id"),
    )
    op.create_index("ix_portal_site_settings_site_id", "portal_site_settings", ["site_id"])

    op.add_column("admin_invitations", sa.Column("permitted_site_ids_json", sa.Text(), nullable=False, server_default="[]"))
    op.add_column("vouchers", sa.Column("site_id", sa.String(length=128), nullable=False, server_default=""))
    op.add_column("vouchers", sa.Column("site_name_snapshot", sa.String(length=128), nullable=False, server_default=""))
    op.execute("UPDATE vouchers SET site_id = site WHERE site_id = ''")
    op.create_index("ix_vouchers_site_id", "vouchers", ["site_id"])


def downgrade() -> None:
    op.drop_index("ix_vouchers_site_id", table_name="vouchers")
    op.drop_column("vouchers", "site_name_snapshot")
    op.drop_column("vouchers", "site_id")
    op.drop_column("admin_invitations", "permitted_site_ids_json")

    op.drop_index("ix_portal_site_settings_site_id", table_name="portal_site_settings")
    op.drop_table("portal_site_settings")

    op.drop_index("ix_admin_site_access_site_id", table_name="admin_site_access")
    op.drop_index("ix_admin_site_access_admin_id", table_name="admin_site_access")
    op.drop_table("admin_site_access")