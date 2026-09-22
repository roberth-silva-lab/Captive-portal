import ipaddress
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_MARKERS = {"", "changeme", "change-me", "troque-aqui", "default", "secret"}
VALID_UNIFI_AUTH_MODES = {"integration", "legacy"}
ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


def _is_local_or_private_url(value: str) -> bool:
    try:
        host = (urlparse(value).hostname or "").strip().lower()
        if host in {"localhost"}:
            return True
        address = ipaddress.ip_address(host)
        return address.is_private or address.is_loopback
    except ValueError:
        return False


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT_ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field(default="development", validation_alias="APP_ENV")
    debug: bool = Field(default=False, validation_alias="DEBUG")
    public_base_url: str = Field(default="https://portal.gabineteitinerante.com.br", validation_alias="PUBLIC_BASE_URL")
    admin_base_url: str = Field(default="https://portal-system.gabineteitinerante.com.br", validation_alias="ADMIN_BASE_URL")
    trusted_proxy_ips: str = Field(default="", validation_alias="TRUSTED_PROXY_IPS")

    database_url: str = Field(default="", validation_alias="DATABASE_URL")
    migration_database_url: str = Field(default="", validation_alias="MIGRATION_DATABASE_URL")
    database_pool_size: int = Field(default=10, validation_alias="DATABASE_POOL_SIZE")
    database_max_overflow: int = Field(default=10, validation_alias="DATABASE_MAX_OVERFLOW")
    database_pool_timeout_seconds: int = Field(default=30, validation_alias="DATABASE_POOL_TIMEOUT_SECONDS")
    secret_key: str = Field(default="", validation_alias="SECRET_KEY")
    fernet_key: str = Field(default="", validation_alias="FERNET_KEY")

    allowed_origins: str = Field(default="https://portal.gabineteitinerante.com.br,https://portal-system.gabineteitinerante.com.br", validation_alias="ALLOWED_ORIGINS")
    session_cookie_name: str = Field(default="portal_admin_session", validation_alias="SESSION_COOKIE_NAME")
    csrf_cookie_name: str = Field(default="portal_csrf", validation_alias="CSRF_COOKIE_NAME")
    admin_session_minutes: int = Field(default=480, validation_alias="ADMIN_SESSION_MINUTES")
    admin_email_mfa_required: bool = Field(default=False, validation_alias="ADMIN_EMAIL_MFA_REQUIRED")
    admin_mfa_code_ttl_minutes: int = Field(default=10, validation_alias="ADMIN_MFA_CODE_TTL_MINUTES")
    admin_password_reset_ttl_minutes: int = Field(default=15, validation_alias="ADMIN_PASSWORD_RESET_TTL_MINUTES")

    unifi_auth_mode: str = Field(default="integration", validation_alias="UNIFI_AUTH_MODE")
    unifi_base_url: str = Field(default="https://unifi.gabineteitinerante.com.br:11443", validation_alias="UNIFI_BASE_URL")
    unifi_api_key: str = Field(default="", validation_alias="UNIFI_API_KEY")
    unifi_username: str = Field(default="", validation_alias="UNIFI_USERNAME")
    unifi_password: str = Field(default="", validation_alias="UNIFI_PASSWORD")
    unifi_site: str = Field(default="Default", validation_alias="UNIFI_SITE")
    unifi_site_label: str = Field(default="", validation_alias="UNIFI_SITE_LABEL")
    unifi_api_prefix: str = Field(default="/proxy/network/integration/v1", validation_alias="UNIFI_API_PREFIX")
    unifi_verify_ssl: bool = Field(default=True, validation_alias="UNIFI_VERIFY_SSL")
    unifi_timeout_seconds: float = Field(default=10.0, validation_alias="UNIFI_TIMEOUT_SECONDS")
    unifi_cache_ttl_seconds: float = Field(default=5.0, validation_alias="UNIFI_CACHE_TTL_SECONDS")

    smtp_host: str = Field(default="", validation_alias="SMTP_HOST")
    smtp_port: int = Field(default=587, validation_alias="SMTP_PORT")
    smtp_user: str = Field(default="", validation_alias="SMTP_USER")
    smtp_password: str = Field(default="", validation_alias="SMTP_PASSWORD")
    smtp_from: str = Field(default="Wi-Fi Guest <no-reply@example.com>", validation_alias="SMTP_FROM")
    smtp_timeout_seconds: float = Field(default=10.0, validation_alias="SMTP_TIMEOUT_SECONDS")
    email_code_ttl_minutes: int = Field(default=15, validation_alias="EMAIL_CODE_TTL_MINUTES")

    data_retention_days: int = Field(default=90, validation_alias="DATA_RETENTION_DAYS")
    rate_limit_window_seconds: int = Field(default=3600, validation_alias="RATE_LIMIT_WINDOW_SECONDS")
    rate_limit_max_attempts: int = Field(default=8, validation_alias="RATE_LIMIT_MAX_ATTEMPTS")
    provisional_access_minutes: int = Field(default=1, validation_alias="PROVISIONAL_ACCESS_MINUTES")
    auth_form_access_minutes: int = Field(default=5, validation_alias="AUTH_FORM_ACCESS_MINUTES")
    session_expirer_enabled: bool = Field(default=True, validation_alias="SESSION_EXPIRER_ENABLED")
    session_expirer_interval_seconds: int = Field(default=60, validation_alias="SESSION_EXPIRER_INTERVAL_SECONDS")
    session_expirer_batch_size: int = Field(default=50, validation_alias="SESSION_EXPIRER_BATCH_SIZE")
    media_storage_path: str = Field(default="/data/media", validation_alias="MEDIA_STORAGE_PATH")
    media_public_base_url: str = Field(default="/media", validation_alias="MEDIA_PUBLIC_BASE_URL")
    media_max_logo_bytes: int = Field(default=2097152, validation_alias="MEDIA_MAX_LOGO_BYTES")
    media_max_image_bytes: int = Field(default=5242880, validation_alias="MEDIA_MAX_IMAGE_BYTES")

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def require_admin_email_mfa(self) -> bool:
        return self.is_production or self.admin_email_mfa_required

    @property
    def normalized_unifi_auth_mode(self) -> str:
        return self.unifi_auth_mode.strip().lower()

    def validate_runtime(self) -> None:
        mode = self.normalized_unifi_auth_mode
        if mode not in VALID_UNIFI_AUTH_MODES:
            raise RuntimeError("UNIFI_AUTH_MODE must be 'integration' or 'legacy'.")
        if self.database_pool_size < 1 or self.database_max_overflow < 0 or self.database_pool_timeout_seconds < 1:
            raise RuntimeError("Database pool settings are invalid.")
        if not self.is_production:
            return

        required = {
            "DATABASE_URL": self.database_url,
            "MIGRATION_DATABASE_URL": self.migration_database_url,
            "SECRET_KEY": self.secret_key,
            "FERNET_KEY": self.fernet_key,
            "UNIFI_BASE_URL": self.unifi_base_url,
            "SMTP_HOST": self.smtp_host,
            "SMTP_USER": self.smtp_user,
            "SMTP_PASSWORD": self.smtp_password,
        }
        if mode == "integration":
            required["UNIFI_API_KEY"] = self.unifi_api_key
        else:
            required["UNIFI_USERNAME"] = self.unifi_username
            required["UNIFI_PASSWORD"] = self.unifi_password

        bad = [name for name, value in required.items() if value.strip().lower() in INSECURE_MARKERS]
        if bad:
            raise RuntimeError(f"Production secrets/config missing or insecure: {', '.join(bad)}")
        if "sqlite" in self.database_url.lower() or "mysql" in self.database_url.lower():
            raise RuntimeError("Production requires Neon PostgreSQL DATABASE_URL.")
        if mode == "integration" and not self.unifi_verify_ssl:
            raise RuntimeError("Integration API in production requires UNIFI_VERIFY_SSL=true.")
        if mode == "legacy" and not self.unifi_verify_ssl and not _is_local_or_private_url(self.unifi_base_url):
            raise RuntimeError("Legacy UniFi may disable TLS verification only for a local/private controller URL.")
        if "*" in self.cors_origins:
            raise RuntimeError("Production must not allow CORS '*'.")
        if len(self.secret_key) < 32:
            raise RuntimeError("SECRET_KEY must contain at least 32 characters.")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_runtime()
    return settings
