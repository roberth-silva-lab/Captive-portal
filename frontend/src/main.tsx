import { StrictMode, useEffect, useMemo, useState } from 'react'
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
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  MapPinned,
  Menu,
  Megaphone,
  MonitorCheck,
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
type SessionStatus = { status: string; authorized: boolean; authorizedAt?: string | null; expiresAt?: string | null; serverNow: string; remainingSeconds: number; remainingMinutes: number; totalSeconds: number; warningMessage?: string | null; warningMinutes?: number | null; ssid: string; nextCheckSeconds: number }
type Dashboard = { onlineUsers: number; expiringIn30Minutes: number; expiringIn10Minutes: number; scheduledMaintenances: number; activeNotifications: number; sessionsEndedToday: number; averageSessionSeconds: number; vouchersAvailable: number }
type MaintenanceAdmin = { maintenanceEnabled: boolean; maintenanceActive: boolean; maintenanceScheduled: boolean; maintenanceTitle: string; maintenanceMessage: string; maintenanceStartAt?: string | null; maintenanceEndAt?: string | null; maintenanceImageUrl: string }
type AdminMe = { id: string; email: string; name: string; role: string }
type SiteNode = { name: string; status: string; aps: number; connectedClients: number; sessions: number }
type AdminNotice = Notice & { enabled: boolean; createdAt: string; updatedAt: string }
type AuditEntry = { id: number; actorId: string; event: string; createdAt: string; targetId: string }
type Voucher = { id: string; codeLabel: string; durationMinutes: number; site: string; enabled: boolean; usedCount: number; expiresAt?: string | null }

type Method = 'voucher' | 'cpf' | 'email'
type Stage = 'idle' | 'validating' | 'authorizing' | 'confirming' | 'checking' | 'released' | 'error'
type AdminSection = 'dashboard' | 'visitors' | 'vouchers' | 'notices' | 'maintenance' | 'sites' | 'audit'

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
    site: params.get('site') ?? 'Default',
    redirectUrl: params.get('url') ?? params.get('redirectUrl') ?? 'https://www.gstatic.com/generate_204',
  }
}

const formatClock = (iso?: string | null) => iso ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : 'sem previsao'
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}min ${Math.max(0, seconds % 60).toString().padStart(2, '0')}s`
const formatMinutes = (seconds: number) => `${Math.round(seconds / 60)} min`

function Portal() {
  const params = useMemo(portalParams, [])
  const [settings, setSettings] = useState<PortalSettings | null>(null)
  const [method, setMethod] = useState<Method>('voucher')
  const [identifier, setIdentifier] = useState('')
  const [name, setName] = useState('Visitante')
  const [emailCode, setEmailCode] = useState('')
  const [codeRequested, setCodeRequested] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const [message, setMessage] = useState('')
  const [session, setSession] = useState<SessionStatus | null>(null)

  useEffect(() => {
    api<PortalSettings>(`/api/settings?site=${encodeURIComponent(params.site)}`)
      .then(setSettings)
      .catch((error) => setMessage(error.message))
  }, [params.site])

  useEffect(() => {
    if (!params.clientMac || stage !== 'released') return
    const tick = () => api<SessionStatus>(`/api/session/status?clientMac=${encodeURIComponent(params.clientMac)}`).then(setSession).catch(() => undefined)
    tick()
    const handle = window.setInterval(tick, 30000)
    return () => window.clearInterval(handle)
  }, [params.clientMac, stage])

  const basePayload = { ...params, termsAccepted: accepted }

  const requestEmailCode = async () => {
    setMessage('')
    try {
      await api('/api/auth/email/request-code', { method: 'POST', body: JSON.stringify({ ...basePayload, email: identifier }) })
      setCodeRequested(true)
      setMessage('Codigo enviado para o email informado.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nao foi possivel enviar o codigo.')
    }
  }

  const submit = async () => {
    setStage('validating')
    setMessage('')
    try {
      await wait(220)
      setStage('authorizing')
      const path = method === 'voucher' ? '/api/auth/voucher' : method === 'cpf' ? '/api/auth/cpf' : '/api/auth/email/verify-code'
      const body = method === 'voucher'
        ? { ...basePayload, code: identifier }
        : method === 'cpf'
          ? { ...basePayload, cpf: identifier, name }
          : { ...basePayload, email: identifier, code: emailCode }
      const result = await api<AuthResponse>(path, { method: 'POST', body: JSON.stringify(body) })
      setStage('confirming')
      if (!result.authorized) throw new Error('O UniFi ainda nao confirmou a autorizacao.')
      await wait(220)
      setStage('checking')
      const current = await api<SessionStatus>(`/api/session/status?clientMac=${encodeURIComponent(params.clientMac)}`)
      if (!current.authorized) throw new Error('A sessao ainda nao aparece como autorizada.')
      setSession(current)
      setStage('released')
    } catch (error) {
      setStage('error')
      setMessage(error instanceof Error ? error.message : 'Nao foi possivel liberar o acesso.')
    }
  }

  if (settings?.maintenance.active) return <MaintenanceScreen settings={settings} />

  if (stage === 'released') return <SuccessScreen session={session} redirectUrl={params.redirectUrl} notices={settings?.notifications ?? []} />

  return (
    <main className="portal-shell">
      <section className="panel portal-card">
        <div className="brand"><Wifi aria-hidden="true" /><span>{settings?.establishmentName ?? 'Portal Wi-Fi'}</span></div>
        <h1>Acesso Wi-Fi</h1>
        <p className="muted">Conecte este dispositivo de forma segura na rede {settings?.networkName ?? 'visitante'}.</p>
        <NoticeList notices={settings?.notifications ?? []} />
        <div className="tabs" role="tablist" aria-label="Metodo de acesso">
          <button className={method === 'voucher' ? 'active' : ''} onClick={() => setMethod('voucher')} type="button"><Ticket /> Voucher</button>
          <button className={method === 'cpf' ? 'active' : ''} onClick={() => setMethod('cpf')} type="button"><UserRound /> CPF</button>
          <button className={method === 'email' ? 'active' : ''} onClick={() => setMethod('email')} type="button"><Mail /> Email</button>
        </div>
        {method === 'cpf' ? <label>Nome<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label> : null}
        <label>{method === 'voucher' ? 'Codigo do voucher' : method === 'cpf' ? 'CPF' : 'Email'}<input value={identifier} onChange={(event) => setIdentifier(event.target.value)} inputMode={method === 'cpf' ? 'numeric' : 'text'} autoComplete={method === 'email' ? 'email' : 'off'} /></label>
        {method === 'email' ? <div className="inline-action"><button type="button" onClick={requestEmailCode} disabled={!identifier || !accepted}>Enviar codigo</button><input placeholder="Codigo" value={emailCode} onChange={(event) => setEmailCode(event.target.value)} inputMode="numeric" /></div> : null}
        <label className="check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> Aceito os termos de uso da rede.</label>
        <button className="primary" type="button" disabled={!identifier || !accepted || stage === 'authorizing' || stage === 'checking' || (method === 'email' && (!codeRequested || !emailCode))} onClick={submit}>
          <ShieldCheck /> {stage === 'idle' || stage === 'error' ? 'Liberar acesso' : 'Processando'}
        </button>
        <StageList stage={stage} />
        {message ? <p className={stage === 'error' ? 'error' : 'success'}>{message}</p> : null}
        {params.ssid ? <p className="meta">Rede: {params.ssid}</p> : null}
      </section>
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

function StageList({ stage }: { stage: Stage }) {
  const steps: Array<[Stage, string]> = [['validating', 'Validando dados'], ['authorizing', 'Autorizando no UniFi'], ['confirming', 'Confirmando authorized=true'], ['checking', 'Verificando acesso'], ['released', 'Conexao liberada']]
  const index = steps.findIndex(([id]) => id === stage)
  if (stage === 'idle' || stage === 'error') return null
  return <ol className="stages">{steps.map(([id, label], stepIndex) => <li key={id} className={stepIndex <= index ? 'done' : ''}><CheckCircle2 /> {label}</li>)}</ol>
}

function SuccessScreen({ session, redirectUrl, notices }: { session: SessionStatus | null; redirectUrl: string; notices: Notice[] }) {
  return <main className="portal-shell"><section className="panel success-card"><CheckCircle2 className="hero-icon" /><h1>Conexao liberada</h1><p className="muted">A rede ja pode acessar a Internet. Esta janela pode ser dispensada automaticamente pelo Android ou iOS.</p><NoticeList notices={notices} />{session ? <SessionPanel session={session} /> : null}<a className="primary link" href={redirectUrl || 'https://www.gstatic.com/generate_204'}>Continuar para Internet</a></section></main>
}

function SessionPanel({ session }: { session: SessionStatus }) {
  return <div className="session-box"><div><span>Autorizada em</span><strong>{formatClock(session.authorizedAt)}</strong></div><div><span>Expira em</span><strong>{formatClock(session.expiresAt)}</strong></div><div><span>Tempo total</span><strong>{formatDuration(session.totalSeconds)}</strong></div><div><span>Tempo restante</span><strong>{formatDuration(session.remainingSeconds)}</strong></div>{session.warningMessage ? <p className="warning-line"><AlertTriangle /> {session.warningMessage}</p> : null}</div>
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
  const [visitors, setVisitors] = useState<unknown[]>([])
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<AdminSection>('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [savingMaintenance, setSavingMaintenance] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')

  const load = async () => {
    const [me, dash, maint, siteRows, noticeRows, auditRows, voucherRows, visitorRows] = await Promise.all([
      api<AdminMe>('/api/admin/me'),
      api<Dashboard>('/api/admin/dashboard'),
      api<MaintenanceAdmin>('/api/admin/maintenance'),
      api<SiteNode[]>('/api/admin/sites').catch(() => []),
      api<AdminNotice[]>('/api/admin/notifications').catch(() => []),
      api<AuditEntry[]>('/api/admin/maintenance/audit').catch(() => []),
      api<Voucher[]>('/api/admin/vouchers').catch(() => []),
      api<unknown[]>('/api/admin/users').catch(() => []),
    ])
    setAdmin(me)
    setDashboard(dash)
    setMaintenance(maint)
    setSites(siteRows)
    setNotices(noticeRows)
    setAudit(auditRows)
    setVouchers(voucherRows)
    setVisitors(visitorRows)
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
        {activeSection === 'dashboard' ? <DashboardHome dashboard={dashboard} maintenance={maintenance} sites={sites} notices={notices} audit={audit} /> : null}
        {activeSection === 'visitors' ? <PlaceholderPanel title="Usuarios e visitantes" icon={<UsersRound />} items={visitors} empty="Nenhum visitante listado." /> : null}
        {activeSection === 'vouchers' ? <VoucherPanel vouchers={vouchers} /> : null}
        {activeSection === 'notices' ? <NoticeAdminPanel notices={notices} /> : null}
        {activeSection === 'maintenance' && maintenance ? <MaintenanceAdminPanel maintenance={maintenance} saving={savingMaintenance} feedback={maintenanceMessage} onChange={setMaintenance} onSave={saveMaintenance} /> : null}
        {activeSection === 'sites' ? <SitesPanel sites={sites} /> : null}
        {activeSection === 'audit' ? <AuditPanel audit={audit} /> : null}
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
  const items: Array<{ id?: AdminSection; label: string; icon: JSX.Element; disabled?: boolean }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard /> },
    { label: 'Sessoes', icon: <MonitorCheck />, disabled: true },
    { id: 'visitors', label: 'Usuarios/Visitantes', icon: <UsersRound /> },
    { id: 'vouchers', label: 'Vouchers', icon: <Ticket /> },
    { id: 'notices', label: 'Avisos', icon: <Megaphone /> },
    { id: 'maintenance', label: 'Manutencao', icon: <Clock /> },
    { id: 'sites', label: 'Sites', icon: <MapPinned /> },
    { label: 'Administradores', icon: <UserCog />, disabled: true },
    { id: 'audit', label: 'Auditoria', icon: <History /> },
    { label: 'Configuracoes', icon: <Settings />, disabled: true },
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

function DashboardHome({ dashboard, maintenance, sites, notices, audit }: { dashboard: Dashboard; maintenance: MaintenanceAdmin | null; sites: SiteNode[]; notices: AdminNotice[]; audit: AuditEntry[] }) {
  const activeNotices = notices.filter((notice) => notice.enabled)
  return (
    <div className="admin-content">
      <MetricGrid dashboard={dashboard} />
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

function MetricGrid({ dashboard }: { dashboard: Dashboard }) {
  const metrics = [
    { title: 'Usuarios online', value: dashboard.onlineUsers, icon: <Activity />, description: 'Sessoes autorizadas agora.', state: 'normal' as const },
    { title: 'Expiram em 30 min', value: dashboard.expiringIn30Minutes, icon: <Clock />, description: 'Sessoes proximas do fim.', state: dashboard.expiringIn30Minutes > 0 ? 'warning' as const : 'normal' as const },
    { title: 'Expiram em 10 min', value: dashboard.expiringIn10Minutes, icon: <AlertTriangle />, description: 'Exigem maior atencao.', state: dashboard.expiringIn10Minutes > 0 ? 'critical' as const : 'normal' as const },
    { title: 'Manutencoes agendadas', value: dashboard.scheduledMaintenances, icon: <FileClock />, description: 'Janelas programadas.', state: dashboard.scheduledMaintenances > 0 ? 'warning' as const : 'normal' as const },
    { title: 'Avisos ativos', value: dashboard.activeNotifications, icon: <Megaphone />, description: 'Comunicados visiveis.', state: dashboard.activeNotifications > 0 ? 'warning' as const : 'normal' as const },
    { title: 'Encerradas hoje', value: dashboard.sessionsEndedToday, icon: <CheckCircle2 />, description: 'Sessoes finalizadas no dia.', state: 'normal' as const },
    { title: 'Tempo medio', value: formatMinutes(dashboard.averageSessionSeconds), icon: <Gauge />, description: 'Duracao media registrada.', state: 'normal' as const },
    { title: 'Vouchers disponiveis', value: dashboard.vouchersAvailable, icon: <Ticket />, description: 'Vouchers ativos no portal.', state: dashboard.vouchersAvailable === 0 ? 'warning' as const : 'normal' as const },
  ]
  return <section className="admin-metrics" aria-label="Metricas do dashboard">{metrics.map((metric) => <MetricCard key={metric.title} {...metric} />)}</section>
}

function MetricCard({ title, value, icon, description, state }: { title: string; value: number | string; icon: JSX.Element; description: string; state: 'normal' | 'warning' | 'critical' }) {
  return <article className={`admin-metric ${state}`}><div className="metric-icon">{icon}</div><span>{title}</span><strong>{value}</strong><p>{description}</p></article>
}

function SessionsRecent() {
  return <Panel title="Sessoes recentes" icon={<MonitorCheck />}><EmptyState message="Nenhuma sessao recente." /></Panel>
}

function SitesPanel({ sites, compact = false }: { sites: SiteNode[]; compact?: boolean }) {
  return <Panel title="Status dos sites" icon={<Building2 />} compact={compact}>{sites.length ? <div className="site-list">{sites.map((site) => <article key={site.name} className="site-row"><div><strong>{site.name}</strong><span>{site.status}</span></div><dl><div><dt>APs</dt><dd>{site.aps}</dd></div><div><dt>Clientes</dt><dd>{site.connectedClients}</dd></div><div><dt>Sessoes</dt><dd>{site.sessions}</dd></div></dl></article>)}</div> : <EmptyState message="Nenhum site retornado pela API." />}</Panel>
}

function NoticeAdminPanel({ notices, compact = false }: { notices: AdminNotice[]; compact?: boolean }) {
  return <Panel title="Avisos ativos" icon={<Megaphone />} compact={compact}>{notices.length ? <div className="admin-list">{notices.slice(0, compact ? 4 : 20).map((notice) => <article key={notice.id} className={`admin-list-item ${notice.type.toLowerCase()}`}><div><strong>{notice.title}</strong><span>{notice.site} â€¢ {notice.type}</span></div><p>{notice.message}</p></article>)}</div> : <EmptyState message="Nenhum aviso ativo." />}</Panel>
}

function AuditPanel({ audit, compact = false }: { audit: AuditEntry[]; compact?: boolean }) {
  return <Panel title="Ultimas acoes administrativas" icon={<History />} compact={compact}>{audit.length ? <div className="admin-list">{audit.slice(0, compact ? 5 : 30).map((entry) => <article key={entry.id} className="admin-list-item"><div><strong>{entry.event}</strong><span>{formatClock(entry.createdAt)}</span></div><p>Alvo: {entry.targetId || 'global'}</p></article>)}</div> : <EmptyState message="Nenhuma acao administrativa recente." />}</Panel>
}

function VoucherPanel({ vouchers }: { vouchers: Voucher[] }) {
  return <Panel title="Vouchers" icon={<Ticket />}>{vouchers.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Codigo</th><th>Site</th><th>Duracao</th><th>Uso</th><th>Status</th></tr></thead><tbody>{vouchers.map((voucher) => <tr key={voucher.id}><td>{voucher.codeLabel}</td><td>{voucher.site}</td><td>{voucher.durationMinutes} min</td><td>{voucher.usedCount}</td><td>{voucher.enabled ? 'Ativo' : 'Inativo'}</td></tr>)}</tbody></table></div> : <EmptyState message="Nenhum voucher cadastrado." />}</Panel>
}

function PlaceholderPanel({ title, icon, items, empty }: { title: string; icon: JSX.Element; items: unknown[]; empty: string }) {
  return <div className="admin-content"><Panel title={title} icon={icon}>{items.length ? <p className="muted">{items.length} registros retornados pela API.</p> : <EmptyState message={empty} />}</Panel></div>
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

function Panel({ title, icon, children, compact = false }: { title: string; icon: JSX.Element; children: React.ReactNode; compact?: boolean }) {
  return <section className={`ops-panel ${compact ? 'compact' : ''}`}><div className="panel-title">{icon}<h2>{title}</h2></div>{children}</section>
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty-state"><LockKeyhole /><p>{message}</p></div>
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

createRoot(document.getElementById('root')!).render(<StrictMode>{window.location.pathname.startsWith('/admin') ? <Admin /> : <Portal />}</StrictMode>)
