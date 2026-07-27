from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_MARKERS = {"", "changeme", "change-me", "troque-aqui", "default", "secret"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field(default="development", validation_alias="APP_ENV")
    debug: bool = Field(default=False, validation_alias="DEBUG")
    public_base_url: str = Field(default="https://portal.gabineteitinerante.com.br", validation_alias="PUBLIC_BASE_URL")
    trusted_proxy_ips: str = Field(default="", validation_alias="TRUSTED_PROXY_IPS")

    database_url: str = Field(default="", validation_alias="DATABASE_URL")
    migration_database_url: str = Field(default="", validation_alias="MIGRATION_DATABASE_URL")
    secret_key: str = Field(default="", validation_alias="SECRET_KEY")
    fernet_key: str = Field(default="", validation_alias="FERNET_KEY")

    allowed_origins: str = Field(default="https://portal.gabineteitinerante.com.br,https://portal-system.gabineteitinerante.com.br", validation_alias="ALLOWED_ORIGINS")
    session_cookie_name: str = Field(default="portal_admin_session", validation_alias="SESSION_COOKIE_NAME")
    csrf_cookie_name: str = Field(default="portal_csrf", validation_alias="CSRF_COOKIE_NAME")
    admin_session_minutes: int = Field(default=480, validation_alias="ADMIN_SESSION_MINUTES")

    unifi_base_url: str = Field(default="https://unifi.gabineteitinerante.com.br:11443", validation_alias="UNIFI_BASE_URL")
    unifi_api_key: str = Field(default="", validation_alias="UNIFI_API_KEY")
    unifi_site: str = Field(default="Default", validation_alias="UNIFI_SITE")
    unifi_api_prefix: str = Field(default="/proxy/network/integration/v1", validation_alias="UNIFI_API_PREFIX")
    unifi_verify_ssl: bool = Field(default=True, validation_alias="UNIFI_VERIFY_SSL")
    unifi_timeout_seconds: float = Field(default=10.0, validation_alias="UNIFI_TIMEOUT_SECONDS")

    smtp_host: str = Field(default="", validation_alias="SMTP_HOST")
    smtp_port: int = Field(default=587, validation_alias="SMTP_PORT")
    smtp_user: str = Field(default="", validation_alias="SMTP_USER")
    smtp_password: str = Field(default="", validation_alias="SMTP_PASSWORD")
    smtp_from: str = Field(default="Wi-Fi Guest <no-reply@example.com>", validation_alias="SMTP_FROM")
    smtp_timeout_seconds: float = Field(default=10.0, validation_alias="SMTP_TIMEOUT_SECONDS")

    data_retention_days: int = Field(default=90, validation_alias="DATA_RETENTION_DAYS")
    rate_limit_window_seconds: int = Field(default=3600, validation_alias="RATE_LIMIT_WINDOW_SECONDS")
    rate_limit_max_attempts: int = Field(default=8, validation_alias="RATE_LIMIT_MAX_ATTEMPTS")
    provisional_access_minutes: int = Field(default=1, validation_alias="PROVISIONAL_ACCESS_MINUTES")
    auth_form_access_minutes: int = Field(default=5, validation_alias="AUTH_FORM_ACCESS_MINUTES")

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    def validate_runtime(self) -> None:
        if not self.is_production:
            return
        required = {
            "DATABASE_URL": self.database_url,
            "MIGRATION_DATABASE_URL": self.migration_database_url,
            "SECRET_KEY": self.secret_key,
            "FERNET_KEY": self.fernet_key,
            "UNIFI_BASE_URL": self.unifi_base_url,
            "UNIFI_API_KEY": self.unifi_api_key,
            "SMTP_HOST": self.smtp_host,
            "SMTP_USER": self.smtp_user,
            "SMTP_PASSWORD": self.smtp_password,
        }
        bad = [name for name, value in required.items() if value.strip().lower() in INSECURE_MARKERS]
        if bad:
            raise RuntimeError(f"Production secrets/config missing or insecure: {', '.join(bad)}")
        if "sqlite" in self.database_url.lower() or "mysql" in self.database_url.lower():
            raise RuntimeError("Production requires Neon PostgreSQL DATABASE_URL.")
        if not self.unifi_verify_ssl:
            raise RuntimeError("Production requires UNIFI_VERIFY_SSL=true.")
        if "*" in self.cors_origins:
            raise RuntimeError("Production must not allow CORS '*'.")
        if len(self.secret_key) < 32:
            raise RuntimeError("SECRET_KEY must contain at least 32 characters.")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_runtime()
    return settings

