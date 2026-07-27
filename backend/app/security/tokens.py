import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from app.core.config import get_settings


def utcnow() -> datetime:
    return datetime.now(UTC)


def random_token_urlsafe(bytes_len: int = 32) -> str:
    return secrets.token_urlsafe(bytes_len)


def secret_hash(value: str) -> str:
    key = get_settings().secret_key
    return hashlib.sha256(f"{value}:{key}".encode()).hexdigest()


def expires_in(minutes: int) -> datetime:
    return utcnow() + timedelta(minutes=minutes)
