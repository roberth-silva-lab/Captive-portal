import re
from datetime import datetime

from pydantic import AliasChoices, BaseModel, EmailStr, Field, field_validator

from app.models import NotificationType


def normalize_mac(value: str) -> str:
    raw = re.sub(r"[^0-9a-fA-F]", "", value or "")
    if len(raw) != 12:
        raise ValueError("MAC invalido.")
    return ":".join(raw[i : i + 2] for i in range(0, 12, 2)).lower()


def normalize_cpf(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) != 11 or len(set(digits)) == 1:
        raise ValueError("CPF invalido.")

    def check_digit(factor: int) -> int:
        total = sum(int(digit) * (factor - index) for index, digit in enumerate(digits[: factor - 1]))
        rest = (total * 10) % 11
        return 0 if rest == 10 else rest

    if check_digit(10) != int(digits[9]) or check_digit(11) != int(digits[10]):
        raise ValueError("CPF invalido.")
    return digits


class PortalContext(BaseModel):
    clientMac: str = Field(validation_alias=AliasChoices("clientMac", "mac"))
    apMac: str | None = Field(default=None, validation_alias=AliasChoices("apMac", "ap"))
    ip: str | None = None
    ssid: str | None = None
    site: str | None = None
    redirectUrl: str | None = None
    unifiToken: str | None = Field(default=None, validation_alias=AliasChoices("unifiToken", "token", "t"))
    termsAccepted: bool = Field(default=False)

    @field_validator("clientMac")
    @classmethod
    def valid_client_mac(cls, value: str) -> str:
        return normalize_mac(value)

    @field_validator("apMac")
    @classmethod
    def valid_ap_mac(cls, value: str | None) -> str | None:
        return normalize_mac(value) if value else None

    @field_validator("termsAccepted")
    @classmethod
    def accepted_terms(cls, value: bool) -> bool:
        if not value:
            raise ValueError("E necessario aceitar os termos de uso.")
        return value


class ProvisionalAccessRequest(BaseModel):
    clientMac: str = Field(validation_alias=AliasChoices("clientMac", "mac"))
    apMac: str | None = Field(default=None, validation_alias=AliasChoices("apMac", "ap"))
    ip: str | None = None
    ssid: str | None = None
    site: str | None = None
    unifiToken: str | None = Field(default=None, validation_alias=AliasChoices("unifiToken", "token", "t"))

    @field_validator("clientMac")
    @classmethod
    def valid_client_mac(cls, value: str) -> str:
        return normalize_mac(value)

    @field_validator("apMac")
    @classmethod
    def valid_ap_mac(cls, value: str | None) -> str | None:
        return normalize_mac(value) if value else None


class SessionControlRequest(BaseModel):
    clientMac: str = Field(validation_alias=AliasChoices("clientMac", "mac"))
    sessionId: str = Field(min_length=8, max_length=64)

    @field_validator("clientMac")
    @classmethod
    def valid_client_mac(cls, value: str) -> str:
        return normalize_mac(value)


class VoucherAuthRequest(PortalContext):
    code: str = Field(min_length=3, max_length=64, validation_alias=AliasChoices("code", "voucher_code", "voucherCode"))


class CpfAuthRequest(PortalContext):
    name: str = Field(min_length=2, max_length=160)
    cpf: str = Field(min_length=11, max_length=14)
    phone: str | None = Field(default=None, max_length=20)

    @field_validator("name")
    @classmethod
    def explicit_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 2:
            raise ValueError("Nome obrigatorio.")
        return cleaned

    @field_validator("cpf")
    @classmethod
    def valid_cpf(cls, value: str) -> str:
        return normalize_cpf(value)

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str | None) -> str | None:
        if not value:
            return None
        digits = re.sub(r"\D", "", value)
        if len(digits) not in {10, 11}:
            raise ValueError("Telefone invalido.")
        return digits


class EmailCodeRequest(PortalContext):
    email: EmailStr


class EmailCodeVerify(PortalContext):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)

    @field_validator("code")
    @classmethod
    def six_digits(cls, value: str) -> str:
        if not re.fullmatch(r"\d{6}", value):
            raise ValueError("Código invalido.")
        return value


class NotificationResponse(BaseModel):
    id: str
    type: NotificationType
    title: str
    message: str
    startsAt: datetime | None = None
    endsAt: datetime | None = None
    site: str = "ALL"


class MaintenanceResponse(BaseModel):
    enabled: bool = False
    active: bool = False
    scheduled: bool = False
    title: str = ""
    message: str = ""
    startsAt: datetime | None = None
    endsAt: datetime | None = None
    imageUrl: str = ""
    visualConfig: dict = Field(default_factory=dict)


class AuthResponse(BaseModel):
    ok: bool = True
    sessionId: str
    sessionMinutes: int
    authorizedAt: datetime
    expiresAt: datetime
    remainingSeconds: int
    totalSeconds: int
    authorized: bool = True
    nextCheckSeconds: int = 30


class SessionStatusResponse(BaseModel):
    status: str
    authorized: bool = False
    authorizedAt: datetime | None = None
    expiresAt: datetime | None = None
    serverNow: datetime
    remainingSeconds: int
    remainingMinutes: int
    sessionMinutes: int
    totalSeconds: int = 0
    networkName: str = ""
    establishmentName: str = ""
    contractedSpeedMbps: int = 100
    ssid: str = ""
    warningMinutes: int | None = None
    warningMessage: str | None = None
    nextCheckSeconds: int = 30


class PortalSettingsResponse(BaseModel):
    logoUrl: str = ""
    primaryColor: str = "#123c34"
    bannerText: str = "Hotspot para Convidados"
    welcomeText: str = "Bem-vindo. Conecte-se de forma segura."
    termsText: str
    defaultSessionMinutes: int = 60
    networkName: str
    establishmentName: str
    contractedSpeedMbps: int = 100
    maintenanceMode: bool = False
    maintenance: MaintenanceResponse = Field(default_factory=MaintenanceResponse)
    notifications: list[NotificationResponse] = Field(default_factory=list)
    expirationWarningMinutes: list[int] = Field(default_factory=lambda: [30, 10, 5])
    allowedAuthMethods: list[str] = Field(default_factory=lambda: ["voucher", "cpf", "email"])