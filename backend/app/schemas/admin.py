from datetime import datetime
from typing import Any

from pydantic import AliasChoices, BaseModel, EmailStr, Field, field_validator, model_validator

from app.models import AdminRole, NotificationType

VALID_SITES = {"ALL", "Default", "Sede", "Esdras", "DMA"}
VALID_AUTH_METHODS = {"voucher", "cpf", "email"}


def normalize_auth_methods(value: list[str]) -> list[str]:
    methods: list[str] = []
    for item in value:
        method = str(item).strip().lower()
        if method not in VALID_AUTH_METHODS:
            raise ValueError("Método de autenticação inválido.")
        if method not in methods:
            methods.append(method)
    if not methods:
        raise ValueError("Selecione ao menos um método de autenticação.")
    return methods


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)




class AdminLoginCodeRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    code: str = Field(min_length=6, max_length=6, pattern="^[0-9]{6}$")


class AdminLoginChallengeResponse(BaseModel):
    mfaRequired: bool = True
    email: EmailStr
    expiresAt: datetime


class AdminPasswordResetRequest(BaseModel):
    email: EmailStr


class AdminEmailTestRequest(BaseModel):
    email: EmailStr


class AdminPasswordResetConfirmRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern="^[0-9]{6}$")
    password: str = Field(min_length=12, max_length=128)
    confirmPassword: str = Field(validation_alias=AliasChoices("confirmPassword", "confirm_password"), min_length=12, max_length=128)

    @field_validator("confirmPassword")
    @classmethod
    def reset_passwords_match(cls, value: str, info):
        if "password" in info.data and value != info.data["password"]:
            raise ValueError("As senhas não conferem.")
        return value
class AdminMe(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: AdminRole
    siteIds: list[str] = Field(default_factory=list)
    canSelectAllSites: bool = False


class AdminInviteCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=160)
    role: AdminRole = AdminRole.VIEWER
    siteIds: list[str] = Field(default_factory=list, max_length=20)


class AdminInviteResponse(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: AdminRole
    expiresAt: datetime
    acceptedAt: datetime | None = None
    revokedAt: datetime | None = None
    deliveryStatus: str
    inviteUrl: str | None = None
    siteIds: list[str] = Field(default_factory=list)


class AdminInviteValidateResponse(BaseModel):
    email: EmailStr
    name: str
    role: AdminRole
    expiresAt: datetime
    siteIds: list[str] = Field(default_factory=list)

class AdminInviteAcceptRequest(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    password: str = Field(min_length=12, max_length=128)
    confirmPassword: str = Field(validation_alias=AliasChoices("confirmPassword", "confirm_password"), min_length=12, max_length=128)
    acceptedPolicy: bool = Field(validation_alias=AliasChoices("acceptedPolicy", "accepted_policy"))

    @field_validator("token")
    @classmethod
    def clean_token(cls, value: str) -> str:
        return value.strip()

    @field_validator("confirmPassword")
    @classmethod
    def passwords_match(cls, value: str, info):
        if "password" in info.data and value != info.data["password"]:
            raise ValueError("As senhas não conferem.")
        return value

    @field_validator("acceptedPolicy")
    @classmethod
    def policy_required(cls, value: bool) -> bool:
        if not value:
            raise ValueError("É necessário aceitar a política administrativa.")
        return value

class SessionActionRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class SessionExtendRequest(SessionActionRequest):
    additionalMinutes: int = Field(gt=0, le=1440)


class SessionReauthorizeRequest(SessionActionRequest):
    durationMinutes: int = Field(gt=0, le=1440)


class SessionBlockRequest(SessionActionRequest):
    scope: str = Field(default="SITE", pattern="^(SITE|GLOBAL)$")
    durationMinutes: int | None = Field(default=None, gt=0, le=525600)


class SessionOperationResponse(BaseModel):
    status: str
    unifiConfirmed: bool
    message: str
    sessionId: str
    operationState: str
    blockId: str | None = None
    newSessionId: str | None = None
    expiresAt: datetime | None = None


class SensitiveSessionRevealRequest(BaseModel):
    reason: str = Field(min_length=8, max_length=300)


class SensitiveSessionRevealResponse(BaseModel):
    sessionId: str
    name: str = ""
    email: str = ""
    cpf: str = ""
    phone: str = ""
    revealedAt: datetime


class AccessBlockResponse(BaseModel):
    id: str
    scope: str
    siteId: str | None = None
    deviceMacLabel: str
    reason: str
    startsAt: datetime
    expiresAt: datetime | None = None
    revokedAt: datetime | None = None
    createdBy: str


class AuthAttemptResponse(BaseModel):
    id: int
    method: str
    success: bool
    reason: str
    createdAt: datetime

class DashboardSummary(BaseModel):
    connectedNow: int
    activeSessions: int
    connections24h: int
    connections7d: int
    connections30d: int
    averageDurationSeconds: int
    deviceCount: int
    expiredSessions: int
    vouchersUsed: int
    vouchersAvailable: int
    authAttempts: int
    authFailures: int
    onlineUsers: int
    expiringIn30Minutes: int
    expiringIn10Minutes: int
    scheduledMaintenances: int
    activeNotifications: int
    sessionsEndedToday: int
    averageSessionSeconds: int


class SiteNode(BaseModel):
    name: str
    siteId: str = ""
    status: str
    aps: int = 0
    connectedClients: int = 0
    sessions: int = 0
    allowed: bool = True
    authMethods: list[str] = Field(default_factory=lambda: ["voucher", "cpf", "email"])


class VoucherCreateRequest(BaseModel):
    description: str = Field(default="", max_length=240)
    quantity: int = Field(default=1, gt=0, le=500)
    durationMinutes: int = Field(default=120, gt=0, le=10080)
    unlimitedDuration: bool = False
    deliveryEmail: EmailStr | None = None
    timeLimitMinutes: int | None = Field(default=None, gt=0, le=10080)
    dataLimitMb: int | None = Field(default=None, gt=0)
    downloadLimit: int | None = Field(default=None, gt=0)
    uploadLimit: int | None = Field(default=None, gt=0)
    deviceLimit: int = Field(default=1, gt=0, le=100)
    maxDevices: int | None = Field(default=None, gt=0, le=100)
    site: str = "Default"
    siteId: str | None = None
    enabled: bool = True
    expiresAt: datetime | None = None

    @field_validator("site")
    @classmethod
    def valid_site(cls, value: str) -> str:
        if value not in VALID_SITES:
            raise ValueError("Site inválido.")
        return value

class VoucherUpdateRequest(BaseModel):
    description: str = Field(default="", max_length=240)
    durationMinutes: int = Field(default=120, gt=0, le=10080)
    unlimitedDuration: bool = False
    timeLimitMinutes: int | None = Field(default=None, gt=0, le=10080)
    dataLimitMb: int | None = Field(default=None, gt=0)
    downloadLimit: int | None = Field(default=None, gt=0)
    uploadLimit: int | None = Field(default=None, gt=0)
    deviceLimit: int = Field(default=1, gt=0, le=100)
    maxDevices: int | None = Field(default=None, gt=0, le=100)
    site: str = "Default"
    siteId: str | None = None
    enabled: bool = True
    expiresAt: datetime | None = None

    @field_validator("site")
    @classmethod
    def valid_site(cls, value: str) -> str:
        if value not in VALID_SITES:
            raise ValueError("Site inválido.")
        return value

class VoucherResponse(BaseModel):
    id: str
    codeLabel: str
    description: str = ""
    status: str
    durationMinutes: int
    unlimitedDuration: bool = False
    timeLimitMinutes: int | None = None
    dataLimitMb: int | None = None
    downloadLimit: int | None = None
    uploadLimit: int | None = None
    deviceLimit: int
    maxDevices: int
    site: str
    siteId: str = ""
    siteName: str = ""
    enabled: bool
    expiresAt: datetime | None = None
    usedCount: int
    isActive: bool
    createdAt: datetime
    revokedAt: datetime | None = None


class CreatedVoucherCode(BaseModel):
    id: str
    code: str
    codeLabel: str
    site: str
    durationMinutes: int
    unlimitedDuration: bool = False
    expiresAt: datetime | None = None


class VoucherBatchCreateResponse(BaseModel):
    created: int
    vouchers: list[CreatedVoucherCode]
    emailDeliveryStatus: str = "not_requested"
    emailSentTo: EmailStr | None = None


class PortalAppearanceRequest(BaseModel):
    networkName: str = Field(default="Wi-Fi Visitante", min_length=1, max_length=160)
    establishmentName: str = Field(default="Gabinete Itinerante", min_length=1, max_length=160)
    logoUrl: str = Field(default="", max_length=2048)
    primaryColor: str = Field(default="#176b87", pattern=r"^#[0-9a-fA-F]{6}$")
    bannerText: str = Field(default="Portal de Acesso Wi-Fi", min_length=1, max_length=160)
    welcomeText: str = Field(default="Conecte-se de forma segura à rede de visitantes.", min_length=1, max_length=300)
    successMessage: str = Field(default="Acesso liberado. Você já pode navegar na Internet.", min_length=1, max_length=300)
    expiredMessage: str = Field(default="Sua sessão expirou. Autentique-se novamente para continuar usando o Wi-Fi.", min_length=1, max_length=300)
    termsText: str = Field(default="Ao continuar, você aceita os termos de uso da rede.", min_length=1, max_length=8000)
    authMethods: list[str] = Field(default_factory=lambda: ["voucher", "cpf", "email"], min_length=1, max_length=3)

    @field_validator("authMethods")
    @classmethod
    def valid_auth_methods(cls, value: list[str]) -> list[str]:
        return normalize_auth_methods(value)


class PortalAppearanceResponse(PortalAppearanceRequest):
    updatedAt: datetime | None = None
class PortalSiteAppearanceRequest(PortalAppearanceRequest):
    siteName: str = Field(default="", max_length=160)
    enabled: bool = True


class PortalSiteAppearanceResponse(PortalAppearanceResponse):
    siteId: str
    siteName: str
    enabled: bool = True
    hasOverride: bool = False


class MaintenanceUpdateRequest(BaseModel):
    maintenanceEnabled: bool = False
    maintenanceTitle: str = Field(default="Portal em manutenção", min_length=1, max_length=160)
    maintenanceMessage: str = Field(default="Estamos realizando ajustes para melhorar o acesso.", min_length=1, max_length=2000)
    maintenanceStartAt: datetime | None = None
    maintenanceEndAt: datetime | None = None
    maintenanceImageUrl: str = Field(default="", max_length=2048)
    maintenanceVisualConfig: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid_window(self):
        if self.maintenanceStartAt and self.maintenanceEndAt:
            start = self.maintenanceStartAt
            end = self.maintenanceEndAt
            if (start.tzinfo is None) != (end.tzinfo is None):
                if start.tzinfo is None:
                    end = end.replace(tzinfo=None)
                else:
                    start = start.replace(tzinfo=None)
            if end <= start:
                raise ValueError("O término da manutenção deve ser posterior ao início.")
        return self


class MaintenanceAdminResponse(BaseModel):
    maintenanceEnabled: bool
    maintenanceActive: bool
    maintenanceScheduled: bool
    maintenanceExpired: bool = False
    maintenanceStatus: str = "disabled"
    maintenanceNextChangeAt: datetime | None = None
    maintenanceScope: str = "global"
    maintenanceInherited: bool = False
    maintenanceTitle: str
    maintenanceMessage: str
    maintenanceStartAt: datetime | None = None
    maintenanceEndAt: datetime | None = None
    maintenanceImageUrl: str = ""
    maintenanceVisualConfig: dict[str, Any] = Field(default_factory=dict)
    updatedAt: datetime | None = None




class MediaAssetResponse(BaseModel):
    id: str
    assetType: str
    originalFilename: str
    contentType: str
    byteSize: int
    width: int
    height: int
    publicUrl: str
    createdAt: datetime


class NotificationCreateRequest(BaseModel):
    type: NotificationType
    title: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=2000)
    startsAt: datetime | None = None
    endsAt: datetime | None = None
    site: str = "ALL"
    enabled: bool = True

    @field_validator("site")
    @classmethod
    def valid_site(cls, value: str) -> str:
        if value not in VALID_SITES:
            raise ValueError("Site inválido.")
        return value


class NotificationUpdateRequest(NotificationCreateRequest):
    pass


class NotificationAdminResponse(BaseModel):
    id: str
    type: NotificationType
    title: str
    message: str
    startsAt: datetime | None = None
    endsAt: datetime | None = None
    site: str
    enabled: bool
    createdAt: datetime
    updatedAt: datetime
class AllowedSiteResponse(BaseModel):
    siteId: str
    name: str
    allowed: bool = True


class AdminSiteAccessUpdateRequest(BaseModel):
    siteIds: list[str] = Field(default_factory=list, max_length=20)
