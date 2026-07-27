from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


def _fernet() -> Fernet:
    return Fernet(get_settings().fernet_key.encode("utf-8"))


def encrypt_text(value: str | None) -> str | None:
    if not value:
        return None
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_text(value: str | None) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return ""


def mask_email(value: str) -> str:
    local, sep, domain = (value or "").partition("@")
    if not sep:
        return "***"
    if len(local) <= 1:
        return f"{local[:1]}***@{domain}"
    return f"{local[0]}***@{domain}"


def mask_cpf(value: str) -> str:
    digits = "".join(ch for ch in value if ch.isdigit())
    return f"***.***.***-{digits[-2:]}" if len(digits) == 11 else "***"


def mask_mac(value: str) -> str:
    parts = (value or "").split(":")
    if len(parts) == 6:
        return f"XX:XX:XX:{parts[3]}:{parts[4]}:{parts[5]}".upper()
    return "XX:XX:XX:XX:XX:XX"


def mask_phone(value: str) -> str:
    digits = "".join(ch for ch in value if ch.isdigit())
    return f"***{digits[-4:]}" if len(digits) >= 4 else "***"
