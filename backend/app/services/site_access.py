import json
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import AdminRole, AdminSiteAccess, AdminUser
from app.models.entities import utcnow

GLOBAL_SITE = "ALL"
PUBLIC_SITE_NAMES = {"Default", "Sede", "Esdras", "DMA"}


@dataclass(frozen=True)
class SiteChoice:
    site_id: str
    site_name: str


def site_id_from_unifi(site: dict[str, Any]) -> str:
    return str(site.get("id") or site.get("siteId") or site.get("_id") or "")


def site_name_from_unifi(site: dict[str, Any]) -> str:
    return str(site.get("name") or site.get("displayName") or site.get("description") or site_id_from_unifi(site))


def normalize_site_id(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned or cleaned.upper() in {"ALL", "TODOS", "TODOS_OS_SITES"}:
        return None
    return cleaned


def invitation_sites(raw: str | None) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def allowed_site_ids(db: Session, admin: AdminUser) -> list[str] | None:
    if admin.role == AdminRole.SUPERADMIN:
        return None
    return list(db.scalars(select(AdminSiteAccess.site_id).where(AdminSiteAccess.admin_id == admin.id)).all())


def ensure_site_access(db: Session, admin: AdminUser, site_id: str | None, *, allow_all: bool = False) -> str | None:
    selected = normalize_site_id(site_id)
    allowed = allowed_site_ids(db, admin)
    if allowed is None:
        if selected is None and not allow_all:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "siteId obrigatorio.")
        return selected
    if selected is None:
        if allow_all and allowed:
            return None
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso ao site nao permitido.")
    if selected not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso ao site nao permitido.")
    return selected


def visible_site_filter(db: Session, admin: AdminUser, site_id: str | None = None) -> list[str] | None:
    selected = ensure_site_access(db, admin, site_id, allow_all=True)
    if selected:
        return [selected]
    return allowed_site_ids(db, admin)


def replace_admin_site_access(db: Session, *, target_admin_id: str, site_ids: list[str], site_names: dict[str, str], granted_by: str) -> None:
    db.execute(delete(AdminSiteAccess).where(AdminSiteAccess.admin_id == target_admin_id))
    for site_id in dict.fromkeys(site_ids):
        db.add(
            AdminSiteAccess(
                admin_id=target_admin_id,
                site_id=site_id,
                site_name_snapshot=site_names.get(site_id, site_id),
                granted_by=granted_by,
                created_at=utcnow(),
            )
        )


def require_invite_sites_for_role(role: AdminRole, site_ids: list[str]) -> None:
    if role == AdminRole.SUPERADMIN:
        return
    if not site_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Selecione pelo menos um site para este administrador.")