import argparse
import getpass

from app.core.database import SessionLocal
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


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("create-admin")
    args = parser.parse_args()
    if args.command == "create-admin":
        return create_admin()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
