import argparse
import getpass
from urllib.parse import urlsplit

from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.core.database import SessionLocal, engine
from app.models import AdminRole, AdminUser
from app.security.passwords import hash_password


def create_admin() -> int:
    email = input("email: ").strip().lower()
    name = input("nome: ").strip()
    role_raw = input("role [SUPERADMIN/ADMIN/VIEWER]: ").strip().upper() or "VIEWER"
    if role_raw not in AdminRole.__members__:
        print("Role invalida.")
        return 1
    password = getpass.getpass("senha: ")
    confirm = getpass.getpass("confirme a senha: ")
    if password != confirm:
        print("As senhas nao conferem.")
        return 1
    if len(password) < 12:
        print("A senha deve ter pelo menos 12 caracteres.")
        return 1
    db = SessionLocal()
    try:
        if db.query(AdminUser).filter(AdminUser.email == email).first():
            print("Administrador ja existe.")
            return 1
        db.add(AdminUser(email=email, name=name, role=AdminRole[role_raw], password_hash=hash_password(password)))
        db.commit()
        print("Administrador criado.")
        return 0
    finally:
        db.close()


def _masked_database_url(raw_url: str) -> dict[str, str]:
    if not raw_url:
        return {"configured": "no"}
    url = make_url(raw_url)
    host = url.host or ""
    return {
        "configured": "yes",
        "driver": url.drivername,
        "username": url.username or "",
        "host": host,
        "port": str(url.port or ""),
        "database": url.database or "",
    }


def db_diagnostics(target: str) -> int:
    settings = get_settings()
    raw_url = settings.migration_database_url if target == "migration" else settings.database_url
    print({"target": target, "url": _masked_database_url(raw_url)})
    if target == "runtime":
        with engine.connect() as conn:
            row = conn.execute(
                text("select current_database(), current_schema(), current_user")
            ).one()
            revision = conn.execute(text("select version_num from alembic_version limit 1")).scalar_one_or_none()
            print(
                {
                    "database": row[0],
                    "schema": row[1],
                    "user": row[2],
                    "alembicRevision": revision,
                }
            )
    else:
        parsed = urlsplit(raw_url)
        print({"database": parsed.path.lstrip("/"), "host": parsed.hostname or "", "username": parsed.username or ""})
    return 0

def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("create-admin")
    db_diag = sub.add_parser("db-diagnostics")
    db_diag.add_argument("--target", choices=["runtime", "migration"], default="runtime")
    args = parser.parse_args()
    if args.command == "create-admin":
        return create_admin()
    if args.command == "db-diagnostics":
        return db_diagnostics(args.target)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
