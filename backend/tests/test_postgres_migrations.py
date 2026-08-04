import os

import pytest
from sqlalchemy import create_engine, inspect, text

from alembic import command
from alembic.config import Config
from app.core.config import get_settings


@pytest.mark.skipif(not os.getenv("TEST_POSTGRES_DATABASE_URL"), reason="TEST_POSTGRES_DATABASE_URL is not configured")
def test_postgresql_migrations_reach_head_and_match_required_columns(monkeypatch):
    database_url = os.environ["TEST_POSTGRES_DATABASE_URL"]
    if "postgres" not in database_url.lower():
        pytest.skip("TEST_POSTGRES_DATABASE_URL must point to a PostgreSQL test database")

    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("MIGRATION_DATABASE_URL", database_url)
    get_settings.cache_clear()

    config = Config("alembic.ini")
    command.upgrade(config, "head")

    engine = create_engine(database_url)
    try:
        with engine.connect() as conn:
            current = conn.execute(text("select version_num from alembic_version limit 1")).scalar_one()
            inspector = inspect(conn)
            admin_columns = {column["name"] for column in inspector.get_columns("admin_users")}
            voucher_columns = {column["name"] for column in inspector.get_columns("vouchers")}
    finally:
        engine.dispose()

    assert current == "20260730_0003"
    assert {"id", "email", "name", "password_hash", "role", "is_active", "created_at", "updated_at"}.issubset(admin_columns)
    assert {"description", "created_by", "revoked_at", "revoked_by", "site_id", "site_name_snapshot"}.issubset(voucher_columns)
    assert {"description", "created_by", "revoked_at", "revoked_by"}.isdisjoint(admin_columns)
