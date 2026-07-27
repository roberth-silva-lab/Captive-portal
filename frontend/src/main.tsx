import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertTriangle, Bell, CheckCircle2, Clock, LogOut, Mail, ShieldCheck, Ticket, UserRound, Wifi } from 'lucide-react'
import './styles.css'

type NoticeType = 'INFO' | 'WARNING' | 'MAINTENANCE' | 'CRITICAL'
type Notice = { id: string; type: NoticeType; title: string; message: string; startsAt?: string | null; endsAt?: string | null; site: string }
type Maintenance = { enabled: boolean; active: boolean; scheduled: boolean; title: string; message: string; startsAt?: string | null; endsAt?: string | null; imageUrl: string; visualConfig: Record<string, unknown> }
type PortalSettings = { networkName: string; establishmentName: string; termsText: string; maintenanceMode: boolean; maintenance: Maintenance; notifications: Notice[]; expirationWarningMinutes: number[] }
type AuthResponse = { sessionId: string; authorized: boolean; authorizedAt: string; expiresAt: string; remainingSeconds: number; totalSeconds: number; sessionMinutes: number; nextCheckSeconds: number }
type SessionStatus = { status: string; authorized: boolean; authorizedAt?: string | null; expiresAt?: string | null; serverNow: string; remainingSeconds: number; remainingMinutes: number; totalSeconds: number; warningMessage?: string | null; warningMinutes?: number | null; ssid: string; nextCheckSeconds: number }
type Dashboard = { onlineUsers: number; expiringIn30Minutes: number; expiringIn10Minutes: number; scheduledMaintenances: number; activeNotifications: number; sessionsEndedToday: number; averageSessionSeconds: number; vouchersAvailable: number }
type MaintenanceAdmin = { maintenanceEnabled: boolean; maintenanceActive: boolean; maintenanceScheduled: boolean; maintenanceTitle: string; maintenanceMessage: string; maintenanceStartAt?: string | null; maintenanceEndAt?: string | null; maintenanceImageUrl: string }

type Method = 'voucher' | 'cpf' | 'email'
type Stage = 'idle' | 'validating' | 'authorizing' | 'confirming' | 'checking' | 'released' | 'error'

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
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [maintenance, setMaintenance] = useState<MaintenanceAdmin | null>(null)
  const [error, setError] = useState('')

  const load = () => Promise.all([api<Dashboard>('/api/admin/dashboard'), api<MaintenanceAdmin>('/api/admin/maintenance')]).then(([dash, maint]) => { setDashboard(dash); setMaintenance(maint) }).catch(() => setDashboard(null))
  useEffect(() => { void load() }, [])

  const login = async () => { setError(''); try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) }); await load() } catch (err) { setError(err instanceof Error ? err.message : 'Falha no login') } }
  const logout = async () => { await api('/api/admin/logout', { method: 'POST' }).catch(() => undefined); setDashboard(null) }
  const saveMaintenance = async () => { if (!maintenance) return; const updated = await api<MaintenanceAdmin>('/api/admin/maintenance', { method: 'PUT', body: JSON.stringify(maintenance) }); setMaintenance(updated) }

  if (!dashboard) return <main className="portal-shell"><section className="panel admin-card"><h1>Administracao</h1><label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Senha<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" /></label><button className="primary" onClick={login} type="button">Entrar</button>{error ? <p className="error">{error}</p> : null}</section></main>

  return <main className="admin-shell"><header><h1>Painel do Portal</h1><button onClick={logout} type="button"><LogOut /> Sair</button></header><section className="metrics"><Metric title="Usuarios online" value={dashboard.onlineUsers} /><Metric title="Expiram em 30 min" value={dashboard.expiringIn30Minutes} /><Metric title="Expiram em 10 min" value={dashboard.expiringIn10Minutes} /><Metric title="Manutencoes agendadas" value={dashboard.scheduledMaintenances} /><Metric title="Avisos ativos" value={dashboard.activeNotifications} /><Metric title="Encerradas hoje" value={dashboard.sessionsEndedToday} /><Metric title="Tempo medio" value={`${Math.round(dashboard.averageSessionSeconds / 60)} min`} /><Metric title="Vouchers disponiveis" value={dashboard.vouchersAvailable} /></section>{maintenance ? <section className="panel admin-panel"><h2>Modo manutencao</h2><label className="check"><input type="checkbox" checked={maintenance.maintenanceEnabled} onChange={(e) => setMaintenance({ ...maintenance, maintenanceEnabled: e.target.checked })} /> Ativar manutencao</label><label>Titulo<input value={maintenance.maintenanceTitle} onChange={(e) => setMaintenance({ ...maintenance, maintenanceTitle: e.target.value })} /></label><label>Mensagem<input value={maintenance.maintenanceMessage} onChange={(e) => setMaintenance({ ...maintenance, maintenanceMessage: e.target.value })} /></label><button className="primary" type="button" onClick={saveMaintenance}>Salvar manutencao</button></section> : null}</main>
}

function Metric({ title, value }: { title: string; value: number | string }) {
  return <article className="metric"><span>{title}</span><strong>{value}</strong></article>
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

createRoot(document.getElementById('root')!).render(<StrictMode>{window.location.pathname.startsWith('/admin') ? <Admin /> : <Portal />}</StrictMode>)