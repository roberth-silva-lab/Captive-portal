import os

os.environ["APP_ENV"] = "test"
os.environ["DEBUG"] = "false"
os.environ["DATABASE_URL"] = "sqlite:///./test_portal.db"
os.environ["MIGRATION_DATABASE_URL"] = "sqlite:///./test_portal.db"
os.environ["SECRET_KEY"] = "test-secret-key-with-more-than-32-characters"
os.environ["FERNET_KEY"] = "fY8lXl9M2N8Q2s1aM9m5K5vN5Jv9QhQn9JtXxGQj1iA="
os.environ["UNIFI_BASE_URL"] = "https://unifi.example.test"
os.environ["UNIFI_API_KEY"] = "test-key"
os.environ["UNIFI_VERIFY_SSL"] = "true"
os.environ["ALLOWED_ORIGINS"] = "https://portal.gabineteitinerante.com.br"
os.environ["SMTP_HOST"] = "smtp.test"
os.environ["SMTP_USER"] = "smtp@test"
os.environ["SMTP_PASSWORD"] = "test"
os.environ["SESSION_EXPIRER_ENABLED"] = "false"

import pytest
from fastapi.testclient import TestClient

from app.core.database import Base, engine
from app.main import app
from app.models import AdminRole, AdminUser
from app.security.passwords import hash_password


@pytest.fixture(autouse=True)
def db_schema():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin_user():
    from app.core.database import SessionLocal

    db = SessionLocal()
    user = AdminUser(email="admin@example.com", name="Admin", role=AdminRole.SUPERADMIN, password_hash=hash_password("StrongPassword123!"))
    db.add(user)
    db.commit()
    db.refresh(user)
    db.close()
    return user
