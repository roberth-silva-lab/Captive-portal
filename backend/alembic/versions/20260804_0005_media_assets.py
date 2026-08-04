"""media assets

Revision ID: 20260804_0005
Revises: 20260804_0004
Create Date: 2026-08-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260804_0005"
down_revision: Union[str, None] = "20260804_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "media_assets",
        sa.Column("id", sa.String(length=48), primary_key=True),
        sa.Column("asset_type", sa.String(length=32), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("stored_filename", sa.String(length=255), nullable=False, unique=True),
        sa.Column("content_type", sa.String(length=64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("height", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("public_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_media_assets_asset_type", "media_assets", ["asset_type"])
    op.create_index("ix_media_assets_created_at", "media_assets", ["created_at"])
    op.create_index("ix_media_assets_created_by", "media_assets", ["created_by"])
    op.create_index("ix_media_assets_deleted_at", "media_assets", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_media_assets_deleted_at", table_name="media_assets")
    op.drop_index("ix_media_assets_created_by", table_name="media_assets")
    op.drop_index("ix_media_assets_created_at", table_name="media_assets")
    op.drop_index("ix_media_assets_asset_type", table_name="media_assets")
    op.drop_table("media_assets")
