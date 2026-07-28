import { StrictMode, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  Clock,
  FileClock,
  Gauge,
  History,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  MapPinned,
  Menu,
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
import './styles.css'

type NoticeType = 'INFO' | 'WARNING' | 'MAINTENANCE' | 'CRITICAL'
type Notice = { id: string; type: NoticeType; title: string; message: string; startsAt?: string | null; endsAt?: string | null; site: string }
type Maintenance = { enabled: boolean; active: boolean; scheduled: boolean; title: string; message: string; startsAt?: string | null; endsAt?: string | null; imageUrl: string; visualConfig: Record<string, unknown> }
type PortalSettings = { networkName: string; establishmentName: string; termsText: string; maintenanceMode: boolean; maintenance: Maintenance; notifications: Notice[]; expirationWarningMinutes: number[] }
type AuthResponse = { sessionId: string; authorized: boolean; authorizedAt: string; expiresAt: string; remainingSeconds: number; totalSeconds: number; sessionMinutes: number; nextCheckSeconds: number }
type EmailCodeResponse = { expiresAt: string }
type SessionStatus = { status: string; authorized: boolean; authorizedAt?: string | null; expiresAt?: string | null; serverNow: string; remainingSeconds: number; remainingMinutes: number; totalSeconds: number; warningMessage?: string | null; warningMinutes?: number | null; ssid: string; nextCheckSeconds: number }
type Dashboard = { onlineUsers: number; expiringIn30Minutes: number; expiringIn10Minutes: number; scheduledMaintenances: number; activeNotifications: number; sessionsEndedToday: number; averageSessionSeconds: number; vouchersAvailable: number }
type MaintenanceAdmin = { maintenanceEnabled: boolean; maintenanceActive: boolean; maintenanceScheduled: boolean; maintenanceTitle: string; maintenanceMessage: string; maintenanceStartAt?: string | null; maintenanceEndAt?: string | null; maintenanceImageUrl: string }
type AdminMe = { id: string; email: string; name: string; role: string }
type SiteNode = { name: string; siteId?: string; status: string; aps: number; connectedClients: number; sessions: number }
type AdminNotice = Notice & { enabled: boolean; createdAt: string; updatedAt: string }
type AuditEntry = { id: number; actorId: string; event: string; createdAt: string; targetId: string }
type Voucher = { id: string; codeLabel: string; durationMinutes: number; site: string; enabled: boolean; usedCount: number; expiresAt?: string | null; maxDevices?: number; dataLimitMb?: number | null; isActive?: boolean }
type ClientRow = Record<string, unknown>
type AccessPoint = Record<string, unknown>

type Method = 'voucher' | 'cpf' | 'email'
type Stage = 'idle' | 'validating' | 'authorizing' | 'confirming' | 'checking' | 'released' | 'error'
type AdminSection = 'dashboard' | 'sessions' | 'visitors' | 'vouchers' | 'notices' | 'maintenance' | 'sites' | 'access-points' | 'admins' | 'audit' | 'settings'
type SessionFilter = 'all' | 'online' | 'expiring-30' | 'expiring-10' | 'ended-today'

const csrfToken = () => document.cookie.split('; ').find((item) => item.startsWith('portal_csrf='))?.split('=')[1] ?? ''

const api = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken() ? { 'X-CSRF-Token': csrfToken() } : {}),
      ...(init.headers ?? {}),
    },
    ...init,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail ?? data.message ?? 'Falha na requisicao')
  return data as T
}

const portalParams = () => {
  const params = new URLSearchParams(window.location.search)
  return {
    clientMac: params.get('id') ?? params.get('mac') ?? params.get('clientMac') ?? '',
    apMac: params.get('ap') ?? params.get('apMac') ?? '',
    ssid: params.get('ssid') ?? '',
    site: params.get('site') ?? '',
    redirectUrl: params.get('url') ?? params.get('redirectUrl') ?? 'https://www.gstatic.com/generate_204',
  }
}

const formatClock = (iso?: string | null) => iso ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : 'sem previsao'
const formatMinutes = (seconds: number) => `${Math.round(seconds / 60)} min`
const formatCountdown = (seconds: number) => {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const rest = safe % 60
  return hours > 0 ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}` : `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`
}

const onlyDigits = (value: string) => value.replace(/\D/g, '')
const formatCpf = (value: string) => {
  const digits = onlyDigits(value).slice(0, 11)
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}
const normalizeVoucher = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32)
const displayVoucher = (value: string) => normalizeVoucher(value).replace(/(.{4})/g, '$1-').replace(/-$/, '')
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
const formatPhone = (value: string) => {
  const digits = onlyDigits(value).slice(0, 11)
  if (digits.length <= 10) return digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}
const isCpfComplete = (value: string) => onlyDigits(value).length === 11
const portalInstitutionName = (value?: string) => {
  const name = value?.trim()
  if (!name || name.toLowerCase() === 'gabinete itinerante') return 'Receita Federal'
  return name
}

const textValue = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== '') return String(value)
  }
  return ''
}
const boolValue = (row: Record<string, unknown>, key: string) => row[key] === true || String(row[key]).toLowerCase() === 'true'

function Portal() {
  const params = useMemo(portalParams, [])
  const codeInputRef = useRef<HTMLInputElement | null>(null)
  const [settings, setSettings] = useState<PortalSettings | null>(null)
  const [method, setMethod] = useState<Method>('voucher')
  const [identifier, setIdentifier] = useState('')
  const [name, setName] = useState('Visitante')
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
  const [authMethodUsed, setAuthMethodUsed] = useState<Method>('voucher')
  const [termsOpen, setTermsOpen] = useState(false)
  const [session, setSession] = useState<SessionStatus | null>(null)

  useEffect(() => {
    api<PortalSettings>(`/api/settings?site=${encodeURIComponent(params.site)}`)
      .then(setSettings)
      .catch((error) => {
        setMessage(error.message)
        setMessageTone('error')
      })
  }, [params.site])

  useEffect(() => {
    if (!params.clientMac || stage !== 'released') return
    const tick = () => api<SessionStatus>(`/api/session/status?clientMac=${encodeURIComponent(params.clientMac)}`).then(setSession).catch(() => undefined)
    tick()
    const handle = window.setInterval(tick, 30000)
    return () => window.clearInterval(handle)
  }, [params.clientMac, stage])

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

  const institutionName = portalInstitutionName(settings?.establishmentName)
  const networkName = settings?.networkName || 'rede de visitantes'
  const isBusy = ['validating', 'authorizing', 'confirming', 'checking'].includes(stage)
  const basePayload = { ...params, termsAccepted: accepted }

  const selectMethod = (selected: Method) => {
    setMethod(selected)
    setIdentifier('')
    setEmailCode('')
    setPhone('')
    setCodeRequested(false)
    setEmailExpiresAt(null)
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
      setMessage('E obrigatorio aceitar os termos de uso para continuar.')
      setMessageTone('error')
      return false
    }
    if (method === 'voucher' && normalizeVoucher(identifier).length < 3) {
      setFieldError('identifier')
      setMessage('Informe um voucher valido.')
      setMessageTone('error')
      return false
    }
    if (method === 'cpf' && onlyDigits(identifier).length !== 11) {
      setFieldError('identifier')
      setMessage('Informe um CPF completo no formato 000.000.000-00.')
      setMessageTone('error')
      return false
    }
    if (method === 'email' && !validEmail(identifier)) {
      setFieldError('identifier')
      setMessage('Informe um email valido.')
      setMessageTone('error')
      return false
    }
    if (method === 'email' && (!codeRequested || emailCode.length < 4)) {
      setFieldError('code')
      setMessage(codeRequested ? 'Informe o codigo recebido por email.' : 'Envie o codigo para seu email antes de liberar o acesso.')
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
      setMessage('Aceite os termos de uso antes de solicitar o codigo.')
      setMessageTone('error')
      return
    }
    if (!validEmail(identifier)) {
      setFieldError('identifier')
      setMessage('Informe um email valido para receber o codigo.')
      setMessageTone('error')
      return
    }
    setEmailSending(true)
    try {
      const response = await api<EmailCodeResponse>('/api/auth/email/request-code', { method: 'POST', body: JSON.stringify({ ...basePayload, email: identifier.trim() }) })
      setCodeRequested(true)
      setEmailExpiresAt(response.expiresAt)
      setEmailCooldown(30)
      setMessage('Codigo enviado para seu email. Verifique sua caixa de entrada e spam.')
      setMessageTone('success')
      window.setTimeout(() => codeInputRef.current?.focus(), 80)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nao foi possivel enviar o codigo.')
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
      setMessage('Autorizando este dispositivo na rede...')
      const path = method === 'voucher' ? '/api/auth/voucher' : method === 'cpf' ? '/api/auth/cpf' : '/api/auth/email/verify-code'
      const body = method === 'voucher'
        ? { ...basePayload, code: normalizeVoucher(identifier) }
        : method === 'cpf'
          ? { ...basePayload, cpf: onlyDigits(identifier), name, phone: onlyDigits(phone) || undefined }
          : { ...basePayload, email: identifier.trim(), code: emailCode }
      const result = await api<AuthResponse>(path, { method: 'POST', body: JSON.stringify(body) })
      setStage('confirming')
      if (!result.authorized) throw new Error('O UniFi ainda nao confirmou a autorizacao.')
      await wait(220)
      setStage('checking')
      const current = await api<SessionStatus>(`/api/session/status?clientMac=${encodeURIComponent(params.clientMac)}`)
      if (!current.authorized) throw new Error('A sessao ainda nao aparece como autorizada.')
      setSession(current)
      setAuthMethodUsed(method)
      setMessage(method === 'email' ? 'Email confirmado. Liberando seu acesso...' : 'Acesso liberado com sucesso.')
      setMessageTone('success')
      setStage('released')
    } catch (error) {
      setStage('error')
      setMessage(error instanceof Error ? error.message : 'Nao foi possivel liberar o acesso.')
      setMessageTone('error')
    }
  }

  useEffect(() => {
    if (method === 'email' && codeRequested && emailCode.length === 6 && stage === 'idle' && !emailSending) {
      setMessage('Verificando codigo...')
      setMessageTone('info')
      void submit()
    }
  }, [codeRequested, emailCode, emailSending, method, stage])

  if (settings?.maintenance.active) return <MaintenanceScreen settings={settings} />

  if (stage === 'released') return <SuccessScreen session={session} redirectUrl={params.redirectUrl} notices={settings?.notifications ?? []} method={authMethodUsed} networkName={networkName} />

  return (
    <main className="portal-shell public-portal-shell">
      <section className="panel portal-card public-portal-card" aria-labelledby="portal-title">
        <header className="portal-brand">
          <div className="portal-brand-mark" aria-hidden="true"><ShieldCheck /></div>
          <div>
            <span className="portal-eyebrow">Portal de Acesso Wi-Fi</span>
            <strong>{institutionName}</strong>
            <p>Acesso seguro para visitantes</p>
          </div>
        </header>

        <div className="portal-heading">
          <h1 id="portal-title">Acesso Wi-Fi</h1>
          <p>Conecte este dispositivo com seguranca a {networkName}.</p>
        </div>

        <NoticeList notices={settings?.notifications ?? []} />

        <div className="method-tabs" role="tablist" aria-label="Metodo de acesso">
          <button className={method === 'voucher' ? 'active' : ''} onClick={() => selectMethod('voucher')} type="button"><Ticket /><span>Voucher</span></button>
          <button className={method === 'cpf' ? 'active' : ''} onClick={() => selectMethod('cpf')} type="button"><UserRound /><span>CPF</span></button>
          <button className={method === 'email' ? 'active' : ''} onClick={() => selectMethod('email')} type="button"><Mail /><span>Email</span></button>
        </div>

        <div className="form-stack">
          {method === 'cpf' ? <>
            <label className="field-label" htmlFor="visitor-name"><span>Nome completo</span><input id="visitor-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Seu nome completo" /></label>
            <label className="field-label" htmlFor="visitor-phone"><span>Telefone opcional</span><input id="visitor-phone" value={phone} onChange={(event) => setPhone(formatPhone(event.target.value))} inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" /></label>
          </> : null}

          <label className="field-label" htmlFor="portal-identifier">
            <span>{method === 'voucher' ? 'Voucher' : method === 'cpf' ? 'CPF' : 'Email'}</span>
            <input
              id="portal-identifier"
              className={fieldError === 'identifier' ? 'input-error' : method === 'cpf' && identifier ? isCpfComplete(identifier) ? 'input-valid' : 'input-pending' : method === 'voucher' && identifier ? 'voucher-input' : ''}
              value={identifier}
              onChange={(event) => updateIdentifier(event.target.value)}
              inputMode={method === 'cpf' ? 'numeric' : method === 'email' ? 'email' : 'text'}
              autoComplete={method === 'email' ? 'email' : 'off'}
              placeholder={method === 'voucher' ? 'Digite seu voucher' : method === 'cpf' ? '000.000.000-00' : 'seu.email@exemplo.gov.br'}
            />
            <small className="field-help">{method === 'voucher' ? 'Informe o codigo fornecido pela administracao.' : method === 'cpf' ? 'Digite apenas os numeros; a mascara sera aplicada automaticamente.' : 'Use um email ao qual voce tenha acesso agora.'}</small>
          </label>

          {method === 'email' ? <div className="email-code-panel email-code-flow">
            <button type="button" onClick={requestEmailCode} disabled={emailSending || emailCooldown > 0 || isBusy}>{emailSending ? 'Enviando codigo...' : emailCooldown > 0 ? `Reenviar codigo em ${formatCountdown(emailCooldown)}` : codeRequested ? 'Reenviar codigo' : 'Enviar codigo'}</button>
            {codeRequested ? <div className="email-sent-card"><CheckCircle2 /><div><strong>Codigo enviado</strong><p>Enviamos um codigo de 6 digitos para:<br />{identifier.trim()}</p><small>Expira em {formatCountdown(emailRemaining)}. Verifique tambem sua pasta de spam.</small></div></div> : null}
            <label className="field-label compact code-field" htmlFor="email-code"><span>Codigo recebido</span><input ref={codeInputRef} id="email-code" className={fieldError === 'code' ? 'code-input input-error highlight' : emailCode ? 'code-input highlight' : 'code-input'} placeholder="000000" value={emailCode} onChange={(event) => { setFieldError(''); setStage('idle'); setEmailCode(onlyDigits(event.target.value).slice(0, 6)) }} inputMode="numeric" autoComplete="one-time-code" /><div className="otp-slots" aria-hidden="true">{Array.from({ length: 6 }).map((_, index) => <span key={index} className={emailCode[index] ? 'filled' : ''}>{emailCode[index] ?? ''}</span>)}</div></label>
          </div> : null}

          <div className={`terms-row ${fieldError === 'terms' ? 'terms-error' : ''}`}>
            <label className="check"><input type="checkbox" checked={accepted} onChange={(event) => { setAccepted(event.target.checked); setFieldError('') }} /> Li e aceito os <button className="terms-inline-link" type="button" onClick={(event) => { event.preventDefault(); setTermsOpen(true) }}>Termos de Uso</button>.</label>
          </div>

          <button className="primary portal-primary" type="button" disabled={isBusy || !identifier || (method === 'email' && (!codeRequested || !emailCode))} onClick={submit}>
            <ShieldCheck /> {isBusy ? 'Liberando acesso...' : 'Liberar acesso'}
          </button>
        </div>

        <StageList stage={stage} />
        {message ? <p className={`feedback ${messageTone}`} role="status">{message}</p> : null}
        <div className="portal-footer-info">
          <span className="network-chip"><Wifi /> {params.ssid || networkName}</span>
          <small>Ambiente institucional protegido</small>
        </div>
      </section>
      {termsOpen ? <TermsModal text={settings?.termsText} onClose={() => setTermsOpen(false)} onAccept={() => { setAccepted(true); setFieldError(''); setTermsOpen(false) }} /> : null}
    </main>
  )
}

function MaintenanceScreen({ settings }: { settings: PortalSettings }) {
  const item = settings.maintenance
  return <main className="portal-shell maintenance"><section className="panel maintenance-card">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <Clock className="hero-icon" />}<h1>{item.title}</h1><p>{item.message}</p>{item.endsAt ? <p className="meta">Previsao de retorno: {formatClock(item.endsAt)}</p> : null}</section></main>
}

function NoticeList({ notices }: { notices: Notice[] }) {
  if (!notices.length) return null
  return <div className="notices">{notices.map((notice) => <article key={notice.id} className={`notice ${notice.type.toLowerCase()}`}><Bell /><div><strong>{notice.title}</strong><p>{notice.message}</p>{notice.startsAt ? <small>Inicio: {formatClock(notice.startsAt)}</small> : null}</div></article>)}</div>
}

function TermsModal({ text, onClose, onAccept }: { text?: string; onClose: () => void; onAccept: () => void }) {
  return (
    <div className="terms-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="terms-modal" role="dialog" aria-modal="true" aria-labelledby="terms-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="terms-modal-head">
          <div><span>Termos da rede</span><h2 id="terms-title">Termos de uso</h2></div>
          <button type="button" aria-label="Fechar termos" onClick={onClose}><X /></button>
        </div>
        <div className="terms-scroll"><p>{text || 'Ao continuar, voce declara ciencia e aceite das regras de uso da rede de visitantes.'}</p></div>
        <div className="terms-actions"><button className="terms-secondary" type="button" onClick={onClose}>Fechar</button><button className="primary terms-close" type="button" onClick={onAccept}>Li e aceito os termos</button></div>
      </section>
    </div>
  )
}

function StageList({ stage }: { stage: Stage }) {
  const steps: Array<[Stage, string]> = [['validating', 'Validando dados'], ['authorizing', 'Autorizando no UniFi'], ['confirming', 'Confirmando authorized=true'], ['checking', 'Verificando acesso'], ['released', 'Conexao liberada']]
  const index = steps.findIndex(([id]) => id === stage)
  if (stage === 'idle' || stage === 'error') return null
  return <ol className="stages">{steps.map(([id, label], stepIndex) => <li key={id} className={stepIndex <= index ? 'done' : ''}><CheckCircle2 /> {label}</li>)}</ol>
}

function SuccessScreen({ session, redirectUrl, notices, method, networkName }: { session: SessionStatus | null; redirectUrl: string; notices: Notice[]; method: Method; networkName: string }) {
  return <main className="portal-shell public-portal-shell"><section className="panel success-card public-success-card"><CheckCircle2 className="hero-icon" /><h1>Acesso liberado</h1><p className="muted">Voce ja pode navegar na Internet. Esta janela pode ser dispensada automaticamente pelo Android ou iOS.</p><NoticeList notices={notices} />{session ? <SessionPanel session={session} method={method} networkName={networkName} /> : null}<a className="primary link" href={redirectUrl || 'https://www.gstatic.com/generate_204'}>Continuar para Internet</a></section></main>
}

function SessionPanel({ session, method, networkName }: { session: SessionStatus; method: Method; networkName: string }) {
  const [remaining, setRemaining] = useState(session.remainingSeconds)
  useEffect(() => {
    setRemaining(session.remainingSeconds)
    const handle = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(handle)
  }, [session.remainingSeconds])
  return <div className="session-box success-session-box"><div><span>Rede</span><strong>{session.ssid || networkName}</strong></div><div><span>Metodo usado</span><strong>{method === 'cpf' ? 'CPF' : method === 'email' ? 'Email' : 'Voucher'}</strong></div><div><span>Autorizada em</span><strong>{formatClock(session.authorizedAt)}</strong></div><div><span>Tempo restante</span><strong>{formatCountdown(remaining)}</strong></div>{remaining <= 600 && remaining > 0 ? <p className="warning-line"><AlertTriangle /> Seu acesso termina em {Math.ceil(remaining / 60)} minutos.</p> : null}{session.warningMessage ? <p className="warning-line"><AlertTriangle /> {session.warningMessage}</p> : null}</div>
}

function Admin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [admin, setAdmin] = useState<AdminMe | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [maintenance, setMaintenance] = useState<MaintenanceAdmin | null>(null)
  const [sites, setSites] = useState<SiteNode[]>([])
  const [notices, setNotices] = useState<AdminNotice[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [visitors, setVisitors] = useState<ClientRow[]>([])
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([])
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all')
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<AdminSection>('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [savingMaintenance, setSavingMaintenance] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')

  const load = async () => {
    const [me, dash, maint, siteRows, noticeRows, auditRows, voucherRows, visitorRows, accessPointRows] = await Promise.all([
      api<AdminMe>('/api/admin/me'),
      api<Dashboard>('/api/admin/dashboard'),
      api<MaintenanceAdmin>('/api/admin/maintenance'),
      api<SiteNode[]>('/api/admin/sites').catch(() => []),
      api<AdminNotice[]>('/api/admin/notifications').catch(() => []),
      api<AuditEntry[]>('/api/admin/maintenance/audit').catch(() => []),
      api<Voucher[]>('/api/admin/vouchers').catch(() => []),
      api<ClientRow[]>('/api/admin/users').catch(() => []),
      api<AccessPoint[]>('/api/admin/access-points').catch(() => []),
    ])
    setAdmin(me)
    setDashboard(dash)
    setMaintenance(maint)
    setSites(siteRows)
    setNotices(noticeRows)
    setAudit(auditRows)
    setVouchers(voucherRows)
    setVisitors(visitorRows)
    setAccessPoints(accessPointRows)
  }

  useEffect(() => { void load().catch(() => setDashboard(null)) }, [])

  const login = async () => {
    setError('')
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login')
    }
  }

  const logout = async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => undefined)
    setDashboard(null)
    setAdmin(null)
  }

  const saveMaintenance = async () => {
    if (!maintenance) return
    setSavingMaintenance(true)
    setMaintenanceMessage('')
    try {
      const updated = await api<MaintenanceAdmin>('/api/admin/maintenance', { method: 'PUT', body: JSON.stringify(maintenance) })
      setMaintenance(updated)
      setMaintenanceMessage('Alteracoes salvas com sucesso.')
      await load().catch(() => undefined)
    } catch (err) {
      setMaintenanceMessage(err instanceof Error ? err.message : 'Nao foi possivel salvar as alteracoes.')
    } finally {
      setSavingMaintenance(false)
    }
  }

  if (!dashboard) {
    return <AdminLogin email={email} password={password} error={error} onEmail={setEmail} onPassword={setPassword} onLogin={login} />
  }

  return (
    <main className="admin-app">
      <AdminSidebar active={activeSection} open={menuOpen} onClose={() => setMenuOpen(false)} onSelect={(section) => { setActiveSection(section); setMenuOpen(false) }} />
      <section className="admin-main" aria-label="Conteudo administrativo">
        <AdminHeader admin={admin} maintenance={maintenance} onLogout={logout} onMenu={() => setMenuOpen(true)} />
        {activeSection === 'dashboard' ? <DashboardHome dashboard={dashboard} maintenance={maintenance} sites={sites} notices={notices} audit={audit} onSelect={(section, filter) => { setActiveSection(section); if (filter) setSessionFilter(filter) }} /> : null}
        {activeSection === 'sessions' ? <SessionsPage filter={sessionFilter} onFilter={setSessionFilter} /> : null}
        {activeSection === 'visitors' ? <VisitorsPanel visitors={visitors} /> : null}
        {activeSection === 'vouchers' ? <VoucherPanel vouchers={vouchers} /> : null}
        {activeSection === 'notices' ? <NoticeAdminPanel notices={notices} /> : null}
        {activeSection === 'maintenance' && maintenance ? <MaintenanceAdminPanel maintenance={maintenance} saving={savingMaintenance} feedback={maintenanceMessage} onChange={setMaintenance} onSave={saveMaintenance} /> : null}
        {activeSection === 'sites' ? <SitesPanel sites={sites} /> : null}
        {activeSection === 'access-points' ? <AccessPointsPanel accessPoints={accessPoints} /> : null}
        {activeSection === 'admins' ? <AdminsPanel admin={admin} /> : null}
        {activeSection === 'audit' ? <AuditPanel audit={audit} /> : null}
        {activeSection === 'settings' ? <SettingsPanel admin={admin} maintenance={maintenance} /> : null}
      </section>
    </main>
  )
}

function AdminLogin({ email, password, error, onEmail, onPassword, onLogin }: { email: string; password: string; error: string; onEmail: (value: string) => void; onPassword: (value: string) => void; onLogin: () => void }) {
  return (
    <main className="portal-shell admin-login-shell">
      <section className="panel admin-card" aria-labelledby="admin-login-title">
        <div className="brand"><ShieldCheck aria-hidden="true" /><span>Portal administrativo</span></div>
        <h1 id="admin-login-title">Acesso administrativo</h1>
        <p className="muted">Entre para acompanhar acessos, avisos, vouchers e manutencoes do portal.</p>
        <label htmlFor="admin-email">Email<input id="admin-email" value={email} onChange={(event) => onEmail(event.target.value)} autoComplete="email" /></label>
        <label htmlFor="admin-password">Senha<input id="admin-password" value={password} onChange={(event) => onPassword(event.target.value)} type="password" autoComplete="current-password" /></label>
        <button className="primary" onClick={onLogin} type="button">Entrar</button>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>
    </main>
  )
}

function AdminSidebar({ active, open, onClose, onSelect }: { active: AdminSection; open: boolean; onClose: () => void; onSelect: (section: AdminSection) => void }) {
  const items: Array<{ id?: AdminSection; label: string; icon: ReactNode; disabled?: boolean }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard /> },
    { id: 'sessions', label: 'Sessoes', icon: <MonitorCheck /> },
    { id: 'visitors', label: 'Usuarios/Visitantes', icon: <UsersRound /> },
    { id: 'vouchers', label: 'Vouchers', icon: <Ticket /> },
    { id: 'notices', label: 'Avisos', icon: <Megaphone /> },
    { id: 'maintenance', label: 'Manutencao', icon: <Clock /> },
    { id: 'sites', label: 'Sites', icon: <MapPinned /> },
    { id: 'access-points', label: 'Access Points', icon: <Radio /> },
    { id: 'admins', label: 'Administradores', icon: <UserCog /> },
    { id: 'audit', label: 'Auditoria', icon: <History /> },
    { id: 'settings', label: 'Configuracoes', icon: <Settings /> },
  ]
  return (
    <>
      <aside className={`admin-sidebar ${open ? 'open' : ''}`} aria-label="Navegacao administrativa">
        <div className="sidebar-brand"><div className="brand-mark"><Wifi /></div><div><strong>Captive Portal</strong><span>Operacao Wi-Fi</span></div></div>
        <button className="sidebar-close" type="button" aria-label="Fechar menu" onClick={onClose}><X /></button>
        <nav className="sidebar-nav">
          {items.map((item) => item.disabled || !item.id
            ? <button key={item.label} className="nav-item disabled" type="button" disabled aria-label={`${item.label} indisponivel`}>{item.icon}<span>{item.label}</span></button>
            : <button key={item.id} className={`nav-item ${active === item.id ? 'active' : ''}`} type="button" onClick={() => onSelect(item.id)} aria-current={active === item.id ? 'page' : undefined}>{item.icon}<span>{item.label}</span></button>)}
        </nav>
      </aside>
      {open ? <button className="sidebar-backdrop" type="button" aria-label="Fechar menu" onClick={onClose} /> : null}
    </>
  )
}

function AdminHeader({ admin, maintenance, onLogout, onMenu }: { admin: AdminMe | null; maintenance: MaintenanceAdmin | null; onLogout: () => void; onMenu: () => void }) {
  const isMaintenance = maintenance?.maintenanceActive
  return (
    <header className="admin-topbar">
      <button className="mobile-menu" type="button" onClick={onMenu} aria-label="Abrir menu administrativo"><Menu /></button>
      <div className="admin-title"><h1>Painel do Portal</h1><p>Visao geral da infraestrutura e dos acessos</p></div>
      <div className="admin-actions">
        <span className={`status-pill ${isMaintenance ? 'warning' : 'ok'}`}><span />{isMaintenance ? 'Manutencao' : 'Operacional'}</span>
        <div className="admin-user" aria-label="Administrador autenticado"><strong>{admin?.name ?? 'Administrador'}</strong><span>{admin?.role ?? 'ADMIN'}</span></div>
        <button className="logout-button" onClick={onLogout} type="button"><LogOut /> Sair</button>
      </div>
    </header>
  )
}

function DashboardHome({ dashboard, maintenance, sites, notices, audit, onSelect }: { dashboard: Dashboard; maintenance: MaintenanceAdmin | null; sites: SiteNode[]; notices: AdminNotice[]; audit: AuditEntry[]; onSelect: (section: AdminSection, filter?: SessionFilter) => void }) {
  const activeNotices = notices.filter((notice) => notice.enabled)
  return (
    <div className="admin-content">
      <MetricGrid dashboard={dashboard} onSelect={onSelect} />
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

function MetricGrid({ dashboard, onSelect }: { dashboard: Dashboard; onSelect: (section: AdminSection, filter?: SessionFilter) => void }) {
  const metrics = [
    { title: 'Usuarios online', value: dashboard.onlineUsers, icon: <Activity />, description: 'Sessoes autorizadas agora.', state: 'normal' as const, section: 'sessions' as const, filter: 'online' as const },
    { title: 'Expiram em 30 min', value: dashboard.expiringIn30Minutes, icon: <Clock />, description: 'Sessoes proximas do fim.', state: dashboard.expiringIn30Minutes > 0 ? 'warning' as const : 'normal' as const, section: 'sessions' as const, filter: 'expiring-30' as const },
    { title: 'Expiram em 10 min', value: dashboard.expiringIn10Minutes, icon: <AlertTriangle />, description: 'Exigem maior atencao.', state: dashboard.expiringIn10Minutes > 0 ? 'critical' as const : 'normal' as const, section: 'sessions' as const, filter: 'expiring-10' as const },
    { title: 'Manutencoes agendadas', value: dashboard.scheduledMaintenances, icon: <FileClock />, description: 'Janelas programadas.', state: dashboard.scheduledMaintenances > 0 ? 'warning' as const : 'normal' as const, section: 'maintenance' as const },
    { title: 'Avisos ativos', value: dashboard.activeNotifications, icon: <Megaphone />, description: 'Comunicados visiveis.', state: dashboard.activeNotifications > 0 ? 'warning' as const : 'normal' as const, section: 'notices' as const },
    { title: 'Encerradas hoje', value: dashboard.sessionsEndedToday, icon: <CheckCircle2 />, description: 'Sessoes finalizadas no dia.', state: 'normal' as const, section: 'sessions' as const, filter: 'ended-today' as const },
    { title: 'Tempo medio', value: formatMinutes(dashboard.averageSessionSeconds), icon: <Gauge />, description: 'Duracao media registrada.', state: 'normal' as const, section: 'sessions' as const },
    { title: 'Vouchers disponiveis', value: dashboard.vouchersAvailable, icon: <Ticket />, description: 'Vouchers ativos no portal.', state: dashboard.vouchersAvailable === 0 ? 'warning' as const : 'normal' as const, section: 'vouchers' as const },
  ]
  return <section className="admin-metrics" aria-label="Metricas do dashboard">{metrics.map((metric) => <MetricCard key={metric.title} {...metric} onOpen={() => onSelect(metric.section, metric.filter)} />)}</section>
}

function MetricCard({ title, value, icon, description, state, onOpen }: { title: string; value: number | string; icon: ReactNode; description: string; state: 'normal' | 'warning' | 'critical'; onOpen: () => void }) {
  return <button className={`admin-metric ${state}`} type="button" onClick={onOpen}><div className="metric-icon">{icon}</div><span>{title}</span><strong>{value}</strong><p>{description}</p></button>
}

function SessionsRecent() {
  return <Panel title="Sessoes recentes" icon={<MonitorCheck />}><EmptyState message="Nenhuma sessao recente." /></Panel>
}

function SitesPanel({ sites, compact = false }: { sites: SiteNode[]; compact?: boolean }) {
  return <Panel title="Status dos sites" icon={<Building2 />} compact={compact}>{sites.length ? <div className="site-list">{sites.map((site) => <article key={site.name} className="site-row"><div><strong>{site.name}</strong><span>{site.status}</span></div><dl><div><dt>APs</dt><dd>{site.aps}</dd></div><div><dt>Clientes</dt><dd>{site.connectedClients}</dd></div><div><dt>Sessoes</dt><dd>{site.sessions}</dd></div></dl></article>)}</div> : <EmptyState message="Nenhum site retornado pela API." />}</Panel>
}

function NoticeAdminPanel({ notices, compact = false }: { notices: AdminNotice[]; compact?: boolean }) {
  return <Panel title="Avisos ativos" icon={<Megaphone />} compact={compact}>{notices.length ? <div className="admin-list">{notices.slice(0, compact ? 4 : 20).map((notice) => <article key={notice.id} className={`admin-list-item ${notice.type.toLowerCase()}`}><div><strong>{notice.title}</strong><span>{notice.site} - {notice.type}</span></div><p>{notice.message}</p></article>)}</div> : <EmptyState message="Nenhum aviso ativo." />}</Panel>
}

function AuditPanel({ audit, compact = false }: { audit: AuditEntry[]; compact?: boolean }) {
  return <Panel title="Ultimas acoes administrativas" icon={<History />} compact={compact}>{audit.length ? <div className="admin-list">{audit.slice(0, compact ? 5 : 30).map((entry) => <article key={entry.id} className="admin-list-item"><div><strong>{entry.event}</strong><span>{formatClock(entry.createdAt)}</span></div><p>Alvo: {entry.targetId || 'global'}</p></article>)}</div> : <EmptyState message="Nenhuma acao administrativa recente." />}</Panel>
}

function VoucherPanel({ vouchers }: { vouchers: Voucher[] }) {
  return <Panel title="Vouchers" icon={<Ticket />}>{vouchers.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Codigo</th><th>Site</th><th>Duracao</th><th>Uso</th><th>Status</th></tr></thead><tbody>{vouchers.map((voucher) => <tr key={voucher.id}><td>{voucher.codeLabel}</td><td>{voucher.site}</td><td>{voucher.durationMinutes} min</td><td>{voucher.usedCount}</td><td>{voucher.enabled ? 'Ativo' : 'Inativo'}</td></tr>)}</tbody></table></div> : <EmptyState message="Nenhum voucher cadastrado." />}</Panel>
}

function SessionsPage({ filter, onFilter }: { filter: SessionFilter; onFilter: (value: SessionFilter) => void }) {
  const labels: Record<SessionFilter, string> = { all: 'Todas', online: 'Online', 'expiring-30': 'Expiram em 30 min', 'expiring-10': 'Expiram em 10 min', 'ended-today': 'Encerradas hoje' }
  return <div className="admin-content"><Panel title="Sessoes" icon={<MonitorCheck />}><div className="segmented" role="tablist" aria-label="Filtro de sessoes">{Object.entries(labels).map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} type="button" onClick={() => onFilter(key as SessionFilter)}>{label}</button>)}</div><EmptyState message="Nenhuma lista detalhada de sessoes foi retornada pela API atual." /></Panel></div>
}

function VisitorsPanel({ visitors }: { visitors: ClientRow[] }) {
  const [query, setQuery] = useState('')
  const [site, setSite] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [selected, setSelected] = useState<ClientRow | null>(null)
  const [ending, setEnding] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState<ClientRow | null>(null)
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
    setEnding(true)
    try {
      await api(`/api/admin/sessions/${encodeURIComponent(sessionId)}/end`, { method: 'POST' })
      setConfirmEnd(null)
      setSelected(null)
      window.location.reload()
    } finally {
      setEnding(false)
    }
  }
  return <div className="admin-content"><Panel title="Usuarios e visitantes" icon={<UsersRound />}><div className="table-toolbar"><input aria-label="Buscar visitante" placeholder="Buscar por nome, MAC observado, IP, SSID, AP..." value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Filtrar por site" value={site} onChange={(event) => setSite(event.target.value)}><option value="ALL">Todos os sites</option>{sites.map((item) => <option key={item} value={item}>{item}</option>)}</select><select aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Todos os status</option><option value="authorized">Autorizado</option><option value="expired">Expirado</option><option value="disconnected">Encerrado</option></select></div>{filtered.length ? <div className="visitor-grid">{filtered.map((row, index) => <button className="visitor-card" key={textValue(row, ['id', 'mac']) || index} type="button" onClick={() => setSelected(row)}><div><strong>{textValue(row, ['name', 'hostname']) || 'Dispositivo sem nome'}</strong><span>{textValue(row, ['siteName']) || 'Site nao informado'} - {textValue(row, ['ssid']) || 'SSID indisponivel'}</span></div><dl><div><dt>MAC observado</dt><dd>{textValue(row, ['mac']) || '-'}</dd></div><div><dt>IP</dt><dd>{textValue(row, ['ip']) || '-'}</dd></div><div><dt>Status</dt><dd>{boolValue(row, 'authorized') ? 'Autorizado' : textValue(row, ['portalStatus', 'status']) || '-'}</dd></div><div><dt>Tempo restante</dt><dd>{row.remainingSeconds ? formatCountdown(Number(row.remainingSeconds)) : '-'}</dd></div></dl></button>)}</div> : <EmptyState message="Nenhum visitante encontrado." />}</Panel>{selected ? <ClientDrawer row={selected} onClose={() => setSelected(null)} onEnd={() => setConfirmEnd(selected)} /> : null}{confirmEnd ? <ConfirmDialog title="Encerrar acesso" message="Esta acao encerra o acesso deste visitante na UniFi. Continuar?" busy={ending} onCancel={() => setConfirmEnd(null)} onConfirm={() => void endAccess(confirmEnd)} /> : null}</div>
}

function ClientDrawer({ row, onClose, onEnd }: { row: ClientRow; onClose: () => void; onEnd: () => void }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label="Informacoes do dispositivo" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span>Informacoes do dispositivo</span><h2>{textValue(row, ['name', 'hostname']) || 'Dispositivo sem nome'}</h2></div><button type="button" aria-label="Fechar" onClick={onClose}><X /></button></div><div className="detail-list"><InfoLine label="MAC observado" value={textValue(row, ['mac'])} /><InfoLine label="IP" value={textValue(row, ['ip'])} /><InfoLine label="Site" value={textValue(row, ['siteName', 'siteId'])} /><InfoLine label="AP" value={textValue(row, ['apMac'])} /><InfoLine label="SSID" value={textValue(row, ['ssid'])} /><InfoLine label="Sinal" value={textValue(row, ['signal'])} /><InfoLine label="Metodo de autenticacao" value={textValue(row, ['authorizationMethod'])} /><InfoLine label="Autorizado em" value={formatClock(textValue(row, ['authorizedAt']))} /><InfoLine label="Expira em" value={formatClock(textValue(row, ['expiresAt']))} /><InfoLine label="Tempo restante" value={row.remainingSeconds ? formatCountdown(Number(row.remainingSeconds)) : ''} /></div>{boolValue(row, 'canEndAccess') ? <button className="danger-button" type="button" onClick={onEnd}>Encerrar acesso</button> : <p className="panel-note">Nenhuma acao UniFi disponivel para este registro.</p>}</aside></div>
}

function AccessPointsPanel({ accessPoints }: { accessPoints: AccessPoint[] }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AccessPoint | null>(null)
  const filtered = accessPoints.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()))
  return <div className="admin-content"><Panel title="Access Points" icon={<Radio />}><div className="table-toolbar"><input aria-label="Buscar access point" placeholder="Buscar por nome, modelo, MAC, IP ou site..." value={query} onChange={(event) => setQuery(event.target.value)} /></div>{filtered.length ? <div className="ap-grid">{filtered.map((ap, index) => <button className="ap-card" key={textValue(ap, ['id', 'mac']) || index} type="button" onClick={() => setSelected(ap)}><div><strong>{textValue(ap, ['name']) || 'AP sem nome'}</strong><span>{textValue(ap, ['model']) || 'Modelo indisponivel'}</span></div><dl><div><dt>MAC</dt><dd>{textValue(ap, ['mac']) || '-'}</dd></div><div><dt>IP</dt><dd>{textValue(ap, ['ip']) || '-'}</dd></div><div><dt>Site</dt><dd>{textValue(ap, ['siteName']) || '-'}</dd></div><div><dt>Clientes</dt><dd>{textValue(ap, ['clientes']) || '-'}</dd></div><div><dt>Canal</dt><dd>{textValue(ap, ['canal']) || '-'}</dd></div><div><dt>Banda</dt><dd>{textValue(ap, ['banda']) || '-'}</dd></div></dl></button>)}</div> : <EmptyState message="Nenhum access point listado pela API atual." />}</Panel>{selected ? <ApDrawer row={selected} onClose={() => setSelected(null)} /> : null}</div>
}

function ApDrawer({ row, onClose }: { row: AccessPoint; onClose: () => void }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label="Detalhes do access point" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span>Access Point</span><h2>{textValue(row, ['name']) || 'AP sem nome'}</h2></div><button type="button" aria-label="Fechar" onClick={onClose}><X /></button></div><div className="detail-list"><InfoLine label="Modelo" value={textValue(row, ['model'])} /><InfoLine label="MAC" value={textValue(row, ['mac'])} /><InfoLine label="IP" value={textValue(row, ['ip'])} /><InfoLine label="Site" value={textValue(row, ['siteName'])} /><InfoLine label="Status" value={textValue(row, ['status'])} /><InfoLine label="Clientes" value={textValue(row, ['clientes'])} /><InfoLine label="Uptime" value={textValue(row, ['uptime'])} /><InfoLine label="Canal" value={textValue(row, ['canal'])} /><InfoLine label="Banda" value={textValue(row, ['banda'])} /></div><p className="panel-note">Reiniciar AP exige endpoint administrativo especifico e confirmacao sensivel; interface preparada, acao nao conectada nesta rodada.</p></aside></div>
}

function InfoLine({ label, value }: { label: string; value?: string }) {
  return <div className="info-line"><span>{label}</span><strong>{value || '-'}</strong></div>
}

function ConfirmDialog({ title, message, busy, onCancel, onConfirm }: { title: string; message: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" role="presentation"><section className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{message}</p><div className="confirm-actions"><button type="button" onClick={onCancel} disabled={busy}>Cancelar</button><button className="danger-button" type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Encerrando...' : 'Encerrar acesso'}</button></div></section></div>
}

function AdminsPanel({ admin }: { admin: AdminMe | null }) {
  return <div className="admin-content"><Panel title="Administradores" icon={<UserCog />}><div className="prepared-grid"><InfoTile title="Administrador atual" value={admin?.name ?? 'Sessao ativa'} detail={admin?.role ?? 'Role carregada pela API'} icon={<ShieldCheck />} /><InfoTile title="Gestao de administradores" value="Preparado" detail="Criacao, edicao e bloqueio exigem endpoint administrativo dedicado." icon={<KeyRound />} /></div></Panel></div>
}

function SettingsPanel({ admin, maintenance }: { admin: AdminMe | null; maintenance: MaintenanceAdmin | null }) {
  return <div className="admin-content"><Panel title="Configuracoes" icon={<Settings />}><div className="prepared-grid"><InfoTile title="Sessao segura" value="HttpOnly" detail="O painel continua usando cookies e CSRF do backend." icon={<LockKeyhole />} /><InfoTile title="Conta" value={admin?.email ?? 'Autenticada'} detail="Dados carregados de /api/admin/me." icon={<UserRound />} /><InfoTile title="Modo manutencao" value={maintenance?.maintenanceEnabled ? 'Ativo' : 'Inativo'} detail="Configuracao real carregada do backend." icon={<Clock />} /></div></Panel></div>
}

function InfoTile({ title, value, detail, icon }: { title: string; value: string; detail: string; icon: ReactNode }) {
  return <article className="info-tile"><div className="metric-icon">{icon}</div><span>{title}</span><strong>{value}</strong><p>{detail}</p></article>
}

function MaintenanceSummary({ maintenance }: { maintenance: MaintenanceAdmin }) {
  return <section className={`maintenance-summary ${maintenance.maintenanceActive ? 'active' : ''}`}><div><strong>{maintenance.maintenanceActive ? 'Portal em manutencao' : 'Portal funcionando normalmente'}</strong><span>{maintenance.maintenanceScheduled ? `Agendada para ${formatClock(maintenance.maintenanceStartAt)}` : 'Sem janela ativa programada.'}</span></div><Clock /></section>
}

function MaintenanceAdminPanel({ maintenance, saving, feedback, onChange, onSave }: { maintenance: MaintenanceAdmin; saving: boolean; feedback: string; onChange: (value: MaintenanceAdmin) => void; onSave: () => void }) {
  return (
    <div className="admin-content">
      <section className="maintenance-editor" aria-labelledby="maintenance-title">
        <div className={`maintenance-status-card ${maintenance.maintenanceEnabled ? 'active' : ''}`}>
          <div><span>Status do portal</span><strong>{maintenance.maintenanceEnabled ? 'Portal em manutencao' : 'Portal funcionando normalmente'}</strong><p>{maintenance.maintenanceScheduled ? `Inicio programado: ${formatClock(maintenance.maintenanceStartAt)}` : 'Alteracoes passam a valer conforme a janela configurada no backend.'}</p></div>
          <label className="switch" htmlFor="maintenance-enabled"><input id="maintenance-enabled" type="checkbox" checked={maintenance.maintenanceEnabled} onChange={(event) => onChange({ ...maintenance, maintenanceEnabled: event.target.checked })} /><span aria-hidden="true" /></label>
        </div>
        <div className="panel-form">
          <div className="section-heading"><h2 id="maintenance-title">Manutencao</h2><p>Controle a mensagem exibida aos visitantes durante indisponibilidade do portal.</p></div>
          <label htmlFor="maintenance-field-title">Titulo<input id="maintenance-field-title" value={maintenance.maintenanceTitle} onChange={(event) => onChange({ ...maintenance, maintenanceTitle: event.target.value })} /></label>
          <label htmlFor="maintenance-field-message">Mensagem<textarea id="maintenance-field-message" value={maintenance.maintenanceMessage} onChange={(event) => onChange({ ...maintenance, maintenanceMessage: event.target.value })} rows={5} /></label>
          <div className="date-grid"><ReadonlyDate label="Inicio" value={maintenance.maintenanceStartAt} /><ReadonlyDate label="Fim" value={maintenance.maintenanceEndAt} /></div>
          <button className="primary admin-save" type="button" onClick={onSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alteracoes'}</button>
          {feedback ? <p className={feedback.includes('sucesso') ? 'success' : 'error'} role="status">{feedback}</p> : null}
        </div>
      </section>
    </div>
  )
}

function ReadonlyDate({ label, value }: { label: string; value?: string | null }) {
  return <div className="readonly-date"><span>{label}</span><strong>{formatClock(value)}</strong></div>
}

function Panel({ title, icon, children, compact = false }: { title: string; icon: ReactNode; children: ReactNode; compact?: boolean }) {
  return <section className={`ops-panel ${compact ? 'compact' : ''}`}><div className="panel-title">{icon}<h2>{title}</h2></div>{children}</section>
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty-state"><LockKeyhole /><p>{message}</p></div>
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

createRoot(document.getElementById('root')!).render(<StrictMode>{window.location.pathname.startsWith('/admin') ? <Admin /> : <Portal />}</StrictMode>)
