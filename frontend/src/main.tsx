import { Component, StrictMode, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  AlertTriangle,
  Copy,
  Building2,
  CheckCircle2,
  Clock,
  FileClock,
  Gauge,
  History,
  LockKeyhole,
  Megaphone,
  MonitorCheck,
  Radio,
  ShieldCheck,
  Settings,
  Ticket,
  UserCog,
  UserRound,
  UsersRound,
  Wifi,
  X,
} from 'lucide-react'
import { ApiError, api } from './api'
import { AcceptInvite } from './components/accept-invite'
import { AdminHeader, AdminSidebar, MaintenanceSummary, PageHeader } from './components/admin-layout'
import { NoticeAdminPanel } from './components/notices-panel'
import { PublicPortalExperience } from './components/public-portal-experience'
import { PublicPortalPreview } from './components/public-portal-preview'
import { VoucherPanel } from './components/vouchers-panel'
import { ConfirmDialog, EmptyState, InfoLine, InfoTile, Panel } from './components/shared'
import type {
  AccessPoint,
  AdminInviteResponse,
  AdminLoginChallenge,
  AdminMe,
  AllowedSite,
  AdminNotice,
  AdminSection,
  AdminUserRow,
  AuditEntry,
  AuthAttemptRow,
  AuthResponse,
  ClientRow,
  Dashboard,
  DashboardChartsData,
  EmailCodeResponse,
  GuestSessionRow,
  MaintenanceAdmin,
  MediaAsset,
  Method,
  PortalAppearance,
  PortalEditorTab,
  PortalSettings,
  PortalSiteAppearance,
  PreviewDevice,
  PreviewState,
  SessionFilter,
  SessionOperationResponse,
  SensitiveSessionReveal,
  SessionStatus,
  SiteNode,
  Stage,
  SystemHealth,
  Voucher,
} from './types'
import {
  boolValue,
  datetimeLocal,
  displayVoucher,
  formatClock,
  formatCountdown,
  formatCpf,
  formatMinutes,
  formatPhone,
  fromDatetimeLocal,
  isValidCpf,
  humanAudit,
  normalizeVoucher,
  onlyDigits,
  portalInstitutionName,
  portalParams,
  textValue,
  validEmail,
} from './utils'
import './styles.css'

const asArray = <T,>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value : []
const EMPTY_DASHBOARD_CHARTS: DashboardChartsData = { connectionsByDay: [], bestDays: [], quietDays: [], authMethods: [], longestSessions: [], periodDays: 30 }

const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
  logoUrl: '/leaoreceita.png',
  primaryColor: '#176b87',
  bannerText: 'Portal de Acesso Wi-Fi',
  welcomeText: 'Acesso seguro para visitantes',
  successMessage: 'Acesso liberado.',
  expiredMessage: 'Sua sessão expirou. Autentique-se novamente para continuar usando o Wi-Fi.',
  networkName: 'WiFi Visitantes',
  establishmentName: 'Receita Federal',
  termsText: `TERMOS DE USO DA REDE WI-FI

1. Dados coletados
Para liberar o acesso, podemos registrar nome, CPF, e-mail, telefone, endereço MAC, endereço IP, horário de conexão e ponto de acesso utilizado.

2. Finalidade
Os dados são usados para identificar usuários da rede, garantir segurança, cumprir obrigações legais e prevenir uso indevido do serviço.

3. Responsabilidade do usuário
O uso da internet é de sua responsabilidade. É proibido acessar conteúdo ilegal, violar direitos autorais ou praticar atividades que comprometam a rede.

4. Monitoramento
O estabelecimento pode registrar tentativas de acesso e suspender conexões em caso de uso indevido ou suspeita de fraude.

5. Privacidade (LGPD)
Dados pessoais sensíveis são protegidos e armazenados pelo tempo necessário. Para solicitar exclusão dos seus dados, contate o responsável pelo estabelecimento.

Ao marcar a opção abaixo, você confirma que leu e concorda com estas condições.`,
  maintenanceMode: false,
  maintenance: {
    enabled: false,
    active: false,
    scheduled: false,
    title: 'Portal em manutenção',
    message: 'Estamos realizando ajustes para melhorar o acesso.',
    startsAt: null,
    endsAt: null,
    imageUrl: '',
    visualConfig: {},
  },
  notifications: [],
  expirationWarningMinutes: [30, 10, 5],
  allowedAuthMethods: ['voucher', 'cpf', 'email'],
}

const isPortalSettings = (value: unknown): value is PortalSettings => {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<PortalSettings>
  return typeof record.networkName === 'string' && typeof record.establishmentName === 'string' && Boolean(record.maintenance)
}

const safeStorageGet = (key: string, fallback = '') => {
  try {
    return window.localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

const safeStorageSet = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Navegadores em modo restrito podem bloquear storage; o painel deve continuar abrindo.
  }
}

const uploadImageAsset = async (file: File, assetType: string) => {
  const formData = new FormData()
  formData.set('assetType', assetType)
  formData.set('file', file)
  return api<MediaAsset>('/api/admin/media', { method: 'POST', body: formData })
}

function Portal() {
  const params = useMemo(portalParams, [])
  const codeInputRef = useRef<HTMLInputElement | null>(null)
  const [settings, setSettings] = useState<PortalSettings | null>(null)
  const [method, setMethod] = useState<Method>('voucher')
  const [identifier, setIdentifier] = useState('')
  const [name, setName] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [phone, setPhone] = useState('')
  const [codeRequested, setCodeRequested] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'error'>('info')
  const [fieldError, setFieldError] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailCooldown, setEmailCooldown] = useState(0)
  const [emailExpiresAt, setEmailExpiresAt] = useState<string | null>(null)
  const [emailRemaining, setEmailRemaining] = useState(0)
  const [termsOpen, setTermsOpen] = useState(false)
  const [session, setSession] = useState<SessionStatus | null>(null)
  const [formInstanceKey, setFormInstanceKey] = useState(0)

  useEffect(() => {
    const query = new URLSearchParams({ site: params.site })
    if (params.clientMac) query.set('clientMac', params.clientMac)
    if (params.apMac) query.set('apMac', params.apMac)
    api<PortalSettings>(`/api/settings?${query.toString()}`)
      .then((data) => {
        if (isPortalSettings(data)) setSettings({ ...data, allowedAuthMethods: data.allowedAuthMethods?.length ? data.allowedAuthMethods : DEFAULT_PORTAL_SETTINGS.allowedAuthMethods })
        else throw new ApiError(502, 'Resposta inválida do servidor do portal.')
      })
      .catch((error) => {
        console.warn('Falha ao carregar configuração pública do portal', error)
      })
  }, [params.apMac, params.clientMac, params.site])

  useEffect(() => {
    if (!params.clientMac || !session?.sessionId || stage !== 'released') return
    const currentSessionId = session.sessionId
    const tick = () => api<SessionStatus>(`/api/session/status?clientMac=${encodeURIComponent(params.clientMac)}&sessionId=${encodeURIComponent(currentSessionId)}`).then((current) => { setSession({ ...current, sessionId: currentSessionId }); if (!current.authorized) { setStage('idle'); setMessage(settings?.expiredMessage || 'Sua sessão expirou. Autentique-se novamente para continuar usando o Wi-Fi.'); setMessageTone('error') } }).catch(() => undefined)
    tick()
    const handle = window.setInterval(tick, 30000)
    return () => window.clearInterval(handle)
  }, [params.clientMac, session?.sessionId, settings?.expiredMessage, stage])

  useEffect(() => {
    if (emailCooldown <= 0) return
    const handle = window.setTimeout(() => setEmailCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(handle)
  }, [emailCooldown])

  useEffect(() => {
    if (!emailExpiresAt) {
      setEmailRemaining(0)
      return
    }
    const tick = () => setEmailRemaining(Math.max(0, Math.floor((new Date(emailExpiresAt).getTime() - Date.now()) / 1000)))
    tick()
    const handle = window.setInterval(tick, 1000)
    return () => window.clearInterval(handle)
  }, [emailExpiresAt])

  const activeSettings = settings || DEFAULT_PORTAL_SETTINGS
  const institutionName = portalInstitutionName(activeSettings.establishmentName)
  const networkName = activeSettings.networkName || 'rede de visitantes'
  const isBusy = ['validating', 'authorizing', 'confirming', 'checking'].includes(stage)
  const basePayload = { ...params, termsAccepted: accepted }

  const clearPublicPii = () => {
    setIdentifier('')
    setName('')
    setEmailCode('')
    setPhone('')
    setCodeRequested(false)
    setEmailExpiresAt(null)
    setEmailRemaining(0)
    setFormInstanceKey((value) => value + 1)
  }

  const selectMethod = (selected: Method) => {
    setMethod(selected)
    clearPublicPii()
    setFieldError('')
    setMessage('')
    setStage('idle')
  }

  const updateIdentifier = (value: string) => {
    setFieldError('')
    if (method === 'cpf') setIdentifier(formatCpf(value))
    else if (method === 'voucher') setIdentifier(displayVoucher(value))
    else setIdentifier(value.trim())
  }

  const validate = () => {
    if (!accepted) {
      setFieldError('terms')
      setMessage('É obrigatório aceitar os termos de uso para continuar.')
      setMessageTone('error')
      return false
    }
    if (method === 'voucher' && normalizeVoucher(identifier).length < 3) {
      setFieldError('identifier')
      setMessage('Informe um voucher válido.')
      setMessageTone('error')
      return false
    }
    if (method === 'cpf' && !isValidCpf(identifier)) {
      setFieldError('identifier')
      setMessage('Informe um CPF válido no formato 000.000.000-00.')
      setMessageTone('error')
      return false
    }
    if (method === 'email' && !validEmail(identifier)) {
      setFieldError('identifier')
      setMessage('Informe um e-mail válido.')
      setMessageTone('error')
      return false
    }
    if (method === 'email' && (!codeRequested || emailCode.length < 4)) {
      setFieldError('code')
      setMessage(codeRequested ? 'Informe o código recebido por e-mail.' : 'Envie o código para seu e-mail antes de liberar o acesso.')
      setMessageTone('error')
      return false
    }
    setFieldError('')
    return true
  }

  const requestEmailCode = async () => {
    setMessage('')
    setFieldError('')
    if (!accepted) {
      setFieldError('terms')
      setMessage('Aceite os termos de uso antes de solicitar o código.')
      setMessageTone('error')
      return
    }
    if (!validEmail(identifier)) {
      setFieldError('identifier')
      setMessage('Informe um e-mail válido para receber o código.')
      setMessageTone('error')
      return
    }
    setEmailSending(true)
    setMessage('Enviando código para o e-mail informado...')
    setMessageTone('info')
    try {
      const response = await api<EmailCodeResponse>('/api/auth/email/request-code', { method: 'POST', body: JSON.stringify({ ...basePayload, email: identifier.trim() }) })
      setCodeRequested(true)
      setEmailExpiresAt(response.expiresAt)
      setEmailCooldown(30)
      setMessage('Código enviado. Digite os 6 números para liberar o acesso. Se não aparecer, confira pelos dados móveis ou verifique spam.')
      setMessageTone('success')
      window.setTimeout(() => codeInputRef.current?.focus(), 80)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível enviar o código.')
      setMessageTone('error')
    } finally {
      setEmailSending(false)
    }
  }

  const submit = async () => {
    if (!validate()) return
    setStage('validating')
    setMessage('Validando dados informados...')
    setMessageTone('info')
    try {
      await wait(220)
      setStage('authorizing')
      setMessage('Liberando seu acesso à rede...')
      const path = method === 'voucher' ? '/api/auth/voucher' : method === 'cpf' ? '/api/auth/cpf' : '/api/auth/email/verify-code'
      const body = method === 'voucher'
        ? { ...basePayload, code: normalizeVoucher(identifier) }
        : method === 'cpf'
          ? { ...basePayload, cpf: onlyDigits(identifier), name, phone: onlyDigits(phone) || undefined }
          : { ...basePayload, email: identifier.trim(), code: emailCode }
      const result = await api<AuthResponse>(path, { method: 'POST', body: JSON.stringify(body) })
      setStage('confirming')
      if (!result.authorized) throw new Error('Ainda estamos liberando seu acesso. Aguarde alguns segundos e tente novamente.')
      await wait(220)
      setSession({
        sessionId: result.sessionId,
        status: 'authorized',
        authorized: true,
        authorizedAt: result.authorizedAt,
        expiresAt: result.expiresAt,
        serverNow: new Date().toISOString(),
        remainingSeconds: result.remainingSeconds,
        remainingMinutes: Math.max(0, Math.floor(result.remainingSeconds / 60)),
        sessionMinutes: result.sessionMinutes,
        unlimited: Boolean(result.unlimited),
        totalSeconds: result.totalSeconds,
        ssid: params.ssid || networkName,
        nextCheckSeconds: result.nextCheckSeconds ?? 30,
      })
      setMessage(method === 'email' ? 'E-mail confirmado. Liberando seu acesso...' : 'Acesso liberado com sucesso.')
      setMessageTone('success')
      setStage('released')
      clearPublicPii()
    } catch (error) {
      setStage('error')
      const fallback = method === 'voucher' && error instanceof ApiError && error.status >= 500
        ? 'Voucher recebido, mas o portal não conseguiu confirmar a autorização na rede agora. Aguarde alguns segundos e tente novamente.'
        : error instanceof Error ? error.message : 'Não foi possível liberar o acesso.'
      setMessage(fallback)
      setMessageTone('error')
    }
  }

  useEffect(() => {
    if (method === 'email' && codeRequested && emailCode.length === 6 && stage === 'idle' && !emailSending) {
      setMessage('Verificando código...')
      setMessageTone('info')
      void submit()
    }
  }, [codeRequested, emailCode, emailSending, method, stage])

  if (activeSettings.maintenance.active) return <PublicPortalExperience
    settings={activeSettings}
    institutionName={institutionName}
    networkName={networkName}
    ssid={params.ssid}
    method="voucher"
    identifier=""
    accepted={false}
    stage="idle"
    notices={activeSettings.notifications ?? []}
    maintenanceActive
    maintenanceTitle={activeSettings.maintenance.title}
    maintenanceMessage={activeSettings.maintenance.message}
    maintenanceImageUrl={activeSettings.maintenance.imageUrl}
    maintenanceStartsAt={activeSettings.maintenance.startsAt}
    maintenanceEndsAt={activeSettings.maintenance.endsAt}
  />

  return <PublicPortalExperience
    settings={settings || { logoUrl: '', primaryColor: '#176b87', bannerText: 'Portal de Acesso Wi-Fi', welcomeText: 'Acesso seguro para visitantes', successMessage: 'Acesso liberado.', networkName, establishmentName: institutionName, termsText: 'Ao continuar, você aceita os termos de uso da rede.' }}
    institutionName={institutionName}
    networkName={networkName}
    ssid={params.ssid}
    method={method}
    identifier={identifier}
    name={name}
    phone={phone}
    emailCode={emailCode}
    accepted={accepted}
    stage={stage}
    message={message}
    messageTone={messageTone}
    fieldError={fieldError}
    notices={activeSettings.notifications ?? []}
    isBusy={isBusy}
    codeRequested={codeRequested}
    emailSending={emailSending}
    emailCooldown={emailCooldown}
    emailRemaining={emailRemaining}
    session={session}
    redirectUrl={params.redirectUrl}
    termsOpen={termsOpen}
    formInstanceKey={formInstanceKey}
    codeInputRef={codeInputRef}
    onSelectMethod={selectMethod}
    onIdentifierChange={updateIdentifier}
    onNameChange={setName}
    onPhoneChange={(value) => setPhone(formatPhone(value))}
    onEmailCodeChange={(value) => { setFieldError(''); setStage('idle'); setEmailCode(onlyDigits(value).slice(0, 6)) }}
    onAcceptedChange={(value) => { setAccepted(value); setFieldError('') }}
    onRequestEmailCode={requestEmailCode}
    onSubmit={submit}
    onOpenTerms={() => setTermsOpen(true)}
    onCloseTerms={() => setTermsOpen(false)}
    onAcceptTerms={() => { setAccepted(true); setFieldError(''); setTermsOpen(false) }}
  />
}
type AdminToastTone = 'success' | 'error' | 'info'
type AdminToast = { id: number; tone: AdminToastTone; title: string; message: string }

function Admin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [admin, setAdmin] = useState<AdminMe | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [dashboardCharts, setDashboardCharts] = useState<DashboardChartsData>(EMPTY_DASHBOARD_CHARTS)
  const [maintenance, setMaintenance] = useState<MaintenanceAdmin | null>(null)
  const [appearance, setAppearance] = useState<PortalAppearance | null>(null)
  const [siteAppearance, setSiteAppearance] = useState<PortalSiteAppearance | null>(null)
  const [sites, setSites] = useState<SiteNode[]>([])
  const [allowedSites, setAllowedSites] = useState<AllowedSite[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState(() => safeStorageGet('admin_selected_site_id', 'ALL'))
  const [notices, setNotices] = useState<AdminNotice[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [visitors, setVisitors] = useState<ClientRow[]>([])
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([])
  const [sessions, setSessions] = useState<GuestSessionRow[]>([])
  const [admins, setAdmins] = useState<AdminUserRow[]>([])
  const [adminInvitations, setAdminInvitations] = useState<AdminInviteResponse[]>([])
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null)
  const [authAttempts, setAuthAttempts] = useState<AuthAttemptRow[]>([])
  const [testingEmail, setTestingEmail] = useState(false)
  const [portalEditorTab, setPortalEditorTab] = useState<PortalEditorTab>('visual')
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all')
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'unauthenticated' | 'forbidden' | 'error'>('loading')
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<AdminSection>(() => {
    const path = window.location.pathname
    if (path.startsWith('/admin/sites/')) return 'site-detail'
    const section = path.split('/').filter(Boolean)[1] as AdminSection | undefined
    const allowed: AdminSection[] = ['dashboard', 'sessions', 'visitors', 'vouchers', 'notices', 'maintenance', 'sites', 'access-points', 'admins', 'audit', 'portal', 'portal-sites', 'health', 'settings']
    return section && allowed.includes(section) ? section : 'dashboard'
  })
  const [detailSiteId, setDetailSiteId] = useState(() => decodeURIComponent(window.location.pathname.startsWith('/admin/sites/') ? window.location.pathname.split('/').pop() || '' : ''))
  const [menuOpen, setMenuOpen] = useState(false)
  const [savingMaintenance, setSavingMaintenance] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [appearanceSaving, setAppearanceSaving] = useState(false)
  const [appearanceMessage, setAppearanceMessage] = useState('')
  const [sessionActionBusy, setSessionActionBusy] = useState(false)
  const [sessionActionMessage, setSessionActionMessage] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [refreshError, setRefreshError] = useState('')
  const [adminToasts, setAdminToasts] = useState<AdminToast[]>([])
  const loadInFlight = useRef(false)
  const notifyAdmin = (tone: AdminToastTone, title: string, message: string) => {
    const id = Date.now() + Math.random()
    setAdminToasts((current) => [...current.slice(-3), { id, tone, title, message }])
    window.setTimeout(() => setAdminToasts((current) => current.filter((toast) => toast.id !== id)), 6200)
  }
  const dismissAdminToast = (id: number) => setAdminToasts((current) => current.filter((toast) => toast.id !== id))
  const scopedPath = (path: string) => selectedSiteId === 'ALL' ? path : `${path}?siteId=${encodeURIComponent(selectedSiteId)}`
  const handleSiteChange = (siteId: string) => {
    safeStorageSet('admin_selected_site_id', siteId)
    setSelectedSiteId(siteId)
  }

  const openSiteDetail = (siteId: string) => {
    setDetailSiteId(siteId)
    setActiveSection('site-detail')
    window.history.pushState(null, '', `/admin/sites/${encodeURIComponent(siteId)}`)
  }
  const leaveSiteDetail = () => {
    setDetailSiteId('')
    setActiveSection('sites')
    window.history.pushState(null, '', '/admin/sites')
  }
  const load = async () => {
    if (loadInFlight.current) return
    loadInFlight.current = true
    setRefreshing(true)
    try {
      const [me, allowedSiteRows, dash, chartRows, maint, appearanceRow, selectedAppearanceRow, siteRows, noticeRows, auditRows, voucherRows, visitorRows, accessPointRows, sessionRows, adminRows, invitationRows, healthRow, attemptRows] = await Promise.all([
        api<AdminMe>('/api/admin/me'),
        api<AllowedSite[]>('/api/admin/sites/allowed').catch(() => []),
        api<Dashboard>(scopedPath('/api/admin/dashboard')),
        api<DashboardChartsData>(scopedPath('/api/admin/dashboard/charts')).catch(() => EMPTY_DASHBOARD_CHARTS),
        api<MaintenanceAdmin>(scopedPath('/api/admin/maintenance')),
        api<PortalAppearance>('/api/admin/portal-appearance'),
        selectedSiteId === 'ALL' ? Promise.resolve(null) : api<PortalSiteAppearance>(`/api/admin/portal-appearance/site/${encodeURIComponent(selectedSiteId)}`).catch(() => null),
        api<SiteNode[]>(scopedPath('/api/admin/sites')).catch(() => []),
        api<AdminNotice[]>(scopedPath('/api/admin/notifications')).catch(() => []),
        api<AuditEntry[]>(scopedPath('/api/admin/audit')).catch(() => []),
        api<Voucher[]>(scopedPath('/api/admin/vouchers')).catch(() => []),
        api<ClientRow[]>(scopedPath('/api/admin/users')).catch(() => []),
        api<AccessPoint[]>(scopedPath('/api/admin/access-points')).catch(() => []),
        api<GuestSessionRow[]>(scopedPath('/api/admin/sessions')).catch(() => []),
        api<AdminUserRow[]>('/api/admin/admins').catch(() => []),
        api<AdminInviteResponse[]>('/api/admin/admins/invitations').catch(() => []),
        api<SystemHealth>('/api/admin/system-health').catch(() => null),
        api<AuthAttemptRow[]>('/api/admin/auth-attempts').catch(() => []),
      ])
    const normalizedMe = { ...me, siteIds: asArray(me.siteIds) }
    const safeAllowedSites = asArray(allowedSiteRows)
    setAdmin(normalizedMe)
    setAllowedSites(safeAllowedSites)
    const canUseAll = normalizedMe.canSelectAllSites || normalizedMe.siteIds.length > 1
    if (safeAllowedSites.length && selectedSiteId !== 'ALL' && !safeAllowedSites.some((site) => site.siteId === selectedSiteId)) handleSiteChange(canUseAll ? 'ALL' : safeAllowedSites[0].siteId)
    if (!canUseAll && selectedSiteId === 'ALL' && safeAllowedSites.length === 1) handleSiteChange(safeAllowedSites[0].siteId)
    setDashboard(dash)
    setDashboardCharts(chartRows || EMPTY_DASHBOARD_CHARTS)
    setMaintenance(maint)
    setAppearance(appearanceRow)
    setSiteAppearance(selectedAppearanceRow)
    setSites(asArray(siteRows))
    setNotices(asArray(noticeRows))
    setAudit(asArray(auditRows))
    setVouchers(asArray(voucherRows))
    setVisitors(asArray(visitorRows))
    setAccessPoints(asArray(accessPointRows))
    setSessions(asArray(sessionRows))
      setAdmins(asArray(adminRows))
      setAdminInvitations(asArray(invitationRows))
      setSystemHealth(healthRow)
      setAuthAttempts(asArray(attemptRows))
      setLoadStatus('ready')
      setLastUpdatedAt(new Date())
      setRefreshError('')
      setError('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível atualizar agora.'
      setRefreshError(message)
      if (err instanceof ApiError && err.status === 401) {
        setAdmin(null)
        setDashboard(null)
        setLoadStatus('unauthenticated')
        setError('Sua sessão expirou. Entre novamente para continuar.')
        return
      }
      if (err instanceof ApiError && err.status === 403) {
        setLoadStatus('forbidden')
        return
      }
      if (!dashboard) setLoadStatus('error')
      throw err
    } finally {
      setRefreshing(false)
      loadInFlight.current = false
    }
  }

  useEffect(() => { void load().catch(() => undefined) }, [])
  useEffect(() => { if (admin) void load().catch(() => undefined) }, [selectedSiteId])
  useEffect(() => {
    if (!dashboard) return undefined
    const pollingBySection: Partial<Record<AdminSection, number>> = {
      dashboard: 60000,
      sessions: 15000,
      visitors: 15000,
      sites: 30000,
      'site-detail': 30000,
      'access-points': 30000,
    }
    const intervalMs = pollingBySection[activeSection]
    if (!intervalMs) return undefined
    const tick = () => {
      if (document.hidden || loadInFlight.current) return
      void load().catch(() => undefined)
    }
    const handle = window.setInterval(tick, intervalMs)
    const onVisibility = () => {
      if (!document.hidden && ['dashboard', 'sessions', 'visitors'].includes(activeSection)) tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(handle)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [activeSection, Boolean(dashboard)])

  const login = async (code?: string) => {
    setError('')
    const path = code ? '/api/admin/login/verify-code' : '/api/admin/login'
    const body = code ? { email, password, code } : { email, password }
    const result = await api<AdminMe | AdminLoginChallenge>(path, { method: 'POST', body: JSON.stringify(body) })
    if ('mfaRequired' in result) return result
    await load()
    return result
  }

  const requestPasswordReset = async (targetEmail: string) => {
    await api<{ ok: boolean }>('/api/admin/password/forgot', { method: 'POST', body: JSON.stringify({ email: targetEmail }) })
  }

  const resetPassword = async (targetEmail: string, code: string, newPassword: string, confirmPassword: string) => {
    await api<{ ok: boolean }>('/api/admin/password/reset', { method: 'POST', body: JSON.stringify({ email: targetEmail, code, password: newPassword, confirmPassword }) })
  }

  const testSystemEmail = async (targetEmail: string) => {
    setTestingEmail(true)
    try {
      await api<{ ok: boolean; sentTo: string }>('/api/admin/system-health/test-email', { method: 'POST', body: JSON.stringify({ email: targetEmail }) })
      notifyAdmin('success', 'E-mail enviado', `Mensagem de teste enviada para ${targetEmail}.`)
      await load().catch(() => undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível enviar o e-mail de teste.'
      notifyAdmin('error', 'Teste de e-mail falhou', message)
      throw new Error(message, { cause: err })
    } finally {
      setTestingEmail(false)
    }
  }

  const logout = async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => undefined)
    setDashboard(null)
    setAdmin(null)
    setAllowedSites([])
    setSiteAppearance(null)
    setDashboardCharts(EMPTY_DASHBOARD_CHARTS)
    setLoadStatus('unauthenticated')
    setError('')
  }

  const runSessionOperation = async (sessionId: string, operation: 'end' | 'require-reauthentication' | 'extend' | 'reauthorize' | 'block', body: Record<string, unknown>) => {
    setSessionActionBusy(true)
    setSessionActionMessage('')
    try {
      const response = await api<SessionOperationResponse>('/api/admin/sessions/' + encodeURIComponent(sessionId) + '/' + operation, { method: 'POST', body: JSON.stringify(body) })
      setSessionActionMessage(response.message)
      notifyAdmin('success', 'Sessão atualizada', response.message)
      await load().catch(() => undefined)
      return response
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível executar a ação.'
      setSessionActionMessage(message)
      notifyAdmin('error', 'Ação não concluída', message)
      throw new Error(message, { cause: err })
    } finally {
      setSessionActionBusy(false)
    }
  }

  const endAdminSession = async (sessionId: string) => {
    await runSessionOperation(sessionId, 'end', { reason: 'Encerramento administrativo' })
  }

  const resetSiteAppearance = async () => {
    if (selectedSiteId === 'ALL') return
    setAppearanceSaving(true)
    setAppearanceMessage('')
    try {
      await api(`/api/admin/portal-appearance/site/${encodeURIComponent(selectedSiteId)}`, { method: 'DELETE' })
      setAppearanceMessage('Visual da unidade voltou a usar a configuração global.')
      notifyAdmin('success', 'Visual restaurado', 'A unidade voltou a usar o visual global do portal.')
      await load().catch(() => undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível remover o visual da unidade.'
      setAppearanceMessage(message)
      notifyAdmin('error', 'Não foi possível restaurar', message)
    } finally {
      setAppearanceSaving(false)
    }
  }
  const saveAppearance = async () => {
    if (!appearance) return
    setAppearanceSaving(true)
    setAppearanceMessage('')
    try {
      if (selectedSiteId !== 'ALL' && siteAppearance) {
        const updated = await api<PortalSiteAppearance>(`/api/admin/portal-appearance/site/${encodeURIComponent(selectedSiteId)}`, { method: 'PUT', body: JSON.stringify(siteAppearance) })
        setSiteAppearance(updated)
        setAppearanceMessage('Visual e termos da unidade salvos com sucesso.')
        notifyAdmin('success', 'Portal público salvo', 'O visual, termos e métodos desta unidade foram atualizados.')
      } else {
        const updated = await api<PortalAppearance>('/api/admin/portal-appearance', { method: 'PUT', body: JSON.stringify(appearance) })
        setAppearance(updated)
        setAppearanceMessage('Visual e termos globais salvos com sucesso.')
        notifyAdmin('success', 'Portal público salvo', 'O visual e os termos globais foram atualizados.')
      }
      await load().catch(() => undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível salvar o visual do portal.'
      setAppearanceMessage(message)
      notifyAdmin('error', 'Portal público não salvo', message)
    } finally {
      setAppearanceSaving(false)
    }
  }
  const saveMaintenance = async () => {
    if (!maintenance) return
    if (maintenance.maintenanceStartAt && maintenance.maintenanceEndAt && new Date(maintenance.maintenanceEndAt).getTime() <= new Date(maintenance.maintenanceStartAt).getTime()) {
      const message = 'O término da manutenção deve ser posterior ao início.'
      setMaintenanceMessage(message)
      notifyAdmin('error', 'Manutenção não salva', message)
      return
    }
    setSavingMaintenance(true)
    setMaintenanceMessage('')
    try {
      const updated = await api<MaintenanceAdmin>(scopedPath('/api/admin/maintenance'), { method: 'PUT', body: JSON.stringify(maintenance) })
      setMaintenance(updated)
      setMaintenanceMessage('Alterações salvas com sucesso.')
      notifyAdmin('success', 'Manutenção salva', 'A tela pública de manutenção foi atualizada.')
      await load().catch(() => undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível salvar as alterações.'
      setMaintenanceMessage(message)
      notifyAdmin('error', 'Manutenção não salva', message)
    } finally {
      setSavingMaintenance(false)
    }
  }

  if (loadStatus === 'loading') {
    return <AdminLoading />
  }

  if (loadStatus === 'forbidden') {
    return <AdminAccessState title="Acesso negado" message="Seu usuário autenticado não possui permissão para abrir este painel." onRetry={() => void load().catch(() => undefined)} />
  }

  if (loadStatus === 'error' && !dashboard) {
    return <AdminAccessState title="Painel indisponível" message={refreshError || 'Não foi possível carregar os dados administrativos agora.'} onRetry={() => { setLoadStatus('loading'); void load().catch(() => undefined) }} />
  }

  if (!dashboard || loadStatus === 'unauthenticated') {
    return <AdminLogin email={email} password={password} error={error} onEmail={setEmail} onPassword={setPassword} onLogin={login} onRequestPasswordReset={requestPasswordReset} onResetPassword={resetPassword} />
  }

  return (
    <main className="admin-app">
      <AdminToastStack toasts={adminToasts} onDismiss={dismissAdminToast} />
      <AdminSidebar admin={admin} active={activeSection} open={menuOpen} onClose={() => setMenuOpen(false)} onSelect={(section) => { if (section === 'portal') setPortalEditorTab('visual'); setActiveSection(section); setMenuOpen(false); if (section !== 'site-detail') window.history.pushState(null, '', section === 'sites' ? '/admin/sites' : `/admin/${section}`) }} />
      <section className="admin-main" aria-label="Conteudo administrativo">
        <AdminHeader admin={admin} maintenance={maintenance} refreshing={refreshing} lastUpdatedAt={lastUpdatedAt} refreshError={refreshError} allowedSites={allowedSites} selectedSiteId={selectedSiteId} onSiteChange={handleSiteChange} onRefresh={() => void load().catch(() => undefined)} onLogout={logout} onMenu={() => setMenuOpen(true)} />
        <AdminSectionErrorBoundary section={activeSection}>
          {activeSection === 'dashboard' ? <DashboardHome dashboard={dashboard} charts={dashboardCharts} maintenance={maintenance} sites={sites} notices={notices} vouchers={vouchers} audit={audit} onSelect={(section, filter) => { setActiveSection(section); if (filter) setSessionFilter(filter) }} /> : null}
          {activeSection === 'sessions' ? <SessionsPage sessions={sessions} sites={sites} admin={admin} canManage={admin?.role !== 'VIEWER'} filter={sessionFilter} busy={sessionActionBusy} feedback={sessionActionMessage} onFilter={setSessionFilter} onRunOperation={runSessionOperation} /> : null}
          {activeSection === 'visitors' ? <VisitorsPanel visitors={visitors} canManage={admin?.role !== 'VIEWER'} busy={sessionActionBusy} onEndSession={endAdminSession} /> : null}
          {activeSection === 'vouchers' ? <VoucherPanel vouchers={vouchers} allowedSites={allowedSites} selectedSiteId={selectedSiteId} canCreateGlobal={admin?.role === 'SUPERADMIN'} canManage={admin?.role !== 'VIEWER'} onChanged={load} /> : null}
          {activeSection === 'notices' ? <NoticeAdminPanel notices={notices} allowedSites={allowedSites} selectedSiteId={selectedSiteId} canSelectAllSites={Boolean(admin?.canSelectAllSites)} canManage={admin?.role !== 'VIEWER'} onChanged={load} /> : null}
          {activeSection === 'maintenance' ? maintenance ? <MaintenanceAdminPanel maintenance={maintenance} allowedSites={allowedSites} selectedSiteId={selectedSiteId} canManage={admin?.role !== 'VIEWER'} saving={savingMaintenance} feedback={maintenanceMessage} onChange={setMaintenance} onSave={saveMaintenance} /> : <AdminRouteState title="Manutenção" message="Configuração de manutenção ainda não carregada." /> : null}
          {activeSection === 'sites' ? <SitesPanel sites={sites} onOpen={openSiteDetail} /> : null}
          {activeSection === 'site-detail' ? <SiteDetailPanel siteId={detailSiteId || selectedSiteId} sites={sites} visitors={visitors} sessions={sessions} accessPoints={accessPoints} vouchers={vouchers} notices={notices} maintenance={maintenance} onBack={leaveSiteDetail} onOpenSection={(section) => setActiveSection(section)} /> : null}
          {activeSection === 'access-points' ? <AccessPointsPanel accessPoints={accessPoints} /> : null}
          {activeSection === 'admins' ? <AdminsPanel admin={admin} admins={admins} invitations={adminInvitations} allowedSites={allowedSites} onChanged={load} onToast={notifyAdmin} /> : null}
          {activeSection === 'audit' ? <AuditPanel audit={audit} /> : null}
          {activeSection === 'portal-sites' ? <PortalSitesPanel sites={sites} allowedSites={allowedSites} selectedSiteId={selectedSiteId} onSelectSite={handleSiteChange} onOpenPortal={(tab = 'visual') => { setPortalEditorTab(tab); setActiveSection('portal'); window.history.pushState(null, '', '/admin/portal') }} onOpenMaintenance={() => { setActiveSection('maintenance'); window.history.pushState(null, '', '/admin/maintenance') }} onChanged={load} onToast={notifyAdmin} /> : null}
          {activeSection === 'portal' ? appearance ? <SettingsPanel admin={admin} maintenance={maintenance} appearance={selectedSiteId !== 'ALL' && siteAppearance ? siteAppearance : appearance} allowedSites={allowedSites} selectedSiteId={selectedSiteId} siteAppearance={siteAppearance} notices={notices} activeTab={portalEditorTab} saving={appearanceSaving} feedback={appearanceMessage} onTabChange={setPortalEditorTab} onChange={(value) => selectedSiteId !== 'ALL' && siteAppearance ? setSiteAppearance({ ...siteAppearance, ...value }) : setAppearance(value)} onSave={saveAppearance} onResetSite={resetSiteAppearance} /> : <AdminRouteState title="Portal público" message="Configurações do portal ainda não carregadas." /> : null}
          {activeSection === 'health' ? <SystemHealthPanel health={systemHealth} attempts={authAttempts} admin={admin} busy={testingEmail} onRefresh={() => void load().catch(() => undefined)} onTestEmail={testSystemEmail} /> : null}
          {activeSection === 'settings' ? <AccountSettingsPanel admin={admin} onRequestPasswordReset={requestPasswordReset} onResetPassword={resetPassword} onToast={notifyAdmin} /> : null}
        </AdminSectionErrorBoundary>
      </section>
    </main>
  )
}

function AdminLoading() {
  return <main className="portal-shell admin-login-shell"><section className="panel admin-card admin-loading-card" aria-live="polite"><div className="brand"><ShieldCheck aria-hidden="true" /><span>Portal administrativo</span></div><h1>Carregando painel</h1><p className="muted">Validando sessão e carregando os dados operacionais.</p></section></main>
}

function AdminAccessState({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return <main className="portal-shell admin-login-shell"><section className="panel admin-card admin-recovery-card" role="alert"><div className="brand"><AlertTriangle aria-hidden="true" /><span>Portal administrativo</span></div><h1>{title}</h1><p className="muted">{message}</p><button className="primary" type="button" onClick={onRetry}>Tentar novamente</button></section></main>
}

function AdminRouteState({ title, message }: { title: string; message: string }) {
  return <div className="admin-content"><Panel title={title} icon={<AlertTriangle />}><EmptyState message={message} /></Panel></div>
}

function AdminToastStack({ toasts, onDismiss }: { toasts: AdminToast[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null
  return <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`admin-toast ${toast.tone}`} role="status"><div><strong>{toast.title}</strong><span>{toast.message}</span></div><button type="button" aria-label="Fechar aviso" onClick={() => onDismiss(toast.id)}><X /></button></div>)}</div>
}

type AdminSectionErrorBoundaryProps = { section: AdminSection; children: ReactNode }
type AdminSectionErrorBoundaryState = { error: Error | null }

class AdminSectionErrorBoundary extends Component<AdminSectionErrorBoundaryProps, AdminSectionErrorBoundaryState> {
  state: AdminSectionErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Admin section render failed', {
      section: this.props.section,
      errorName: error.name,
      componentStack: info.componentStack?.slice(0, 1200),
    })
  }

  componentDidUpdate(previousProps: AdminSectionErrorBoundaryProps) {
    if (previousProps.section !== this.props.section && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return <div className="admin-content"><Panel title="Não foi possível abrir esta área" icon={<AlertTriangle />}><div className="admin-error-boundary" role="alert"><p>Uma falha inesperada impediu a renderização desta tela. O menu lateral continua disponível para acessar outras áreas.</p><button className="primary" type="button" onClick={() => window.location.reload()}>Recarregar página</button></div></Panel></div>
  }
}

function AdminLogin({ email, password, error, onEmail, onPassword, onLogin, onRequestPasswordReset, onResetPassword }: { email: string; password: string; error: string; onEmail: (value: string) => void; onPassword: (value: string) => void; onLogin: (code?: string) => Promise<AdminMe | AdminLoginChallenge>; onRequestPasswordReset: (email: string) => Promise<void>; onResetPassword: (email: string, code: string, password: string, confirmPassword: string) => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'code' | 'forgot' | 'reset'>('login')
  const [code, setCode] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const [info, setInfo] = useState('')
  const shownError = localError || error

  const submitLogin = async () => {
    setBusy(true)
    setLocalError('')
    setInfo('')
    try {
      const result = await onLogin()
      if ('mfaRequired' in result) {
        setMode('code')
        setCode('')
        setInfo('Enviamos um código de 6 dígitos para o e-mail do administrador.')
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Falha no login')
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async (value = code) => {
    if (value.length !== 6) return
    setBusy(true)
    setLocalError('')
    try {
      await onLogin(value)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Código inválido ou expirado.')
    } finally {
      setBusy(false)
    }
  }

  const submitForgot = async () => {
    setBusy(true)
    setLocalError('')
    setInfo('')
    try {
      await onRequestPasswordReset(email)
      setMode('reset')
      setInfo('Se o e-mail estiver cadastrado, enviaremos um código de recuperação.')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Não foi possível enviar o código agora.')
    } finally {
      setBusy(false)
    }
  }

  const submitReset = async () => {
    setBusy(true)
    setLocalError('')
    setInfo('')
    try {
      await onResetPassword(email, resetCode, newPassword, confirmPassword)
      setMode('login')
      setCode('')
      setResetCode('')
      setNewPassword('')
      setConfirmPassword('')
      setInfo('Senha alterada com sucesso. Entre usando a nova senha.')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Não foi possível alterar a senha.')
    } finally {
      setBusy(false)
    }
  }

  const updateCode = (value: string) => {
    const cleaned = onlyDigits(value).slice(0, 6)
    setCode(cleaned)
    if (cleaned.length === 6) void verifyCode(cleaned)
  }

  const codeSlots = (value: string) => <div className="admin-otp-slots" aria-hidden="true">{Array.from({ length: 6 }).map((_, index) => <span key={index} className={value[index] ? 'filled' : ''}>{value[index] ?? ''}</span>)}</div>

  return (
    <main className="portal-shell admin-login-shell admin-auth-shell">
      <section className="panel admin-card admin-auth-card" aria-labelledby="admin-login-title">
        <div className="admin-auth-icon"><ShieldCheck aria-hidden="true" /></div>
        <div className="admin-auth-heading">
          <h1 id="admin-login-title">{mode === 'forgot' ? 'Recuperar acesso' : mode === 'reset' ? 'Redefinir senha' : mode === 'code' ? 'Verificação por e-mail' : 'Painel administrativo'}</h1>
          <p>{mode === 'code' ? 'Digite o código enviado para concluir o login seguro.' : mode === 'forgot' ? 'Informe o e-mail administrativo para receber um código.' : mode === 'reset' ? 'Use o código recebido e defina uma nova senha forte.' : 'Entre para acompanhar acessos, avisos, vouchers e manutenção do portal.'}</p>
        </div>
        <div className="admin-auth-form">
          {mode !== 'code' && mode !== 'reset' ? <label htmlFor="admin-email">E-mail<input id="admin-email" value={email} onChange={(event) => onEmail(event.target.value)} autoComplete="email" /></label> : null}
          {mode === 'login' ? <label htmlFor="admin-password">Senha<input id="admin-password" value={password} onChange={(event) => onPassword(event.target.value)} type="password" autoComplete="current-password" /></label> : null}
          {mode === 'code' ? <label className="admin-code-field" htmlFor="admin-code"><span>Código de verificação</span><input id="admin-code" value={code} onChange={(event) => updateCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />{codeSlots(code)}</label> : null}
          {mode === 'reset' ? <><label className="admin-code-field" htmlFor="admin-reset-code"><span>Código recebido</span><input id="admin-reset-code" value={resetCode} onChange={(event) => setResetCode(onlyDigits(event.target.value).slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />{codeSlots(resetCode)}</label><label htmlFor="admin-new-password">Nova senha<input id="admin-new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} /></label><label htmlFor="admin-confirm-password">Confirmar senha<input id="admin-confirm-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} /></label></> : null}
          {mode === 'login' ? <button className="primary admin-auth-submit" onClick={() => void submitLogin()} type="button" disabled={busy}><ShieldCheck /> {busy ? 'Validando...' : 'Continuar'}</button> : null}
          {mode === 'code' ? <button className="primary admin-auth-submit" onClick={() => void verifyCode()} type="button" disabled={busy || code.length !== 6}><ShieldCheck /> {busy ? 'Verificando...' : 'Entrar no painel'}</button> : null}
          {mode === 'forgot' ? <button className="primary admin-auth-submit" onClick={() => void submitForgot()} type="button" disabled={busy || !email}><ShieldCheck /> {busy ? 'Enviando...' : 'Enviar código'}</button> : null}
          {mode === 'reset' ? <button className="primary admin-auth-submit" onClick={() => void submitReset()} type="button" disabled={busy || resetCode.length !== 6 || newPassword.length < 12 || newPassword !== confirmPassword}><ShieldCheck /> {busy ? 'Salvando...' : 'Alterar senha'}</button> : null}
        </div>
        {shownError ? <p className="error admin-auth-error" role="alert">{shownError}</p> : null}
        {info ? <p className="success admin-auth-success" role="status">{info}</p> : null}
        <div className="admin-auth-links">
          {mode === 'login' ? <button type="button" onClick={() => { setMode('forgot'); setLocalError(''); setInfo('') }}>Esqueci minha senha</button> : null}
          {mode !== 'login' ? <button type="button" onClick={() => { setMode('login'); setLocalError(''); setInfo(''); setCode(''); setResetCode('') }}>Voltar ao login</button> : null}
        </div>
        <p className="admin-auth-note">Acesso restrito. Sua sessão é protegida durante o uso do painel.</p>
      </section>
    </main>
  )
}




function DashboardHome({ dashboard, charts, maintenance, sites, notices, vouchers, audit, onSelect }: { dashboard: Dashboard; charts: DashboardChartsData; maintenance: MaintenanceAdmin | null; sites: SiteNode[]; notices: AdminNotice[]; vouchers: Voucher[]; audit: AuditEntry[]; onSelect: (section: AdminSection, filter?: SessionFilter) => void }) {
  const activeNotices = notices.filter((notice) => notice.enabled)
  return (
    <div className="admin-content">
      <MetricGrid dashboard={dashboard} onSelect={onSelect} />
      <DashboardCharts dashboard={dashboard} charts={charts} sites={sites} notices={notices} vouchers={vouchers} onSelect={onSelect} />
      <SiteBreakdown sites={sites} notices={notices} vouchers={vouchers} />
      <section className="ops-grid" aria-label="Conteudo operacional">
        <SessionsRecent />
        <SitesPanel sites={sites} compact />
        <NoticeAdminPanel notices={activeNotices} compact />
        <AuditPanel audit={audit} compact />
      </section>
      {maintenance ? <MaintenanceSummary maintenance={maintenance} /> : null}
    </div>
  )
}

function methodLabel(method: string) {
  const normalized = method.toLowerCase()
  if (normalized === 'voucher') return 'Voucher'
  if (normalized === 'cpf') return 'CPF'
  if (normalized === 'email') return 'E-mail'
  if (normalized === 'provisional') return 'Provisório'
  return method
}

function DashboardCharts({ dashboard, charts, sites, notices, vouchers, onSelect }: { dashboard: Dashboard; charts: DashboardChartsData; sites: SiteNode[]; notices: AdminNotice[]; vouchers: Voucher[]; onSelect: (section: AdminSection, filter?: SessionFilter) => void }) {
  const totalClients = sites.reduce((total, site) => total + (site.connectedClients || 0), 0)
  const totalAps = sites.reduce((total, site) => total + (site.aps || 0), 0)
  const totalSessions = Math.max(1, sites.reduce((total, site) => total + (site.sessions || 0), 0), dashboard.onlineUsers, dashboard.sessionsEndedToday)
  const activeNoticeCount = notices.filter((notice) => notice.enabled).length
  const activeVoucherCount = vouchers.filter((voucher) => voucher.enabled && voucher.isActive !== false).length
  const daySeries = charts.connectionsByDay.slice(-14)
  const maxDay = Math.max(1, ...daySeries.map((item) => item.count))
  const maxMethod = Math.max(1, ...charts.authMethods.map((item) => item.count))
  const onlinePercent = Math.min(100, Math.round((dashboard.onlineUsers / totalSessions) * 100))
  return (
    <section className="dashboard-visual-grid expanded" aria-label="Gráficos operacionais do portal">
      <Panel title={`Conexões por dia · ${charts.periodDays || 30} dias`} icon={<Gauge />} compact>
        {daySeries.length ? <div className="dashboard-bars daily">
          {daySeries.map((item) => <div key={item.date} className="dashboard-bar-row"><span>{item.label}</span><div className="dashboard-bar-track"><i className={item.count ? 'ok' : 'muted'} style={{ width: String(item.count ? Math.max(6, (item.count / maxDay) * 100) : 2) + '%' }} /></div><strong>{item.count}</strong></div>)}
        </div> : <EmptyState message="Ainda não há conexões registradas no período." />}
      </Panel>
      <Panel title="Dias de maior e menor movimento" icon={<Activity />} compact>
        <div className="dashboard-rank-columns">
          <div><strong>Maiores</strong>{charts.bestDays.length ? charts.bestDays.map((item) => <span key={`best-${item.date}`}>{item.label}<b>{item.count}</b></span>) : <small>Sem dados.</small>}</div>
          <div><strong>Menores</strong>{charts.quietDays.length ? charts.quietDays.map((item) => <span key={`quiet-${item.date}`}>{item.label}<b>{item.count}</b></span>) : <small>Sem dados.</small>}</div>
        </div>
      </Panel>
      <Panel title="Métodos usados" icon={<Ticket />} compact>
        {charts.authMethods.length ? <div className="dashboard-bars">
          {charts.authMethods.map((item) => <div key={item.method} className="dashboard-bar-row"><span>{methodLabel(item.method)}</span><div className="dashboard-bar-track"><i className="neutral" style={{ width: String(Math.max(6, (item.count / maxMethod) * 100)) + '%' }} /></div><strong>{item.count}</strong></div>)}
        </div> : <EmptyState message="Nenhum método usado no período." />}
      </Panel>
      <Panel title="Maiores tempos de sessão" icon={<Clock />} compact>
        {charts.longestSessions.length ? <div className="dashboard-longest-list">{charts.longestSessions.map((item) => <article key={item.sessionId}><div><strong>{item.label}</strong><span>{item.site || 'Unidade não informada'} · {methodLabel(item.method)}</span></div><b>{formatMinutes(item.durationSeconds)}</b></article>)}</div> : <EmptyState message="Nenhuma sessão com duração calculada." />}
      </Panel>
      <Panel title="Capacidade observada" icon={<Wifi />} compact>
        <div className="dashboard-donut-grid">
          <div className="dashboard-donut" style={{ background: 'conic-gradient(#176b87 0 ' + onlinePercent + '%, #e8f2ef ' + onlinePercent + '% 100%)' }}><strong>{dashboard.onlineUsers}</strong><span>online</span></div>
          <div className="dashboard-donut-copy"><strong>{totalClients}</strong><span>dispositivos conectados</span><strong>{totalAps}</strong><span>APs retornados</span></div>
        </div>
      </Panel>
      <Panel title="Comunicação" icon={<Megaphone />} compact>
        <div className="dashboard-mini-kpis"><button type="button" onClick={() => onSelect('notices')}><span>Avisos ativos</span><strong>{activeNoticeCount}</strong></button><button type="button" onClick={() => onSelect('vouchers')}><span>Vouchers ativos</span><strong>{activeVoucherCount}</strong></button><button type="button" onClick={() => onSelect('maintenance')}><span>Manutenções</span><strong>{dashboard.scheduledMaintenances}</strong></button></div>
      </Panel>
    </section>
  )
}function SiteBreakdown({ sites, notices, vouchers }: { sites: SiteNode[]; notices: AdminNotice[]; vouchers: Voucher[] }) {
  if (!sites.length) return null
  return <section className="site-breakdown-grid" aria-label="Resumo por unidade">{sites.map((site) => {
    const siteId = site.siteId || site.name
    const siteNotices = notices.filter((notice) => notice.enabled && (notice.site === siteId || notice.site === site.name || notice.site === 'ALL')).length
    const siteVouchers = vouchers.filter((voucher) => voucher.siteId === siteId || voucher.site === siteId || voucher.siteName === site.name || voucher.site === site.name).length
    return <article className="site-breakdown-card" key={siteId}><div><strong>{site.name}</strong><span>{site.status}</span></div><div className="site-method-chips">{(site.authMethods?.length ? site.authMethods : (["voucher", "cpf", "email"] as Method[])).map((method) => <span key={method}>{methodLabel(method)}</span>)}</div><dl><div><dt>APs</dt><dd>{site.aps}</dd></div><div><dt>Dispositivos</dt><dd>{site.connectedClients}</dd></div><div><dt>Sessões</dt><dd>{site.sessions}</dd></div><div><dt>Vouchers</dt><dd>{siteVouchers}</dd></div><div><dt>Avisos</dt><dd>{siteNotices}</dd></div></dl></article>
  })}</section>
}
function MetricGrid({ dashboard, onSelect }: { dashboard: Dashboard; onSelect: (section: AdminSection, filter?: SessionFilter) => void }) {
  const metrics = [
    { title: 'Usuários online', value: dashboard.onlineUsers, icon: <Activity />, description: 'Sessões autorizadas agora.', state: 'normal' as const, section: 'sessions' as const, filter: 'online' as const },
    { title: 'Expiram em 30 min', value: dashboard.expiringIn30Minutes, icon: <Clock />, description: 'Sessões próximas do fim.', state: dashboard.expiringIn30Minutes > 0 ? 'warning' as const : 'normal' as const, section: 'sessions' as const, filter: 'expiring-30' as const },
    { title: 'Expiram em 10 min', value: dashboard.expiringIn10Minutes, icon: <AlertTriangle />, description: 'Exigem maior atenção.', state: dashboard.expiringIn10Minutes > 0 ? 'critical' as const : 'normal' as const, section: 'sessions' as const, filter: 'expiring-10' as const },
    { title: 'Manutenções agendadas', value: dashboard.scheduledMaintenances, icon: <FileClock />, description: 'Janelas programadas.', state: dashboard.scheduledMaintenances > 0 ? 'warning' as const : 'normal' as const, section: 'maintenance' as const },
    { title: 'Avisos ativos', value: dashboard.activeNotifications, icon: <Megaphone />, description: 'Comunicados visíveis.', state: dashboard.activeNotifications > 0 ? 'warning' as const : 'normal' as const, section: 'notices' as const },
    { title: 'Encerradas hoje', value: dashboard.sessionsEndedToday, icon: <CheckCircle2 />, description: 'Sessões finalizadas no dia.', state: 'normal' as const, section: 'sessions' as const, filter: 'ended-today' as const },
    { title: 'Tempo médio', value: formatMinutes(dashboard.averageSessionSeconds), icon: <Gauge />, description: 'Duração média registrada.', state: 'normal' as const, section: 'sessions' as const },
    { title: 'Vouchers disponíveis', value: dashboard.vouchersAvailable, icon: <Ticket />, description: 'Vouchers ativos no portal.', state: dashboard.vouchersAvailable === 0 ? 'warning' as const : 'normal' as const, section: 'vouchers' as const },
  ]
  return <section className="admin-metrics" aria-label="Metricas do dashboard">{metrics.map((metric) => <MetricCard key={metric.title} {...metric} onOpen={() => onSelect(metric.section, metric.filter)} />)}</section>
}

function MetricCard({ title, value, icon, description, state, onOpen }: { title: string; value: number | string; icon: ReactNode; description: string; state: 'normal' | 'warning' | 'critical'; onOpen: () => void }) {
  return <button className={`admin-metric ${state}`} type="button" onClick={onOpen}><div className="metric-icon">{icon}</div><span>{title}</span><strong>{value}</strong><p>{description}</p></button>
}

function SessionsRecent() {
  return <Panel title="Sessões recentes" icon={<MonitorCheck />}><EmptyState message="Nenhuma sessão recente." /></Panel>
}

function SitesPanel({ sites, compact = false, onOpen }: { sites: SiteNode[]; compact?: boolean; onOpen?: (siteId: string) => void }) {
  const totals = sites.reduce((acc, site) => ({ aps: acc.aps + (site.aps || 0), clients: acc.clients + (site.connectedClients || 0), sessions: acc.sessions + (site.sessions || 0) }), { aps: 0, clients: 0, sessions: 0 })
  return <Panel title={compact ? 'Status das unidades' : 'Visão das unidades'} icon={<Building2 />} compact={compact}>{sites.length ? <div className="site-topology"><div className="topology-summary" aria-label="Resumo da topologia"><div><span>Unidades</span><strong>{sites.length}</strong></div><div><span>APs</span><strong>{totals.aps}</strong></div><div><span>Clientes</span><strong>{totals.clients}</strong></div><div><span>Sessões</span><strong>{totals.sessions}</strong></div></div><div className="site-topology-grid">{sites.map((site) => {
    const status = (site.status || '').toLowerCase()
    const health = status.includes('connect') || status.includes('online') ? 'ok' : site.aps || site.connectedClients || site.sessions ? 'warning' : 'muted'
    const content = <><div className="site-node-head"><span className={`topology-dot ${health}`} /><div><strong>{site.name}</strong><small>{site.status || 'Status indisponível'}</small></div></div><div className="site-method-chips" aria-label="Métodos de acesso liberados">{(site.authMethods?.length ? site.authMethods : (["voucher", "cpf", "email"] as Method[])).map((method) => <span key={method}>{methodLabel(method)}</span>)}</div><div className="site-flow" aria-hidden="true"><span>Unidade</span><i /><span>APs</span><i /><span>Clientes</span><i /><span>Portal</span></div><dl><div><dt>APs</dt><dd>{site.aps}</dd></div><div><dt>Clientes</dt><dd>{site.connectedClients}</dd></div><div><dt>Sessões</dt><dd>{site.sessions}</dd></div></dl></>
    return onOpen && site.siteId ? <button key={site.siteId || site.name} className="site-topology-card clickable" type="button" onClick={() => onOpen(site.siteId || site.name)}>{content}</button> : <article key={site.siteId || site.name} className="site-topology-card">{content}</article>
  })}</div></div> : <div className="site-empty-guidance"><EmptyState message="Nenhuma unidade disponível para o filtro atual." /><p>Confira a unidade selecionada no topo e se os equipamentos da rede estão online. Depois, use Atualizar para tentar novamente.</p></div>}</Panel>
}

function PortalSitesPanel({ sites, allowedSites, selectedSiteId, onSelectSite, onOpenPortal, onOpenMaintenance, onChanged, onToast }: { sites: SiteNode[]; allowedSites: AllowedSite[]; selectedSiteId: string; onSelectSite: (siteId: string) => void; onOpenPortal: (tab?: PortalEditorTab) => void; onOpenMaintenance: () => void; onChanged: () => Promise<void>; onToast: (tone: AdminToastTone, title: string, message: string) => void }) {
  const [editingSiteId, setEditingSiteId] = useState('')
  const [draftMethods, setDraftMethods] = useState<Method[]>([])
  const [busySiteId, setBusySiteId] = useState('')
  const [feedback, setFeedback] = useState('')
  const rows = (allowedSites.length ? allowedSites : sites.map((site) => ({ siteId: site.siteId || site.name, name: site.name, allowed: true }))).map((allowed) => {
    const site = sites.find((item) => item.siteId === allowed.siteId || item.name === allowed.name)
    return { ...allowed, site, authMethods: site?.authMethods?.length ? site.authMethods : (["voucher", "cpf", "email"] as Method[]) }
  })
  const openMethodsEditor = (row: { siteId: string; authMethods: Method[] }) => {
    onSelectSite(row.siteId)
    setEditingSiteId(row.siteId)
    setDraftMethods(row.authMethods.length ? row.authMethods : ['voucher'])
    setFeedback('')
  }
  const toggleDraftMethod = (method: Method) => {
    setDraftMethods((current) => {
      const selected = current.includes(method) ? current.filter((item) => item !== method) : [...current, method]
      return selected.length ? selected : [method]
    })
  }
  const saveMethods = async (row: { siteId: string; name: string }) => {
    setBusySiteId(row.siteId)
    setFeedback('')
    try {
      const current = await api<PortalSiteAppearance>(`/api/admin/portal-appearance/site/${encodeURIComponent(row.siteId)}`)
      await api<PortalSiteAppearance>(`/api/admin/portal-appearance/site/${encodeURIComponent(row.siteId)}`, { method: 'PUT', body: JSON.stringify({ ...current, siteName: current.siteName || row.name, authMethods: draftMethods }) })
      setFeedback(`Métodos de ${row.name} salvos com sucesso.`)
      onToast('success', 'Métodos salvos', `${row.name}: ${draftMethods.map(methodLabel).join(', ')}.`)
      setEditingSiteId('')
      await onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível salvar os métodos desta unidade.'
      setFeedback(message)
      onToast('error', 'Métodos não salvos', message)
    } finally {
      setBusySiteId('')
    }
  }
  return <div className="admin-content"><PageHeader title="Portais por unidade" description="Controle de forma rápida quais métodos aparecem para cada portal público." /><section className="portal-sites-grid">{rows.map((row) => {
    const isSelected = selectedSiteId === row.siteId
    const isEditing = editingSiteId === row.siteId
    return <article className={`portal-site-card ${isSelected ? 'selected' : ''} ${isEditing ? 'editing' : ''}`} key={row.siteId}>
      <div className="portal-site-card-head"><div><strong>{row.name}</strong><span>{row.site?.status || 'Unidade configurada'}</span></div>{isSelected ? <b>Selecionado</b> : null}</div>
      <div className="site-method-chips" aria-label="Métodos visíveis">{row.authMethods.map((method) => <span key={method}>{methodLabel(method)}</span>)}</div>
      <dl><div><dt>APs</dt><dd>{row.site?.aps ?? 0}</dd></div><div><dt>Clientes</dt><dd>{row.site?.connectedClients ?? 0}</dd></div><div><dt>Sessões</dt><dd>{row.site?.sessions ?? 0}</dd></div></dl>
      <div className="portal-site-actions"><button className="soft-button" type="button" onClick={() => openMethodsEditor(row)}>Editar métodos</button><button className="soft-button" type="button" onClick={() => { onSelectSite(row.siteId); onOpenPortal('visual') }}>Visual</button><button className="soft-button" type="button" onClick={() => { onSelectSite(row.siteId); onOpenMaintenance() }}>Manutenção</button></div>
      {isEditing ? <div className="portal-site-method-editor" role="group" aria-label={`Editar métodos de ${row.name}`}>
        <strong>Formas de acesso exibidas para {row.name}</strong>
        <p>Marque somente o que deve aparecer no celular do visitante. O painel aplica somente os métodos permitidos para a unidade.</p>
        <div className="portal-site-method-options">{(["voucher", "cpf", "email"] as Method[]).map((method) => <label key={method} className={draftMethods.includes(method) ? 'active' : ''}><input type="checkbox" checked={draftMethods.includes(method)} disabled={draftMethods.includes(method) && draftMethods.length === 1} onChange={() => toggleDraftMethod(method)} /> <span>{methodLabel(method)}</span></label>)}</div>
        <div className="portal-site-editor-actions"><button className="primary" type="button" onClick={() => void saveMethods(row)} disabled={busySiteId === row.siteId}>{busySiteId === row.siteId ? 'Salvando...' : 'Salvar métodos'}</button><button className="soft-button" type="button" onClick={() => setEditingSiteId('')} disabled={busySiteId === row.siteId}>Cancelar</button></div>
      </div> : null}
    </article>
  })}</section>{feedback ? <p className={feedback.includes('sucesso') ? 'success admin-inline-feedback' : 'error admin-inline-feedback'} role="status">{feedback}</p> : null}<Panel title="Como usar" icon={<ShieldCheck />} compact><div className="portal-sites-help"><InfoTile title="Sede" value="Voucher, CPF e e-mail" detail="Clique em Editar métodos, marque Voucher, CPF e E-mail, depois salve." icon={<Ticket />} /><InfoTile title="Esdras" value="Somente voucher" detail="Clique em Editar métodos, deixe apenas Voucher marcado e salve." icon={<LockKeyhole />} /><InfoTile title="Segurança" value="Proteção de acesso" detail="Somente os métodos selecionados ficam disponíveis para esta unidade." icon={<ShieldCheck />} /></div></Panel></div>
}

function HealthStatusBadge({ value }: { value: string | boolean }) {
  const ok = value === true || value === 'ok'
  return <span className={`health-status ${ok ? 'ok' : 'warning'}`}>{ok ? 'OK' : 'Atenção'}</span>
}

function SystemHealthPanel({ health, attempts, admin, busy, onRefresh, onTestEmail }: { health: SystemHealth | null; attempts: AuthAttemptRow[]; admin: AdminMe | null; busy: boolean; onRefresh: () => void; onTestEmail: (email: string) => Promise<void> }) {
  const [targetEmail, setTargetEmail] = useState(admin?.email || '')
  const [message, setMessage] = useState('')
  const [attemptMethod, setAttemptMethod] = useState('all')
  const [attemptResult, setAttemptResult] = useState<'all' | 'success' | 'failed'>('all')
  const filteredAttempts = attempts.filter((row) => {
    if (attemptMethod !== 'all' && row.method !== attemptMethod) return false
    if (attemptResult === 'success' && !row.success) return false
    if (attemptResult === 'failed' && row.success) return false
    return true
  })
  const attemptMethods = Array.from(new Set(attempts.map((row) => row.method))).sort()
  const runEmailTest = async () => {
    setMessage('')
    if (!validEmail(targetEmail)) {
      setMessage('Informe um e-mail válido para o teste.')
      return
    }
    try {
      await onTestEmail(targetEmail)
      setMessage('E-mail de teste enviado. Confira a caixa de entrada e o spam.')
    } catch {
      setMessage('Não foi possível enviar o e-mail de teste agora.')
    }
  }
  return <div className="admin-content">
    <PageHeader title="Status do sistema" description="Confira se os principais serviços do portal estão disponíveis." action={<button className="soft-button" type="button" onClick={onRefresh}>Atualizar</button>} />
    {health ? <section className="health-grid">
      <Panel title="Dados" icon={<Gauge />} compact>
        <div className="health-stack">
          <div><span>Banco de dados</span><HealthStatusBadge value={health.database.status} /></div>
          <div><span>Estrutura</span><HealthStatusBadge value={health.schema.status} /></div>
          {health.schema.findings.length ? <p className="error">Há pendências na estrutura de dados.</p> : <p className="success">Estrutura atualizada.</p>}
        </div>
      </Panel>
      <Panel title="Rede Wi-Fi" icon={<Radio />} compact>
        <div className="health-stack">
          <div><span>Status</span><HealthStatusBadge value={health.unifi.status} /></div>
          <div><span>Unidades encontradas</span><strong>{health.unifi.sites}</strong></div>
          {health.unifi.message ? <p className="error">Não foi possível consultar a rede neste momento.</p> : <p className="success">Controle da rede respondendo normalmente.</p>}
        </div>
      </Panel>
      <Panel title="E-mail" icon={<FileClock />} compact>
        <div className="health-stack">
          <div><span>Serviço configurado</span><HealthStatusBadge value={health.smtp.configured} /></div>
          <label htmlFor="health-email-test">Enviar teste para<input id="health-email-test" value={targetEmail} onChange={(event) => setTargetEmail(event.target.value)} inputMode="email" autoComplete="email" /></label>
          <button className="primary admin-save" type="button" onClick={() => void runEmailTest()} disabled={busy || !health.smtp.configured}>{busy ? 'Enviando...' : 'Enviar e-mail de teste'}</button>
          {message ? <p className={message.includes('Não') || message.includes('Informe') ? 'error' : 'success'} role="status">{message}</p> : null}
        </div>
      </Panel>
      <Panel title="Imagens e arquivos" icon={<MonitorCheck />} compact>
        <div className="health-stack">
          <div><span>Armazenamento</span><HealthStatusBadge value={Boolean(health.media && health.media.status === 'ok')} /></div>
          {health.media?.message ? <p className="error">O armazenamento de imagens requer atenção.</p> : <p className="success">Envio e exibição de imagens disponíveis.</p>}
        </div>
      </Panel>
      <Panel title="Proteções" icon={<Settings />} compact>
        <div className="health-stack">
          <div><span>Verificação adicional no login</span><HealthStatusBadge value={health.runtime.adminEmailMfaRequired} /></div>
          <div><span>Ambiente protegido</span><HealthStatusBadge value={health.runtime.environment === 'production'} /></div>
        </div>
      </Panel>
    </section> : <Panel title="Status indisponível" icon={<AlertTriangle />}><EmptyState message="Ainda não foi possível carregar o status do sistema." /></Panel>}
    <Panel title="Eventos recentes do portal" icon={<History />} compact>
      <div className="auth-attempt-filters">
        <label>Método<select value={attemptMethod} onChange={(event) => setAttemptMethod(event.target.value)}><option value="all">Todos</option>{attemptMethods.map((method) => <option key={method} value={method}>{methodLabel(method)}</option>)}</select></label>
        <label>Resultado<select value={attemptResult} onChange={(event) => setAttemptResult(event.target.value as 'all' | 'success' | 'failed')}><option value="all">Todos</option><option value="success">Aceitas</option><option value="failed">Falhas</option></select></label>
        <span>{filteredAttempts.length} evento(s)</span>
      </div>
      {filteredAttempts.length ? <div className="auth-attempt-list">{filteredAttempts.slice(0, 80).map((row) => <article key={row.id} className={row.success ? 'ok' : 'error'}><div><strong>{methodLabel(row.method)}</strong><span>{formatClock(row.createdAt)}</span></div><p>{row.success ? 'Autenticação aceita' : 'Falha'}{row.reason ? ` · ${row.reason}` : ''}</p></article>)}</div> : <EmptyState message="Nenhum evento encontrado para os filtros atuais." />}
    </Panel>
  </div>
}
function SiteDetailPanel({ siteId, sites, visitors, sessions, accessPoints, vouchers, notices, maintenance, onBack, onOpenSection }: { siteId: string; sites: SiteNode[]; visitors: ClientRow[]; sessions: GuestSessionRow[]; accessPoints: AccessPoint[]; vouchers: Voucher[]; notices: AdminNotice[]; maintenance: MaintenanceAdmin | null; onBack: () => void; onOpenSection: (section: AdminSection) => void }) {
  const site = sites.find((row) => row.siteId === siteId || row.name === siteId)
  const siteName = site?.name || siteId || 'Unidade'
  const siteSessions = sessions.filter((session) => session.site === siteId || session.site === siteName)
  const siteVisitors = visitors.filter((row) => textValue(row, ['siteId']) === siteId || textValue(row, ['siteName']) === siteName)
  const siteAps = accessPoints.filter((row) => textValue(row, ['siteId']) === siteId || textValue(row, ['siteName']) === siteName)
  const siteVouchers = vouchers.filter((voucher) => voucher.siteId === siteId || voucher.site === siteId || voucher.siteName === siteName || voucher.site === siteName)
  const siteNotices = notices.filter((notice) => notice.site === 'ALL' || notice.site === siteId || notice.site === siteName)
  const authorized = siteSessions.filter((session) => session.status === 'authorized' && (session.unlimited || session.remainingSeconds > 0)).length
  const expiring = siteSessions.filter((session) => session.status === 'authorized' && !session.unlimited && session.remainingSeconds > 0 && session.remainingSeconds <= 1800).length
  return <div className="admin-content"><PageHeader title={siteName} description="Resumo operacional da unidade selecionada." action={<button className="soft-button" type="button" onClick={onBack}>Voltar para unidades</button>} /><section className="site-detail-grid"><InfoTile title="APs" value={site?.aps ?? siteAps.length} detail="Pontos de acesso disponíveis nesta unidade." icon={<Radio />} /><InfoTile title="Dispositivos conectados" value={site?.connectedClients ?? siteVisitors.length} detail="Dispositivos observados na rede desta unidade." icon={<Wifi />} /><InfoTile title="Sessões autorizadas" value={authorized} detail="Acessos ainda válidos no portal." icon={<MonitorCheck />} /><InfoTile title="Expiram em 30 min" value={expiring} detail="Acessos próximos do fim." icon={<Clock />} /><InfoTile title="Métodos públicos" value={(site?.authMethods?.length ? site.authMethods : (["voucher", "cpf", "email"] as Method[])).map(methodLabel).join(', ')} detail="Métodos visíveis e validados para esta unidade." icon={<Ticket />} /></section><section className="site-network-map" aria-label="Topologia da unidade"><div><Building2 /><strong>{siteName}</strong><span>{site?.status || 'Status indisponível'}</span></div><i /><div><Radio /><strong>{site?.aps ?? siteAps.length}</strong><span>Pontos de acesso</span></div><i /><div><Wifi /><strong>{site?.connectedClients ?? siteVisitors.length}</strong><span>Dispositivos</span></div><i /><div><MonitorCheck /><strong>{authorized}</strong><span>Sessões válidas</span></div></section><section className="site-detail-actions"><button className="soft-button" type="button" onClick={() => onOpenSection('visitors')}>Clientes</button><button className="soft-button" type="button" onClick={() => onOpenSection('sessions')}>Sessões</button><button className="soft-button" type="button" onClick={() => onOpenSection('access-points')}>APs</button><button className="soft-button" type="button" onClick={() => onOpenSection('vouchers')}>Vouchers</button><button className="soft-button" type="button" onClick={() => onOpenSection('notices')}>Avisos</button><button className="soft-button" type="button" onClick={() => onOpenSection('maintenance')}>Manutenção</button></section><section className="ops-grid"><Panel title="Sessões recentes" icon={<MonitorCheck />} compact>{siteSessions.slice(0, 5).length ? <div className="admin-list">{siteSessions.slice(0, 5).map((session) => <article className="admin-list-item" key={session.id}><div><strong>{session.name || session.clientMac}</strong><span>{session.status} · {session.unlimited ? 'Sem limite' : formatCountdown(session.remainingSeconds)}</span></div><p>{session.ssid || 'SSID não informado'} · {session.method}</p></article>)}</div> : <EmptyState message="Nenhuma sessão recente nesta unidade." />}</Panel><Panel title="Pontos de acesso" icon={<Radio />} compact>{siteAps.slice(0, 5).length ? <div className="admin-list">{siteAps.slice(0, 5).map((ap, index) => <article className="admin-list-item" key={textValue(ap, ['id', 'mac']) || index}><div><strong>{textValue(ap, ['name']) || 'AP sem nome'}</strong><span>{textValue(ap, ['status']) || 'Status indisponível'}</span></div><p>{textValue(ap, ['mac']) || textValue(ap, ['ip']) || 'Identificação indisponível'}</p></article>)}</div> : <EmptyState message="Nenhum ponto de acesso listado nesta unidade." />}</Panel><Panel title="Vouchers" icon={<Ticket />} compact>{siteVouchers.slice(0, 5).length ? <div className="admin-list">{siteVouchers.slice(0, 5).map((voucher) => <article className="admin-list-item" key={voucher.id}><div><strong>{voucher.codeLabel}</strong><span>{voucher.status}</span></div><p>{voucher.unlimitedDuration ? 'Sem limite' : `${voucher.durationMinutes} min`} · {voucher.usedCount} uso(s) · {voucher.expiresAt ? formatClock(voucher.expiresAt) : 'sem expiração'}</p></article>)}</div> : <EmptyState message="Nenhum voucher nesta unidade." />}</Panel><Panel title="Avisos e manutenção" icon={<Megaphone />} compact>{siteNotices.slice(0, 4).length ? <div className="admin-list">{siteNotices.slice(0, 4).map((notice) => <article className="admin-list-item" key={notice.id}><div><strong>{notice.title}</strong><span>{notice.site === 'ALL' ? 'Global' : siteName}</span></div><p>{notice.message}</p></article>)}</div> : <EmptyState message={maintenance?.maintenanceEnabled ? 'Sem aviso ativo; manutenção configurada.' : 'Nenhum aviso ativo nesta unidade.'} />}</Panel></section></div>
}
function AuditPanel({ audit, compact = false }: { audit: AuditEntry[]; compact?: boolean }) {
  return <Panel title="Últimas ações administrativas" icon={<History />} compact={compact}>{audit.length ? <div className="admin-list">{audit.slice(0, compact ? 5 : 30).map((entry) => <article key={entry.id} className="admin-list-item"><div><strong>{humanAudit(entry.event)}</strong><span>{formatClock(entry.createdAt)}</span></div><p>{entry.siteLabel && entry.siteLabel !== 'global' ? `Unidade: ${entry.siteLabel}` : 'Aplicação: geral'} · Referência: {entry.targetId || 'global'}</p></article>)}</div> : <EmptyState message="Nenhuma ação administrativa recente." />}</Panel>
}
function StatusBadge({ status, remainingSeconds }: { status?: string; remainingSeconds?: number }) {
  const normalized = (status || '').toLowerCase()
  const isCritical = normalized.includes('blocked') || normalized.includes('revoked') || normalized.includes('failed') || normalized.includes('error')
  const isWarning = normalized.includes('expired') || normalized.includes('ended') || normalized.includes('reauth') || (typeof remainingSeconds === 'number' && remainingSeconds > 0 && remainingSeconds <= 600)
  const label = normalized.includes('authorized') ? 'Autorizada' : normalized.includes('expired') ? 'Expirada' : normalized.includes('ended') || normalized.includes('disconnected') ? 'Encerrada' : normalized.includes('blocked') ? 'Bloqueada' : status || 'Indefinida'
  return <span className={`status-badge ${isCritical ? 'critical' : isWarning ? 'warning' : 'ok'}`}>{label}</span>
}

function SessionsPage({ sessions, sites, admin, canManage, filter, busy, feedback, onFilter, onRunOperation }: { sessions: GuestSessionRow[]; sites: SiteNode[]; admin: AdminMe | null; canManage: boolean; filter: SessionFilter; busy: boolean; feedback: string; onFilter: (value: SessionFilter) => void; onRunOperation: (sessionId: string, operation: 'end' | 'require-reauthentication' | 'extend' | 'reauthorize' | 'block', body: Record<string, unknown>) => Promise<SessionOperationResponse> }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<GuestSessionRow | null>(null)
  const [action, setAction] = useState<{ session: GuestSessionRow; type: 'end' | 'require-reauthentication' | 'extend' | 'reauthorize' | 'block' } | null>(null)
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [scope, setScope] = useState<'SITE' | 'GLOBAL'>('SITE')
  const labels: Record<SessionFilter, string> = { all: 'Todas', online: 'Online', 'expiring-30': 'Expiram em 30 min', 'expiring-10': 'Expiram em 10 min', 'ended-today': 'Encerradas hoje' }
  const siteLabel = (site?: string) => sites.find((item) => item.siteId === site || item.name === site)?.name || site || 'Não informado'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const needle = query.trim().toLowerCase()
  const filtered = sessions.filter((session) => {
    const haystack = [session.name, session.clientMac, session.ssid, session.site, session.apMac, session.status, session.method].join(' ').toLowerCase()
    if (needle && !haystack.includes(needle)) return false
    if (filter === 'online') return session.status === 'authorized' && (session.unlimited || session.remainingSeconds > 0)
    if (filter === 'expiring-30') return session.status === 'authorized' && !session.unlimited && session.remainingSeconds > 0 && session.remainingSeconds <= 1800
    if (filter === 'expiring-10') return session.status === 'authorized' && !session.unlimited && session.remainingSeconds > 0 && session.remainingSeconds <= 600
    if (filter === 'ended-today') return Boolean(session.endedAt || session.disconnectedAt || session.status === 'expired' || session.status === 'disconnected') && new Date(session.endedAt || session.disconnectedAt || session.expiresAt || session.createdAt).getTime() >= today.getTime()
    return true
  })
  const groupedRows = Array.from(filtered.reduce((map, session) => {
    const key = (session.clientMac || session.id).toLowerCase()
    const list = map.get(key) || []
    list.push(session)
    map.set(key, list)
    return map
  }, new Map<string, GuestSessionRow[]>()).values()).map((history) => {
    const ordered = [...history].sort((a, b) => new Date(b.authorizedAt || b.createdAt).getTime() - new Date(a.authorizedAt || a.createdAt).getTime())
    return { latest: ordered[0], history: ordered }
  }).sort((a, b) => new Date(b.latest.authorizedAt || b.latest.createdAt).getTime() - new Date(a.latest.authorizedAt || a.latest.createdAt).getTime())
  const historyFor = (session: GuestSessionRow | null) => session ? groupedRows.find((row) => row.latest.clientMac === session.clientMac)?.history || [session] : []
  const openAction = (session: GuestSessionRow, type: 'end' | 'require-reauthentication' | 'extend' | 'reauthorize' | 'block') => { setAction({ session, type }); setSelected(session); setReason(''); setMinutes(type === 'reauthorize' ? 60 : 30); setScope('SITE') }
  const submitAction = async () => {
    if (!action || reason.trim().length < 3) return
    const body: Record<string, unknown> = { reason: reason.trim() }
    if (action.type === 'extend') body.additionalMinutes = minutes
    if (action.type === 'reauthorize') body.durationMinutes = minutes
    if (action.type === 'block') { body.durationMinutes = minutes > 0 ? minutes : null; body.scope = scope }
    await onRunOperation(action.session.id, action.type, body)
    setAction(null)
    setReason('')
  }
  return <div className="admin-content"><PageHeader title="Sessões" description="Dispositivos agrupados por MAC, com histórico e ações rápidas." /><Panel title="Sessões do portal" icon={<MonitorCheck />}><div className="table-toolbar"><input aria-label="Buscar sessão" placeholder="Buscar por nome, MAC, método, SSID, unidade ou AP..." value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="segmented" role="tablist" aria-label="Filtro de sessões">{Object.entries(labels).map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} type="button" onClick={() => onFilter(key as SessionFilter)}>{label}</button>)}</div>{feedback ? <p className={feedback.includes('sucesso') || feedback.includes('encerrado') || feedback.includes('bloqueado') ? 'success session-action-feedback' : 'error session-action-feedback'} role="status">{feedback}</p> : null}{groupedRows.length ? <div className="session-device-list">{groupedRows.map(({ latest, history }) => <article className="session-device-card" key={latest.clientMac || latest.id}><button className="session-device-main" type="button" onClick={() => setSelected(latest)}><div><strong>{latest.name || latest.clientMac}</strong><small>{latest.clientMac}</small></div><dl><div><dt>Método atual</dt><dd>{latest.method}</dd></div><div><dt>Unidade/rede</dt><dd>{siteLabel(latest.site)} · {latest.ssid || 'SSID não disponível'}</dd></div><div><dt>Expiração</dt><dd>{latest.unlimited ? 'Sem limite' : formatClock(latest.expiresAt)}</dd></div><div><dt>Restante</dt><dd>{latest.unlimited ? 'Sem limite' : formatCountdown(latest.remainingSeconds)}</dd></div></dl><StatusBadge status={latest.status} remainingSeconds={latest.remainingSeconds} /><span className="history-chip">{history.length} sessão{history.length === 1 ? '' : 'es'}</span></button><div className="quick-actions" aria-label="Ações rápidas da sessão"><button className="table-action" type="button" onClick={() => setSelected(latest)}>Histórico</button>{canManage ? <><button className="table-action warning" type="button" disabled={busy || !latest.canRequireReauth} onClick={() => openAction(latest, 'require-reauthentication')}>Reautenticar</button><button className="table-action" type="button" disabled={busy || !latest.canExtend} onClick={() => openAction(latest, 'extend')}>+ tempo</button><button className="table-action danger" type="button" disabled={busy || !latest.canEndAccess} onClick={() => openAction(latest, 'end')}>Encerrar</button><button className="table-action danger-text" type="button" disabled={busy || !latest.canBlock} onClick={() => openAction(latest, 'block')}>Bloquear</button></> : null}</div></article>)}</div> : <EmptyState message="Nenhuma sessão encontrada para os filtros atuais." />}</Panel>{selected ? <SessionDrawer session={selected} history={historyFor(selected)} siteLabel={siteLabel} canManage={canManage} canRevealSensitive={admin?.role === 'SUPERADMIN'} busy={busy} onClose={() => setSelected(null)} onAction={openAction} /> : null}{action ? <SessionActionModal action={action.type} session={action.session} reason={reason} minutes={minutes} scope={scope} busy={busy} onReason={setReason} onMinutes={setMinutes} onScope={setScope} onCancel={() => setAction(null)} onConfirm={() => void submitAction()} /> : null}</div>
}

function SessionDrawer({ session, history, siteLabel, canManage, canRevealSensitive, busy, onClose, onAction }: { session: GuestSessionRow; history: GuestSessionRow[]; siteLabel: (site?: string) => string; canManage: boolean; canRevealSensitive: boolean; busy: boolean; onClose: () => void; onAction: (session: GuestSessionRow, action: 'end' | 'require-reauthentication' | 'extend' | 'reauthorize' | 'block') => void }) {
  const [revealReason, setRevealReason] = useState('')
  const [revealBusy, setRevealBusy] = useState(false)
  const [revealData, setRevealData] = useState<SensitiveSessionReveal | null>(null)
  const [revealMessage, setRevealMessage] = useState('')
  const timeline = [
    ['Cliente detectado', session.createdAt],
    ['Termos aceitos', session.authorizedAt],
    ['Autorização confirmada', session.authorizedAt],
    ['Expiração prevista', session.expiresAt],
    ['Encerramento administrativo', session.endedAt],
    ['Reautenticação exigida', session.reauthRequiredAt],
  ].filter((item) => item[1])
  const revealSensitive = async () => {
    setRevealBusy(true)
    setRevealMessage('')
    try {
      const data = await api<SensitiveSessionReveal>(`/api/admin/sessions/${encodeURIComponent(session.id)}/reveal-sensitive`, { method: 'POST', body: JSON.stringify({ reason: revealReason.trim() }) })
      setRevealData(data)
      setRevealMessage('Dados revelados e auditoria registrada.')
    } catch (err) {
      setRevealMessage(err instanceof Error ? err.message : 'Não foi possível revelar os dados.')
    } finally {
      setRevealBusy(false)
    }
  }
  return <aside className="session-drawer" role="dialog" aria-modal="true" aria-labelledby="session-drawer-title"><div className="drawer-head"><div><span>Detalhes da sessão</span><h2 id="session-drawer-title">{session.name || session.clientMac}</h2></div><button type="button" aria-label="Fechar detalhes" onClick={onClose}><X /></button></div><div className="drawer-grid"><Panel title="Visitante"><InfoLine label="Nome" value={revealData?.name || session.name || 'Não informado'} /><InfoLine label="CPF" value={revealData?.cpf || 'Mascarado/indisponível'} /><InfoLine label="E-mail" value={revealData?.email || 'Mascarado/indisponível'} /><InfoLine label="Telefone" value={revealData?.phone || 'Mascarado/indisponível'} />{canRevealSensitive ? <div className="sensitive-reveal-box"><label htmlFor={`reveal-reason-${session.id}`}>Motivo da consulta<textarea id={`reveal-reason-${session.id}`} value={revealReason} onChange={(event) => setRevealReason(event.target.value)} rows={3} placeholder="Ex.: solicitação formal, auditoria interna ou atendimento ao titular" /></label><button className="table-action warning" type="button" onClick={() => void revealSensitive()} disabled={revealBusy || revealReason.trim().length < 8}>{revealBusy ? 'Registrando...' : 'Revelar dados auditados'}</button>{revealMessage ? <p className={revealData ? 'success' : 'error'} role="status">{revealMessage}</p> : null}</div> : <p className="panel-note">Dados sensíveis só podem ser revelados por SUPERADMIN em fluxo auditado.</p>}</Panel><Panel title="Dispositivo"><InfoLine label="MAC observado" value={session.clientMac} /><InfoLine label="AP" value={session.apMac || 'Não informado'} /><InfoLine label="SSID" value={session.ssid || 'Não disponível'} /></Panel><Panel title="Sessão atual"><InfoLine label="Método" value={session.method} /><InfoLine label="Unidade" value={siteLabel(session.site)} /><InfoLine label="Status local" value={session.status} /><InfoLine label="Status na rede" value={session.canEndAccess ? 'Autorizado' : 'Não confirmado'} /><InfoLine label="Tempo restante" value={session.unlimited ? 'Sem limite' : formatCountdown(session.remainingSeconds)} /><InfoLine label="Última sincronização" value="Atualização automática do painel" /></Panel><Panel title="Timeline"><ol className="session-timeline">{timeline.map(([label, value]) => <li key={label}><strong>{label}</strong><span>{formatClock(value)}</span></li>)}</ol></Panel><Panel title="Histórico deste dispositivo"><div className="session-history-list">{history.map((item) => <article key={item.id}><strong>{item.method} · {siteLabel(item.site)}</strong><span>{formatClock(item.authorizedAt || item.createdAt)} → {item.unlimited ? 'Sem limite' : formatClock(item.expiresAt)}</span><small>{item.ssid || 'SSID não informado'} · {item.status}</small></article>)}</div></Panel></div>{canManage ? <footer className="drawer-actions"><button className="table-action danger" disabled={busy || !session.canEndAccess} onClick={() => onAction(session, 'end')}>Encerrar acesso</button><button className="table-action warning" disabled={busy || !session.canRequireReauth} onClick={() => onAction(session, 'require-reauthentication')}>Exigir nova autenticação</button><button className="table-action" disabled={busy || !session.canExtend} onClick={() => onAction(session, 'extend')}>Estender</button><button className="table-action" disabled={busy || !session.canReauthorize} onClick={() => onAction(session, 'reauthorize')}>Autorizar novamente</button><button className="table-action danger" disabled={busy || !session.canBlock} onClick={() => onAction(session, 'block')}>Bloquear</button></footer> : <div className="readonly-banner compact"><span>VIEWER</span><strong>Somente leitura</strong><p>Seu perfil não executa ações sobre sessões.</p></div>}</aside>
}
function SessionActionModal({ action, session, reason, minutes, scope, busy, onReason, onMinutes, onScope, onCancel, onConfirm }: { action: 'end' | 'require-reauthentication' | 'extend' | 'reauthorize' | 'block'; session: GuestSessionRow; reason: string; minutes: number; scope: 'SITE' | 'GLOBAL'; busy: boolean; onReason: (value: string) => void; onMinutes: (value: number) => void; onScope: (value: 'SITE' | 'GLOBAL') => void; onCancel: () => void; onConfirm: () => void }) {
  const titles = { end: 'Encerrar acesso?', 'require-reauthentication': 'Exigir nova autenticação?', extend: 'Estender sessão?', reauthorize: 'Autorizar novamente?', block: 'Bloquear no portal?' }
  const needsMinutes = action === 'extend' || action === 'reauthorize' || action === 'block'
  return <div className="modal-backdrop centered" role="presentation"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="session-action-title"><div className="modal-head"><div><span>Ação sensível</span><h2 id="session-action-title">{titles[action]}</h2></div><button type="button" aria-label="Fechar" onClick={onCancel}><X /></button></div><div className="panel-form"><p className="panel-note"><strong>Dispositivo:</strong> {session.name || session.clientMac}<br /><strong>Unidade:</strong> {session.site || 'Não informada'}</p>{needsMinutes ? <label htmlFor="operation-minutes">Duração<select id="operation-minutes" value={minutes} onChange={(event) => onMinutes(Number(event.target.value))}><option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={60}>1 hora</option><option value={240}>4 horas</option><option value={1440}>24 horas</option><option value={10080}>7 dias</option><option value={0}>Permanente</option></select></label> : null}{action === 'block' ? <label htmlFor="operation-scope">Abrangência<select id="operation-scope" value={scope} onChange={(event) => onScope(event.target.value as 'SITE' | 'GLOBAL')}><option value="SITE">Unidade atual</option><option value="GLOBAL">Global</option></select></label> : null}<label htmlFor="operation-reason">Motivo<textarea id="operation-reason" value={reason} onChange={(event) => onReason(event.target.value)} rows={4} autoFocus /></label><div className="modal-actions"><button className="soft-button" type="button" onClick={onCancel} disabled={busy}>Cancelar</button><button className="primary" type="button" onClick={onConfirm} disabled={busy || reason.trim().length < 3}>{busy ? 'Executando...' : 'Confirmar ação'}</button></div></div></section></div>
}
function VisitorsPanel({ visitors, canManage, busy, onEndSession }: { visitors: ClientRow[]; canManage: boolean; busy: boolean; onEndSession: (sessionId: string) => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [site, setSite] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [selected, setSelected] = useState<ClientRow | null>(null)
  const [confirmEnd, setConfirmEnd] = useState<ClientRow | null>(null)
  const [feedback, setFeedback] = useState('')
  const sites = Array.from(new Set(visitors.map((row) => textValue(row, ['siteName', 'siteId'])).filter(Boolean)))
  const filtered = visitors.filter((row) => {
    const blob = JSON.stringify(row).toLowerCase()
    const rowSite = textValue(row, ['siteName', 'siteId'])
    const rowStatus = boolValue(row, 'authorized') ? 'authorized' : textValue(row, ['portalStatus', 'status']).toLowerCase()
    return (!query || blob.includes(query.toLowerCase())) && (site === 'ALL' || rowSite === site) && (status === 'ALL' || rowStatus.includes(status.toLowerCase()))
  })
  const endAccess = async (row: ClientRow) => {
    const sessionId = textValue(row, ['sessionId'])
    if (!sessionId) return
    setFeedback('')
    try {
      await onEndSession(sessionId)
      setFeedback('Acesso encerrado com sucesso.')
      setConfirmEnd(null)
      setSelected(null)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Não foi possível encerrar o acesso.')
    }
  }
  return <div className="admin-content"><Panel title="Usuários e visitantes" icon={<UsersRound />}><div className="table-toolbar"><input aria-label="Buscar visitante" placeholder="Buscar por nome, MAC observado, IP, SSID, AP..." value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Filtrar por site" value={site} onChange={(event) => setSite(event.target.value)}><option value="ALL">Todas as unidades</option>{sites.map((item) => <option key={item} value={item}>{item}</option>)}</select><select aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Todos os status</option><option value="authorized">Autorizado</option><option value="expired">Expirado</option><option value="disconnected">Encerrado</option></select></div>{feedback ? <p className={feedback.includes('sucesso') ? 'success session-action-feedback' : 'error session-action-feedback'} role="status">{feedback}</p> : null}{filtered.length ? <div className="visitor-grid">{filtered.map((row, index) => <button className="visitor-card" key={textValue(row, ['id', 'mac']) || index} type="button" onClick={() => setSelected(row)}><div><strong>{textValue(row, ['name', 'hostname']) || 'Dispositivo sem nome'}</strong><span>{textValue(row, ['siteName']) || 'Unidade não informada'} - {textValue(row, ['ssid']) || 'SSID indisponível'}</span></div><dl><div><dt>MAC observado</dt><dd>{textValue(row, ['mac']) || '-'}</dd></div><div><dt>IP</dt><dd>{textValue(row, ['ip']) || '-'}</dd></div><div><dt>Status</dt><dd>{boolValue(row, 'authorized') ? 'Autorizado' : textValue(row, ['portalStatus', 'status']) || '-'}</dd></div><div><dt>Tempo restante</dt><dd>{boolValue(row, 'unlimited') ? 'Sem limite' : row.remainingSeconds ? formatCountdown(Number(row.remainingSeconds)) : '-'}</dd></div></dl></button>)}</div> : <EmptyState message="Nenhum visitante encontrado." />}</Panel>{selected ? <ClientDrawer row={selected} canManage={canManage} onClose={() => setSelected(null)} onEnd={() => setConfirmEnd(selected)} /> : null}{confirmEnd ? <ConfirmDialog title="Encerrar acesso" message="Esta ação encerra o acesso deste visitante à rede. Continuar?" busy={busy} onCancel={() => setConfirmEnd(null)} onConfirm={() => void endAccess(confirmEnd)} /> : null}</div>
}
function ClientDrawer({ row, canManage, onClose, onEnd }: { row: ClientRow; canManage: boolean; onClose: () => void; onEnd: () => void }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label="Informações do dispositivo" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span>Informações do dispositivo</span><h2>{textValue(row, ['name', 'hostname']) || 'Dispositivo sem nome'}</h2></div><button type="button" aria-label="Fechar" onClick={onClose}><X /></button></div><div className="detail-list"><InfoLine label="MAC observado" value={textValue(row, ['mac'])} /><InfoLine label="IP" value={textValue(row, ['ip'])} /><InfoLine label="Unidade" value={textValue(row, ['siteName', 'siteId'])} /><InfoLine label="AP" value={textValue(row, ['apMac'])} /><InfoLine label="SSID" value={textValue(row, ['ssid'])} /><InfoLine label="Sinal" value={textValue(row, ['signal'])} /><InfoLine label="Método de autenticação" value={textValue(row, ['authorizationMethod'])} /><InfoLine label="Autorizado em" value={formatClock(textValue(row, ['authorizedAt']))} /><InfoLine label="Expira em" value={formatClock(textValue(row, ['expiresAt']))} /><InfoLine label="Tempo restante" value={boolValue(row, 'unlimited') ? 'Sem limite' : row.remainingSeconds ? formatCountdown(Number(row.remainingSeconds)) : ''} /></div>{canManage && boolValue(row, 'canEndAccess') ? <button className="danger-button" type="button" onClick={onEnd}>Encerrar acesso</button> : <p className="panel-note">{canManage ? 'Nenhuma ação de acesso está disponível para este dispositivo.' : 'Seu perfil possui acesso somente leitura.'}</p>}</aside></div>
}

function AccessPointsPanel({ accessPoints }: { accessPoints: AccessPoint[] }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AccessPoint | null>(null)
  const filtered = accessPoints.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()))
  return <div className="admin-content"><Panel title="Pontos de acesso" icon={<Radio />}><div className="table-toolbar"><input aria-label="Buscar access point" placeholder="Buscar por nome, modelo, MAC, IP ou unidade..." value={query} onChange={(event) => setQuery(event.target.value)} /></div>{filtered.length ? <div className="ap-grid">{filtered.map((ap, index) => <button className="ap-card" key={textValue(ap, ['id', 'mac']) || index} type="button" onClick={() => setSelected(ap)}><div><strong>{textValue(ap, ['name']) || 'AP sem nome'}</strong><span>{textValue(ap, ['model']) || 'Modelo indisponível'}</span></div><dl><div><dt>MAC</dt><dd>{textValue(ap, ['mac']) || '-'}</dd></div><div><dt>IP</dt><dd>{textValue(ap, ['ip']) || '-'}</dd></div><div><dt>Site</dt><dd>{textValue(ap, ['siteName']) || '-'}</dd></div><div><dt>Clientes</dt><dd>{textValue(ap, ['clientes']) || '-'}</dd></div><div><dt>Canal</dt><dd>{textValue(ap, ['canal']) || '-'}</dd></div><div><dt>Banda</dt><dd>{textValue(ap, ['banda']) || '-'}</dd></div></dl></button>)}</div> : <EmptyState message="Nenhum ponto de acesso disponível." />}</Panel>{selected ? <ApDrawer row={selected} onClose={() => setSelected(null)} /> : null}</div>
}

function ApDrawer({ row, onClose }: { row: AccessPoint; onClose: () => void }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label="Detalhes do access point" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span>Access Point</span><h2>{textValue(row, ['name']) || 'AP sem nome'}</h2></div><button type="button" aria-label="Fechar" onClick={onClose}><X /></button></div><div className="detail-list"><InfoLine label="Modelo" value={textValue(row, ['model'])} /><InfoLine label="MAC" value={textValue(row, ['mac'])} /><InfoLine label="IP" value={textValue(row, ['ip'])} /><InfoLine label="Unidade" value={textValue(row, ['siteName'])} /><InfoLine label="Status" value={textValue(row, ['status'])} /><InfoLine label="Clientes" value={textValue(row, ['clientes'])} /><InfoLine label="Uptime" value={textValue(row, ['uptime'])} /><InfoLine label="Canal" value={textValue(row, ['canal'])} /><InfoLine label="Banda" value={textValue(row, ['banda'])} /></div><p className="panel-note">Ações avançadas do equipamento não estão disponíveis neste painel.</p></aside></div>
}



function AdminsPanel({ admin, admins, invitations, allowedSites, onChanged, onToast }: { admin: AdminMe | null; admins: AdminUserRow[]; invitations: AdminInviteResponse[]; allowedSites: AllowedSite[]; onChanged: () => Promise<void>; onToast: (tone: AdminToastTone, title: string, message: string) => void }) {
  const canManage = admin?.role === 'SUPERADMIN'
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [invite, setInvite] = useState<AdminInviteResponse | null>(null)
  const [form, setForm] = useState({ name: '', email: '', role: 'ADMIN', siteIds: allowedSites.map((site) => site.siteId) })
  const [editingAccess, setEditingAccess] = useState<AdminUserRow | null>(null)
  const [accessSiteIds, setAccessSiteIds] = useState<string[]>([])
  const siteLabel = (siteId: string) => allowedSites.find((site) => site.siteId === siteId)?.name || siteId
  const adminSiteLabel = (row: AdminUserRow) => row.canSelectAllSites ? 'Todas as unidades' : row.siteIds?.length ? row.siteIds.map(siteLabel).join(', ') : 'Sem unidade atribuída'
  const invitationSummary = invitations.reduce((acc, row) => {
    const status = row.deliveryStatus.toUpperCase()
    const expired = row.expiresAt ? new Date(row.expiresAt).getTime() < Date.now() : false
    if (status === 'REVOKED') acc.revoked += 1
    else if (expired || status === 'EXPIRED') acc.expired += 1
    else if (status !== 'ACCEPTED') acc.pending += 1
    return acc
  }, { pending: 0, expired: 0, revoked: 0 })
  const groupedInvitations = Array.from(invitations.reduce((map, row) => {
    const key = row.email.trim().toLowerCase() || row.id
    const items = map.get(key) ?? []
    items.push(row)
    map.set(key, items)
    return map
  }, new Map<string, AdminInviteResponse[]>()).values()).map((items) => {
    const history = [...items].sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime())
    return { latest: history[0], history }
  })

  const toggleInviteSite = (siteId: string) => {
    setForm((current) => {
      const selected = current.siteIds.includes(siteId) ? current.siteIds.filter((item) => item !== siteId) : [...current.siteIds, siteId]
      return { ...current, siteIds: selected }
    })
  }
  const toggleAccessSite = (siteId: string) => {
    setAccessSiteIds((current) => current.includes(siteId) ? current.filter((item) => item !== siteId) : [...current, siteId])
  }
  const openAccessEditor = (row: AdminUserRow) => {
    setEditingAccess(row)
    setAccessSiteIds(row.siteIds ?? [])
    setMessage('')
  }
  const saveAccess = async () => {
    if (!editingAccess) return
    setBusy(true)
    setMessage('')
    try {
      await api(`/api/admin/admins/${encodeURIComponent(editingAccess.id)}/site-access`, { method: 'PUT', body: JSON.stringify({ siteIds: accessSiteIds }) })
      setMessage('Permissões de unidade atualizadas com sucesso.')
      onToast('success', 'Permissões salvas', `Acesso de ${editingAccess.name} atualizado.`)
      setEditingAccess(null)
      await onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível atualizar permissões.'
      setMessage(message)
      onToast('error', 'Permissões não salvas', message)
    } finally {
      setBusy(false)
    }
  }
  const createInvite = async () => {
    setBusy(true)
    setMessage('')
    setInvite(null)
    try {
      const siteIds = form.role === 'SUPERADMIN' ? [] : form.siteIds
      const response = await api<AdminInviteResponse>('/api/admin/admins/invitations', {
        method: 'POST',
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), role: form.role, siteIds }),
      })
      setInvite(response)
      const sent = response.deliveryStatus.toLowerCase() === 'sent'
      const nextMessage = sent ? 'Convite enviado com sucesso.' : 'Convite criado, mas o e-mail não foi enviado. Copie o link para enviar manualmente.'
      setMessage(nextMessage)
      onToast(sent ? 'success' : 'error', sent ? 'Convite enviado' : 'Convite sem e-mail', sent ? `Enviado para ${response.email}.` : 'O e-mail não pôde ser enviado. Use o link manual e confira o Status do sistema.')
      await onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível criar o convite.'
      setMessage(message)
      onToast('error', 'Convite não criado', message)
    } finally {
      setBusy(false)
    }
  }
  const renewInvite = async (inviteId: string) => {
    setBusy(true)
    setMessage('')
    try {
      const response = await api<AdminInviteResponse>(`/api/admin/admins/invitations/${encodeURIComponent(inviteId)}/renew`, { method: 'POST' })
      setInvite(response)
      const sent = response.deliveryStatus.toLowerCase() === 'sent'
      const nextMessage = sent ? 'Novo link enviado por e-mail.' : 'Novo link criado, mas o e-mail não foi enviado. Copie o link para enviar manualmente.'
      setMessage(nextMessage)
      onToast(sent ? 'success' : 'error', sent ? 'Novo link enviado' : 'Novo link sem e-mail', sent ? `Enviado para ${response.email}.` : 'O e-mail não pôde ser enviado. Copie o link manual e confira o Status do sistema.')
      await onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível gerar novo link.'
      setMessage(message)
      onToast('error', 'Novo link falhou', message)
    } finally {
      setBusy(false)
    }
  }
  const revokeInvite = async (inviteId: string) => {
    setBusy(true)
    setMessage('')
    try {
      await api<AdminInviteResponse>(`/api/admin/admins/invitations/${encodeURIComponent(inviteId)}/revoke`, { method: 'POST' })
      setMessage('Convite revogado com sucesso.')
      onToast('success', 'Convite revogado', 'O link anterior não poderá mais ser usado.')
      await onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível revogar o convite.'
      setMessage(message)
      onToast('error', 'Revogação falhou', message)
    } finally {
      setBusy(false)
    }
  }
  const copyInviteLink = async (url: string) => {
    try {
      await copyToClipboard(url)
      setMessage('Link copiado para a área de transferência.')
      onToast('success', 'Link copiado', 'Agora você pode enviar o convite manualmente.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível copiar o link.'
      setMessage(message)
      onToast('error', 'Cópia falhou', message)
    }
  }

  return <div className="admin-content"><PageHeader title="Administradores" description="Convide administradores e defina o perfil e as unidades permitidas." action={canManage ? <button className="soft-button" type="button" onClick={() => { setForm({ name: '', email: '', role: 'ADMIN', siteIds: allowedSites.map((site) => site.siteId) }); setOpen(true); setMessage(''); setInvite(null) }}><UserCog /> Novo administrador</button> : null} />{message ? <p className={message.includes('sucesso') || message.includes('criado') ? 'success admin-inline-feedback' : 'error admin-inline-feedback'} role="status">{message}</p> : null}<Panel title="Administradores" icon={<UserCog />}>{admins.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Nome</th><th>Email</th><th>Perfil</th><th>Unidades</th><th>Status</th><th>Verificação</th><th>Último login</th><th>Criado em</th><th>Ações</th></tr></thead><tbody>{admins.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.email}</td><td>{row.role}</td><td>{adminSiteLabel(row)}</td><td>{row.status}</td><td>{row.mfa === 'not_configured' ? 'Não configurado' : row.mfa}</td><td>{formatClock(row.lastLogin)}</td><td>{formatClock(row.createdAt)}</td><td>{canManage && row.role !== 'SUPERADMIN' ? <button className="table-action" type="button" onClick={() => openAccessEditor(row)}>Unidades</button> : <span className="muted-cell">Global</span>}</td></tr>)}</tbody></table></div> : <EmptyState message={canManage ? 'Nenhum administrador adicional encontrado.' : 'Somente SUPERADMIN pode listar administradores.'} />}</Panel><Panel title="Convites administrativos" icon={<UserCog />}><div className="invite-summary-row"><span>Pendentes: {invitationSummary.pending}</span><span>Expirados: {invitationSummary.expired}</span><span>Revogados: {invitationSummary.revoked}</span></div>{groupedInvitations.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Nome</th><th>Email</th><th>Perfil</th><th>Unidades</th><th>Status</th><th>Expira em</th><th>Ações</th></tr></thead><tbody>{groupedInvitations.map(({ latest: row, history }) => <tr key={row.id}><td><strong>{row.name}</strong>{history.length > 1 ? <small className="row-subtle">{history.length} convites</small> : null}</td><td>{row.email}</td><td>{row.role}</td><td>{asArray(row.siteIds).length ? asArray(row.siteIds).map(siteLabel).join(', ') : 'Acesso global'}</td><td>{row.deliveryStatus}</td><td>{formatClock(row.expiresAt)}</td><td><div className="table-actions-inline"><button className="table-action" type="button" onClick={() => void renewInvite(row.id)} disabled={busy || row.deliveryStatus === 'ACCEPTED'}>Novo link</button>{row.inviteUrl ? <button className="table-action" type="button" onClick={() => void copyInviteLink(row.inviteUrl || '')}>Copiar</button> : null}<button className="table-action danger-text" type="button" onClick={() => void revokeInvite(row.id)} disabled={busy || row.deliveryStatus === 'ACCEPTED' || row.deliveryStatus === 'REVOKED'}>Revogar</button></div></td></tr>)}</tbody></table></div> : <EmptyState message="Nenhum convite administrativo encontrado." />}</Panel>{open ? <div className="modal-backdrop centered" role="presentation"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-invite-title"><div className="modal-head"><div><span>Permissões</span><h2 id="admin-invite-title">Convidar administrador</h2></div><button type="button" aria-label="Fechar" onClick={() => setOpen(false)}><X /></button></div><div className="panel-form"><label htmlFor="invite-name">Nome<input id="invite-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoComplete="name" /></label><label htmlFor="invite-email">E-mail<input id="invite-email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" /></label><label htmlFor="invite-role">Perfil<select id="invite-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="ADMIN">ADMIN</option><option value="VIEWER">VIEWER</option><option value="SUPERADMIN">SUPERADMIN</option></select></label>{form.role !== 'SUPERADMIN' ? <fieldset className="site-checks"><legend>Unidades permitidas</legend>{allowedSites.length ? allowedSites.map((site) => <label className="checkline" key={site.siteId}><input type="checkbox" checked={form.siteIds.includes(site.siteId)} onChange={() => toggleInviteSite(site.siteId)} /> {site.name}</label>) : <p className="panel-note">Nenhuma unidade disponível para atribuição.</p>}</fieldset> : <p className="panel-note">O perfil SUPERADMIN possui acesso a todas as unidades e configurações.</p>}<button className="primary admin-save" type="button" onClick={() => void createInvite()} disabled={busy || (form.role !== 'SUPERADMIN' && !form.siteIds.length)}>{busy ? 'Enviando...' : 'Enviar convite'}</button>{invite ? <div className="invite-result"><span>{invite.deliveryStatus === 'sent' ? 'E-mail enviado' : 'Envio de e-mail pendente'}</span><strong>{invite.email}</strong><p>Expira em {formatClock(invite.expiresAt)}</p>{asArray(invite.siteIds).length ? <p>Unidades: {asArray(invite.siteIds).map(siteLabel).join(', ')}</p> : <p>Unidades: acesso global</p>}{invite.inviteUrl ? <button className="soft-button" type="button" onClick={() => void copyInviteLink(invite.inviteUrl || '')}><Copy /> Copiar convite</button> : null}</div> : null}</div></section></div> : null}{editingAccess ? <div className="modal-backdrop centered" role="presentation"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="site-access-title"><div className="modal-head"><div><span>Permissões</span><h2 id="site-access-title">Unidades de {editingAccess.name}</h2></div><button type="button" aria-label="Fechar" onClick={() => setEditingAccess(null)}><X /></button></div><div className="panel-form"><fieldset className="site-checks"><legend>Unidades permitidas</legend>{allowedSites.map((site) => <label className="checkline" key={site.siteId}><input type="checkbox" checked={accessSiteIds.includes(site.siteId)} onChange={() => toggleAccessSite(site.siteId)} /> {site.name}</label>)}</fieldset><button className="primary admin-save" type="button" onClick={() => void saveAccess()} disabled={busy || !accessSiteIds.length}>{busy ? 'Salvando...' : 'Salvar permissões'}</button></div></section></div> : null}</div>
}
function AccountSettingsPanel({ admin, onRequestPasswordReset, onResetPassword, onToast }: { admin: AdminMe | null; onRequestPasswordReset: (email: string) => Promise<void>; onResetPassword: (email: string, code: string, password: string, confirmPassword: string) => Promise<void>; onToast: (tone: AdminToastTone, title: string, message: string) => void }) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<'success' | 'error' | 'info'>('info')
  const requestCode = async () => {
    if (!admin?.email) return
    setBusy(true)
    setMessage('')
    try {
      await onRequestPasswordReset(admin.email)
      setTone('success')
      setMessage('Enviamos um código para o e-mail administrativo cadastrado.')
      onToast('success', 'Código enviado', 'Verifique o e-mail administrativo para continuar a troca de senha.')
    } catch (err) {
      setTone('error')
      const message = err instanceof Error ? err.message : 'Não foi possível enviar o código agora.'
      setMessage(message)
      onToast('error', 'Código não enviado', message)
    } finally {
      setBusy(false)
    }
  }
  const savePassword = async () => {
    if (!admin?.email) return
    setBusy(true)
    setMessage('')
    try {
      await onResetPassword(admin.email, code, password, confirmPassword)
      setCode('')
      setPassword('')
      setConfirmPassword('')
      setTone('success')
      setMessage('Senha alterada com sucesso.')
      onToast('success', 'Senha alterada', 'Sua senha administrativa foi atualizada com sucesso.')
    } catch (err) {
      setTone('error')
      const message = err instanceof Error ? err.message : 'Não foi possível alterar a senha.'
      setMessage(message)
      onToast('error', 'Senha não alterada', message)
    } finally {
      setBusy(false)
    }
  }
  return <div className="admin-content"><PageHeader title="Configurações" description="Conta administrativa, segurança de acesso e preferências do painel." /><section className="account-settings-grid"><Panel title="Minha conta" icon={<UserRound />}><div className="account-summary"><div><span>Nome</span><strong>{admin?.name || 'Administrador'}</strong></div><div><span>E-mail</span><strong>{admin?.email || 'Não informado'}</strong></div><div><span>Perfil</span><strong>{admin?.role || 'ADMIN'}</strong></div><div><span>Abrangência</span><strong>{admin?.canSelectAllSites ? 'Todas as unidades' : admin?.siteIds?.length ? `${admin.siteIds.length} unidade(s)` : 'Sem unidade atribuída'}</strong></div></div></Panel><Panel title="Segurança da conta" icon={<LockKeyhole />}><div className="security-stack"><InfoTile title="Sessão protegida" value="Ativa" detail="Sua sessão administrativa é protegida durante o uso do painel." icon={<ShieldCheck />} /><InfoTile title="Proteção de ações" value="Ativa" detail="Alterações importantes exigem validação da sessão atual." icon={<LockKeyhole />} /><InfoTile title="Verificação por e-mail" value="Ativa" detail="Quando habilitada, o login solicita um código enviado ao e-mail cadastrado." icon={<FileClock />} /></div></Panel><Panel title="Alterar senha" icon={<Settings />}><div className="panel-form account-password-form"><p className="panel-note">Para trocar a senha, solicite um código no e-mail administrativo e defina uma nova senha forte.</p><button className="soft-button" type="button" onClick={() => void requestCode()} disabled={busy || !admin?.email}>{busy ? 'Enviando...' : 'Enviar código para meu e-mail'}</button><label htmlFor="account-reset-code">Código recebido<input id="account-reset-code" value={code} onChange={(event) => setCode(onlyDigits(event.target.value).slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></label><label htmlFor="account-new-password">Nova senha<input id="account-new-password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} /></label><label htmlFor="account-confirm-password">Confirmar senha<input id="account-confirm-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" minLength={12} /></label><button className="primary admin-save" type="button" onClick={() => void savePassword()} disabled={busy || code.length !== 6 || password.length < 12 || password !== confirmPassword}>{busy ? 'Salvando...' : 'Alterar senha'}</button>{message ? <p className={tone === 'success' ? 'success' : tone === 'error' ? 'error' : 'panel-note'} role="status">{message}</p> : null}</div></Panel></section></div>
}
function SettingsPanel({ admin, maintenance, appearance, allowedSites, selectedSiteId, siteAppearance, notices, activeTab, saving, feedback, onTabChange, onChange, onSave, onResetSite }: { admin: AdminMe | null; maintenance: MaintenanceAdmin | null; appearance: PortalAppearance; allowedSites: AllowedSite[]; selectedSiteId: string; siteAppearance: PortalSiteAppearance | null; notices: AdminNotice[]; activeTab: PortalEditorTab; saving: boolean; feedback: string; onTabChange: (value: PortalEditorTab) => void; onChange: (value: PortalAppearance) => void; onSave: () => void; onResetSite: () => void }) {
  const [device, setDevice] = useState<PreviewDevice>('mobile')
  const [previewState, setPreviewState] = useState<PreviewState>('initial')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const selectedSite = allowedSites.find((site) => site.siteId === selectedSiteId)
  const scopeLabel = selectedSiteId === 'ALL' ? 'Configuração global' : selectedSite?.name || siteAppearance?.siteName || selectedSiteId
  const activeNotice = notices.find((notice) => notice.enabled && (notice.site === 'ALL' || notice.site === selectedSiteId))
  const methods = appearance.authMethods?.length ? appearance.authMethods : (["voucher", "cpf", "email"] as Method[])
  const canManage = admin?.role !== 'VIEWER'
  const uploadLogo = async (file: File | undefined) => {
    if (!file || !canManage) return
    setUploadingLogo(true)
    try {
      const media = await uploadImageAsset(file, 'logo')
      onChange({ ...appearance, logoUrl: media.publicUrl })
    } finally {
      setUploadingLogo(false)
    }
  }
  const previewStates: Array<{ id: PreviewState; label: string }> = [
    { id: 'initial', label: 'Inicial' },
    { id: 'voucher', label: 'Voucher' },
    { id: 'cpf', label: 'CPF' },
    { id: 'email', label: 'Email' },
    { id: 'code-sent', label: 'Código' },
    { id: 'released', label: 'Liberado' },
    { id: 'maintenance', label: 'Manutenção' },
    { id: 'notice', label: 'Aviso' },
  ]
  const tabs: Array<{ id: PortalEditorTab; label: string }> = [
    { id: 'visual', label: 'Visual' },
    { id: 'methods', label: 'Métodos' },
    { id: 'terms', label: 'Termos' },
    { id: 'preview', label: 'Prévia' },
  ]
  const methodCopy = (item: Method) => item === 'voucher'
    ? ['Voucher', 'Código entregue pela equipe. Ideal para eventos e unidades controladas.']
    : item === 'cpf'
      ? ['CPF', 'Cadastro rápido com dados pessoais mínimos.']
      : ['E-mail', 'Código enviado por e-mail após confirmação por código.']
  return (
    <div className="admin-content">
      <PageHeader title="Portal público" description={canManage ? "Edite o visual, as mensagens, os termos e as formas de acesso de cada unidade." : "Consulte a aparência e as regras do portal público. Seu perfil é somente leitura."} />
      {!canManage ? <div className="readonly-banner"><span>VIEWER</span><strong>Modo somente leitura</strong><p>Você pode visualizar o portal e suas regras, mas não pode publicar alterações.</p></div> : null}
      <div className="portal-editor-context">
        <strong>{selectedSiteId === 'ALL' ? 'Padrão geral do portal' : `Editando unidade: ${scopeLabel}`}</strong>
        <span>{selectedSiteId === 'ALL' ? 'Use a base global para o padrão institucional. Para regras como somente voucher em Esdras, selecione a unidade no topo antes de salvar.' : 'Tudo que for salvo aqui vale apenas para esta unidade, incluindo logo, textos e métodos de acesso.'}</span>
      </div>
      <div className="portal-editor-tabs" role="tablist" aria-label="Etapas do editor do portal">
        {tabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} type="button" onClick={() => onTabChange(tab.id)}>{tab.label}</button>)}
      </div>
      <section className={`settings-layout visual-editor-layout ${activeTab === 'preview' ? 'preview-only' : ''}`}>
        {activeTab !== 'preview' ? <Panel title={`${tabs.find((tab) => tab.id === activeTab)?.label || 'Editor'} · ${scopeLabel}`} icon={<Settings />}>
          <fieldset className="panel-form settings-form readonly-fieldset" disabled={!canManage}>
            {selectedSiteId !== 'ALL' ? <p className="scope-note wide">Estas alterações valem somente para {scopeLabel}. O que não for personalizado continua seguindo o padrão geral.</p> : <p className="scope-note wide">Você está editando o padrão visual usado pelas unidades sem personalização própria.</p>}
            {activeTab === 'visual' ? <>
              <label htmlFor="appearance-network">Nome da rede<input id="appearance-network" value={appearance.networkName} onChange={(event) => onChange({ ...appearance, networkName: event.target.value })} /></label>
              <label htmlFor="appearance-establishment">Nome exibido<input id="appearance-establishment" value={appearance.establishmentName} onChange={(event) => onChange({ ...appearance, establishmentName: event.target.value })} /></label>
              <div className="wide media-setting-card"><div><strong>Logo do portal</strong><small>Selecione uma imagem PNG, JPG ou WebP.</small></div><div className="media-inline-control"><label className="soft-button" htmlFor="appearance-logo-upload">{uploadingLogo ? 'Enviando...' : appearance.logoUrl ? 'Trocar logo' : 'Selecionar logo'}</label><input id="appearance-logo-upload" className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadLogo(event.target.files?.[0])} disabled={uploadingLogo} />{appearance.logoUrl ? <button className="soft-button" type="button" onClick={() => onChange({ ...appearance, logoUrl: '' })}>Remover logo</button> : null}</div></div>
              <label htmlFor="appearance-color">Cor principal<div className="color-control"><input id="appearance-color" type="color" value={appearance.primaryColor} onChange={(event) => onChange({ ...appearance, primaryColor: event.target.value })} /><input aria-label="Cor principal em hexadecimal" value={appearance.primaryColor} onChange={(event) => onChange({ ...appearance, primaryColor: event.target.value })} /></div></label>
              <label className="wide" htmlFor="appearance-banner">Título da tela pública<input id="appearance-banner" value={appearance.bannerText} onChange={(event) => onChange({ ...appearance, bannerText: event.target.value })} /></label>
              <label className="wide" htmlFor="appearance-welcome">Texto de boas-vindas<textarea id="appearance-welcome" value={appearance.welcomeText} onChange={(event) => onChange({ ...appearance, welcomeText: event.target.value })} rows={3} /></label>
              <label htmlFor="appearance-success">Mensagem de sucesso<textarea id="appearance-success" value={appearance.successMessage} onChange={(event) => onChange({ ...appearance, successMessage: event.target.value })} rows={3} /></label>
              <label htmlFor="appearance-expired">Mensagem de reautenticação<textarea id="appearance-expired" value={appearance.expiredMessage} onChange={(event) => onChange({ ...appearance, expiredMessage: event.target.value })} rows={3} /></label>
            </> : null}
            {activeTab === 'methods' ? <fieldset className="auth-method-checks method-policy-card wide"><legend>Formas de acesso por unidade</legend><p>Marque apenas os métodos que podem aparecer no portal público desta unidade. A configuração também é aplicada às regras de acesso.</p><div className="method-policy-grid">{(["voucher", "cpf", "email"] as Method[]).map((item) => { const checked = methods.includes(item); const next = checked ? methods.filter((method) => method !== item) : [...methods, item]; const [title, detail] = methodCopy(item); return <label className={checked ? "method-policy-option active" : "method-policy-option"} key={item}><input type="checkbox" checked={checked} disabled={checked && methods.length === 1} onChange={() => onChange({ ...appearance, authMethods: next.length ? next : [item] })} /><span><strong>{title}</strong><small>{detail}</small></span></label> })}</div><small className="policy-safe-note">Para Esdras, deixe somente Voucher. Para Sede, marque Voucher, CPF e E-mail.</small></fieldset> : null}
            {activeTab === 'terms' ? <label className="wide" htmlFor="appearance-terms">Termos de uso<textarea id="appearance-terms" value={appearance.termsText} onChange={(event) => onChange({ ...appearance, termsText: event.target.value })} rows={16} /></label> : null}
            {canManage ? <div className="settings-actions wide"><button className="primary admin-save" type="button" onClick={onSave} disabled={saving}>{saving ? 'Salvando...' : selectedSiteId === 'ALL' ? 'Salvar padrão geral' : 'Salvar visual da unidade'}</button>{selectedSiteId !== 'ALL' && siteAppearance?.hasOverride ? <button className="soft-button" type="button" onClick={onResetSite} disabled={saving}>Voltar ao padrão geral</button> : null}</div> : null}
            {feedback ? <p className={feedback.includes('sucesso') ? 'success' : 'error'} role="status">{feedback}</p> : null}
          </fieldset>
        </Panel> : null}
        <Panel title="Prévia do portal" icon={<MonitorCheck />}>
          <div className="preview-toolbar stacked" role="group" aria-label="Contexto da prévia"><span>{selectedSiteId === 'ALL' ? 'Visualizando padrão geral' : `Visualizando como ${scopeLabel}`}</span></div>
          <div className="preview-toolbar" role="tablist" aria-label="Tamanho da prévia">{(['mobile', 'tablet', 'desktop'] as PreviewDevice[]).map((item) => <button key={item} className={device === item ? 'active' : ''} type="button" onClick={() => setDevice(item)}>{item === 'mobile' ? 'Celular' : item === 'tablet' ? 'Tablet' : 'Computador'}</button>)}</div>
          <div className="preview-toolbar wrap" role="tablist" aria-label="Tela da prévia">{previewStates.map((item) => <button key={item.id} className={previewState === item.id ? 'active' : ''} type="button" onClick={() => setPreviewState(item.id)}>{item.label}</button>)}</div>
          <PublicPortalPreview appearance={appearance} device={device} state={previewState} noticeTitle={activeNotice?.title} noticeMessage={activeNotice?.message} maintenanceTitle={maintenance?.maintenanceTitle} maintenanceMessage={maintenance?.maintenanceMessage} maintenanceImageUrl={maintenance?.maintenanceImageUrl} />
          <div className="prepared-grid single preview-security"><InfoTile title="Painel protegido" value="Ativo" detail="Somente usuários autorizados podem publicar alterações." icon={<LockKeyhole />} /><InfoTile title="Conta ativa" value={admin?.email ?? 'Autenticada'} detail="Usuário atual do painel." icon={<UserRound />} /><InfoTile title="Manutenção" value={maintenance?.maintenanceEnabled ? 'Ativa' : 'Desativada'} detail="Estado atual configurado para o portal." icon={<Clock />} /></div>
        </Panel>
      </section>
    </div>
  )
}
function MaintenanceAdminPanel({
  maintenance,
  allowedSites,
  selectedSiteId,
  canManage,
  saving,
  feedback,
  onChange,
  onSave,
}: {
  maintenance: MaintenanceAdmin
  allowedSites: AllowedSite[]
  selectedSiteId: string
  canManage: boolean
  saving: boolean
  feedback: string
  onChange: (value: MaintenanceAdmin) => void
  onSave: () => void
}) {
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const selectedSite = allowedSites.find((site) => site.siteId === selectedSiteId)
  const scopeLabel = selectedSiteId === 'ALL' ? 'todas as unidades' : selectedSite?.name || selectedSiteId
  const startAt = maintenance.maintenanceStartAt ? new Date(maintenance.maintenanceStartAt).getTime() : null
  const mode: 'off' | 'now' | 'scheduled' = !maintenance.maintenanceEnabled
    ? 'off'
    : startAt !== null && startAt > Date.now() + 30_000
      ? 'scheduled'
      : 'now'
  const maintenanceStatus = maintenance.maintenanceStatus ?? (maintenance.maintenanceActive ? 'active' : maintenance.maintenanceScheduled ? 'scheduled' : maintenance.maintenanceExpired ? 'expired' : 'disabled')
  const statusTitle = maintenanceStatus === 'active'
    ? 'Portal em manutenção agora'
    : maintenanceStatus === 'scheduled'
      ? 'Manutenção agendada'
      : maintenanceStatus === 'expired'
        ? 'Janela encerrada'
        : 'Portal funcionando normalmente'
  const statusDetail = maintenanceStatus === 'active'
    ? (maintenance.maintenanceEndAt ? `Término previsto: ${formatClock(maintenance.maintenanceEndAt)}` : 'Permanece ativa até um administrador desabilitar.')
    : maintenanceStatus === 'scheduled'
      ? `Início programado: ${formatClock(maintenance.maintenanceStartAt)}`
      : maintenanceStatus === 'expired'
        ? 'A janela terminou. Escolha uma nova programação ou deixe o portal operacional.'
        : 'Nenhum visitante está vendo a tela de manutenção.'
  const scheduleInvalid = mode === 'scheduled' && (
    !maintenance.maintenanceStartAt
    || !maintenance.maintenanceEndAt
    || new Date(maintenance.maintenanceEndAt).getTime() <= new Date(maintenance.maintenanceStartAt).getTime()
  )

  const setMode = (next: 'off' | 'now' | 'scheduled') => {
    if (!canManage) return
    if (next === 'off') {
      onChange({ ...maintenance, maintenanceEnabled: false, maintenanceStatus: 'disabled' })
      return
    }
    if (next === 'now') {
      onChange({
        ...maintenance,
        maintenanceEnabled: true,
        maintenanceStartAt: new Date().toISOString(),
        maintenanceEndAt: null,
        maintenanceExpired: false,
        maintenanceStatus: 'active',
      })
      return
    }
    const start = new Date(Date.now() + 30 * 60_000)
    const end = new Date(start.getTime() + 60 * 60_000)
    onChange({
      ...maintenance,
      maintenanceEnabled: true,
      maintenanceStartAt: start.toISOString(),
      maintenanceEndAt: end.toISOString(),
      maintenanceExpired: false,
      maintenanceStatus: 'scheduled',
    })
  }

  const setQuickWindow = (minutes: number | null) => {
    if (!canManage) return
    const start = new Date()
    const end = minutes === null ? null : new Date(start.getTime() + minutes * 60_000)
    onChange({
      ...maintenance,
      maintenanceEnabled: true,
      maintenanceStartAt: start.toISOString(),
      maintenanceEndAt: end?.toISOString() ?? null,
      maintenanceExpired: false,
      maintenanceStatus: 'active',
    })
  }

  const uploadMaintenanceImage = async (file: File | undefined) => {
    if (!file || !canManage) return
    setUploadingImage(true)
    setUploadMessage('')
    try {
      const media = await uploadImageAsset(file, 'maintenance')
      onChange({ ...maintenance, maintenanceImageUrl: media.publicUrl })
      setUploadMessage('Imagem pronta no preview. Salve para publicar.')
    } catch (err) {
      setUploadMessage(err instanceof Error ? err.message : 'Não foi possível enviar a imagem.')
    } finally {
      setUploadingImage(false)
    }
  }

  return (
    <div className="admin-content">
      <section className="maintenance-editor refined" aria-labelledby="maintenance-title">
        {!canManage ? <div className="readonly-banner"><span>VIEWER</span><strong>Modo somente leitura</strong><p>Você pode consultar a programação e o preview, mas não pode publicar alterações.</p></div> : null}
        <div className={`maintenance-status-card ${maintenanceStatus === 'active' ? 'active' : maintenanceStatus === 'scheduled' ? 'scheduled' : ''}`}>
          <div>
            <span>Status do portal · {scopeLabel}</span>
            <strong>{statusTitle}</strong>
            <p>{statusDetail}</p>
            {maintenance.maintenanceInherited ? <small>Esta unidade está herdando a configuração global. Um ADMIN pode salvar uma configuração própria para {scopeLabel}.</small> : null}
          </div>
          <span className={`maintenance-state-dot ${maintenanceStatus}`} aria-hidden="true" />
        </div>

        <div className="maintenance-mode-card">
          <div className="section-heading"><h2 id="maintenance-title">Como deseja operar?</h2><p>Escolha um modo. Datas e opções aparecem apenas quando forem necessárias.</p></div>
          <div className="maintenance-mode-grid" role="group" aria-label="Modo da manutenção">
            <button className={mode === 'off' ? 'maintenance-mode active' : 'maintenance-mode'} type="button" onClick={() => setMode('off')} disabled={!canManage}>
              <strong>Desativada</strong><span>Portal funcionando normalmente.</span>
            </button>
            <button className={mode === 'now' ? 'maintenance-mode active' : 'maintenance-mode'} type="button" onClick={() => setMode('now')} disabled={!canManage}>
              <strong>Ativar agora</strong><span>Mostra a manutenção imediatamente.</span>
            </button>
            <button className={mode === 'scheduled' ? 'maintenance-mode active' : 'maintenance-mode'} type="button" onClick={() => setMode('scheduled')} disabled={!canManage}>
              <strong>Agendar</strong><span>Define início e término futuros.</span>
            </button>
          </div>
        </div>

        <div className="maintenance-grid refined-grid">
          <div className="panel-form maintenance-form">
            {mode === 'now' ? <section className="maintenance-window-card">
              <strong>Duração desta manutenção</strong>
              <span>Escolha um período rápido ou mantenha ativa até desabilitar manualmente.</span>
              <div className="duration-choice-grid maintenance-quick-grid">
                <button className="duration-choice" type="button" onClick={() => setQuickWindow(30)} disabled={!canManage}>30 min</button>
                <button className="duration-choice" type="button" onClick={() => setQuickWindow(60)} disabled={!canManage}>1 h</button>
                <button className="duration-choice" type="button" onClick={() => setQuickWindow(120)} disabled={!canManage}>2 h</button>
                <button className={maintenance.maintenanceEndAt ? 'duration-choice' : 'duration-choice active'} type="button" onClick={() => setQuickWindow(null)} disabled={!canManage}>Até eu desativar</button>
              </div>
              {maintenance.maintenanceEndAt ? <small>Término atual: {formatClock(maintenance.maintenanceEndAt)}</small> : <small>Sem término automático.</small>}
            </section> : null}

            {mode === 'scheduled' ? <section className="maintenance-window-card">
              <strong>Janela programada</strong>
              <span>O portal entra e sai da manutenção automaticamente nas datas abaixo.</span>
              <div className="date-grid">
                <label htmlFor="maintenance-start">Início<input id="maintenance-start" type="datetime-local" value={datetimeLocal(maintenance.maintenanceStartAt)} onChange={(event) => onChange({ ...maintenance, maintenanceStartAt: fromDatetimeLocal(event.target.value) })} disabled={!canManage} /></label>
                <label htmlFor="maintenance-end">Término<input id="maintenance-end" type="datetime-local" value={datetimeLocal(maintenance.maintenanceEndAt)} onChange={(event) => onChange({ ...maintenance, maintenanceEndAt: fromDatetimeLocal(event.target.value) })} disabled={!canManage} /></label>
              </div>
              {scheduleInvalid ? <small className="field-error">Defina início e término, com o término depois do início.</small> : null}
            </section> : null}

            <section className="form-section maintenance-copy-card">
              <div className="form-section-head"><span>1</span><div><strong>Mensagem para o visitante</strong><small>Use um texto simples, sem detalhes técnicos.</small></div></div>
              <label htmlFor="maintenance-field-title">Título<input id="maintenance-field-title" value={maintenance.maintenanceTitle} onChange={(event) => onChange({ ...maintenance, maintenanceTitle: event.target.value })} disabled={!canManage} /></label>
              <label htmlFor="maintenance-field-message">Mensagem<textarea id="maintenance-field-message" value={maintenance.maintenanceMessage} onChange={(event) => onChange({ ...maintenance, maintenanceMessage: event.target.value })} rows={4} disabled={!canManage} /></label>
            </section>

            <section className="form-section maintenance-media-card">
              <div className="form-section-head"><span>2</span><div><strong>Imagem</strong><small>Opcional. PNG, JPG ou WebP.</small></div></div>
              <div className="maintenance-media-row">
                <label className={`maintenance-upload-card compact ${!canManage ? 'disabled' : ''}`} htmlFor="maintenance-image-upload">
                  {maintenance.maintenanceImageUrl ? <img src={maintenance.maintenanceImageUrl} alt="Preview da imagem de manutenção" /> : <span><Clock />Selecionar imagem</span>}
                </label>
                <div className="maintenance-media-actions">
                  {canManage ? <><label className="soft-button" htmlFor="maintenance-image-upload">{uploadingImage ? 'Enviando...' : maintenance.maintenanceImageUrl ? 'Trocar imagem' : 'Selecionar imagem'}</label><input id="maintenance-image-upload" className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadMaintenanceImage(event.target.files?.[0])} disabled={uploadingImage} />{maintenance.maintenanceImageUrl ? <button className="soft-button" type="button" onClick={() => onChange({ ...maintenance, maintenanceImageUrl: '' })}>Remover</button> : null}</> : <span className="panel-note">Imagem em modo somente leitura.</span>}
                </div>
              </div>
              {uploadMessage ? <p className={uploadMessage.includes('Não') ? 'error' : 'panel-note'} role="status">{uploadMessage}</p> : null}
            </section>

            {canManage ? <button className="primary admin-save" type="button" onClick={onSave} disabled={saving || scheduleInvalid}>{saving ? 'Publicando...' : 'Salvar e publicar'}</button> : null}
            {feedback ? <p className={feedback.includes('sucesso') ? 'success' : 'error'} role="status">{feedback}</p> : null}
          </div>

          <aside className="maintenance-preview enhanced refined-preview">
            <span>Prévia para o visitante</span>
            {maintenance.maintenanceImageUrl ? <img src={maintenance.maintenanceImageUrl} alt="" /> : <Clock className="hero-icon" />}
            <strong>{maintenance.maintenanceTitle}</strong>
            <p>{maintenance.maintenanceMessage}</p>
            <div className="maintenance-preview-meta">
              <small>{mode === 'off' ? 'Portal operacional' : mode === 'scheduled' ? `Início: ${formatClock(maintenance.maintenanceStartAt)}` : 'Início: assim que publicar'}</small>
              <small>{mode === 'off' ? 'A tela de manutenção não será exibida.' : maintenance.maintenanceEndAt ? `Término: ${formatClock(maintenance.maintenanceEndAt)}` : 'Término: até desativação manual'}</small>
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Elemento raiz da aplicação não encontrado.')

createRoot(rootElement).render(<StrictMode>{window.location.pathname.startsWith('/admin/accept-invite') ? <AcceptInvite /> : window.location.pathname.startsWith('/admin') ? <Admin /> : <Portal />}</StrictMode>)
