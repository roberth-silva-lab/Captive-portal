from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text

from app.core.database import engine

router = APIRouter(tags=["health"])

EXPECTED_COLUMNS = {
    "admin_users": {"id", "email", "name", "password_hash", "role", "is_active", "created_at", "updated_at"},
    "vouchers": {
        "id",
        "code_hash",
        "code_label",
        "duration_minutes",
        "description",
        "created_by",
        "revoked_at",
        "revoked_by",
        "site_id",
        "site_name_snapshot",
    },
    "admin_invitations": {"id", "email", "token_hash", "role", "permitted_site_ids_json"},
    "admin_site_access": {"id", "admin_id", "site_id"},
    "portal_site_settings": {"id", "site_id", "site_name", "display_name", "enabled", "updated_at"},
    "guest_sessions": {"id", "status", "client_mac", "site", "unifi_client_id", "ended_at", "ended_by", "admin_end_reason", "reauth_required_at"},
    "access_blocks": {"id", "site_id", "scope", "device_mac_hash", "reason", "created_by", "revoked_at"},
}


def _schema_findings(conn) -> list[str]:
    inspector = inspect(conn)
    tables = set(inspector.get_table_names())
    findings: list[str] = []
    for table, expected_columns in EXPECTED_COLUMNS.items():
        if table not in tables:
            findings.append(f"missing_table:{table}")
            continue
        actual_columns = {column["name"] for column in inspector.get_columns(table)}
        for column in sorted(expected_columns - actual_columns):
            findings.append(f"missing_column:{table}.{column}")
    return findings


@router.get("/health/live")
def live():
    return {"status": "ok"}


@router.get("/health/ready")
def ready():
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
            findings = _schema_findings(conn)
            tables = set(inspect(conn).get_table_names())
            current_revision = None
            if engine.dialect.name == "postgresql" and "alembic_version" not in tables:
                findings.append("missing_table:alembic_version")
            if "alembic_version" in tables:
                current_revision = conn.execute(text("select version_num from alembic_version limit 1")).scalar_one_or_none()
    except Exception:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"status": "degraded", "database": "unavailable"})
    if findings:
        return JSONResponse(
            status_code=503,
            content={
                "status": "degraded",
                "database": "ok",
                "schema": "incompatible",
                "findings": findings,
                "alembicRevision": current_revision,
            },
        )
    return {"status": "ok", "database": "ok", "schema": "ok", "alembicRevision": current_revision}


@router.get("/api/metrics")
def metrics():
    return {"status": "ok"}
