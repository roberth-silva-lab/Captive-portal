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
