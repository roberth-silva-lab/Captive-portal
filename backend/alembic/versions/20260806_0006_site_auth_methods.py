"""site auth methods

Revision ID: 20260806_0006
Revises: 20260804_0005
Create Date: 2026-08-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260806_0006"
down_revision: Union[str, None] = "20260804_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_METHODS = '["voucher","cpf","email"]'


def upgrade() -> None:
    op.add_column(
        "portal_site_settings",
        sa.Column("auth_methods_json", sa.Text(), nullable=False, server_default=DEFAULT_METHODS),
    )


def downgrade() -> None:
    op.drop_column("portal_site_settings", "auth_methods_json")