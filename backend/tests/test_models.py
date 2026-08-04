from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models import AdminRole, AdminUser
from app.security.passwords import hash_password


def test_admin_model_roles():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    db.add(AdminUser(email="admin@example.com", name="Admin", role=AdminRole.SUPERADMIN, password_hash=hash_password("StrongPassword123")))
    db.commit()
    assert db.query(AdminUser).first().role == AdminRole.SUPERADMIN

def test_admin_user_schema_does_not_include_voucher_operation_columns():
    columns = set(AdminUser.__table__.columns.keys())
    assert {"description", "created_by", "revoked_at", "revoked_by"}.isdisjoint(columns)


def test_voucher_schema_keeps_operation_columns():
    from app.models import Voucher

    columns = set(Voucher.__table__.columns.keys())
    assert {"description", "created_by", "revoked_at", "revoked_by"}.issubset(columns)
