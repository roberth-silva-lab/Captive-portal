from fastapi import APIRouter
from sqlalchemy import text

from app.core.database import engine

router = APIRouter(tags=["health"])


@router.get("/health/live")
def live():
    return {"status": "ok"}


@router.get("/health/ready")
def ready():
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
    except Exception:  # noqa: BLE001
        return {"status": "degraded", "database": "unavailable"}
    return {"status": "ok", "database": "ok"}


@router.get("/api/metrics")
def metrics():
    return {"status": "ok"}
