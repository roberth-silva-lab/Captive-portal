from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models import AdminRole, NotificationType

VALID_SITES = {"ALL", "Default", "Sede", "Esdras", "DMA"}


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class AdminMe(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: AdminRole


class AdminCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=160)
    role: AdminRole = AdminRole.VIEWER


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
    status: str
    aps: int = 0
    connectedClients: int = 0
    sessions: int = 0


class VoucherCreateRequest(BaseModel):
    code: str = Field(min_length=3, max_length=64)
    durationMinutes: int = Field(gt=0, le=1440)
    timeLimitMinutes: int | None = Field(default=None, gt=0, le=1440)
    dataLimitMb: int | None = Field(default=None, gt=0)
    downloadLimit: int | None = Field(default=None, gt=0)
    uploadLimit: int | None = Field(default=None, gt=0)
    deviceLimit: int = Field(default=1, gt=0, le=100)
    maxDevices: int | None = Field(default=None, gt=0, le=100)
    site: str = "Default"
    enabled: bool = True
    expiresAt: datetime | None = None

    @field_validator("site")
    @classmethod
    def valid_site(cls, value: str) -> str:
        if value not in VALID_SITES - {"ALL"}:
            raise ValueError("Site invalido.")
        return value


class VoucherResponse(BaseModel):
    id: str
    codeLabel: str
    durationMinutes: int
    timeLimitMinutes: int | None = None
    dataLimitMb: int | None = None
    downloadLimit: int | None = None
    uploadLimit: int | None = None
    deviceLimit: int
    maxDevices: int
    site: str
    enabled: bool
    expiresAt: datetime | None = None
    usedCount: int
    isActive: bool
    createdAt: datetime


class MaintenanceUpdateRequest(BaseModel):
    maintenanceEnabled: bool = False
    maintenanceTitle: str = Field(default="Portal em manutencao", min_length=1, max_length=160)
    maintenanceMessage: str = Field(default="Estamos realizando ajustes para melhorar o acesso.", min_length=1, max_length=2000)
    maintenanceStartAt: datetime | None = None
    maintenanceEndAt: datetime | None = None
    maintenanceImageUrl: str = Field(default="", max_length=2048)
    maintenanceVisualConfig: dict = Field(default_factory=dict)


class MaintenanceAdminResponse(BaseModel):
    maintenanceEnabled: bool
    maintenanceActive: bool
    maintenanceScheduled: bool
    maintenanceTitle: str
    maintenanceMessage: str
    maintenanceStartAt: datetime | None = None
    maintenanceEndAt: datetime | None = None
    maintenanceImageUrl: str = ""
    maintenanceVisualConfig: dict = Field(default_factory=dict)
    updatedAt: datetime | None = None


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
            raise ValueError("Site invalido.")
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