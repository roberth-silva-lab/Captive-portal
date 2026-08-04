import { StrictMode, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  AlertTriangle,
  Copy,
  Bell,
  Building2,
  CheckCircle2,
  Clock,
  FileClock,
  Gauge,
  History,
  LockKeyhole,
  Mail,
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
import { api } from './api'
import { AcceptInvite } from './components/accept-invite'
import { AdminHeader, AdminSidebar, MaintenanceSummary, PageHeader } from './components/admin-layout'
import { NoticeAdminPanel } from './components/notices-panel'
import { PublicPortalPreview } from './components/public-portal-preview'
import { VoucherPanel } from './components/vouchers-panel'
import { ConfirmDialog, EmptyState, InfoLine, InfoTile, Panel } from './components/shared'
import type {
  AccessPoint,
  AdminInviteResponse,
  AdminMe,
  AllowedSite,
  AdminNotice,
  AdminSection,
  AdminUserRow,
  AuditEntry,
  AuthResponse,
  ClientRow,
  Dashboard,
  EmailCodeResponse,
  GuestSessionRow,
  MaintenanceAdmin,
  Method,
  PortalAppearance,
  PortalSettings,
  PortalSiteAppearance,
  PreviewDevice,
  PreviewState,
  SessionFilter,
  SessionStatus,
  SiteNode,
  Stage,
  Voucher,
} from './types'
import {
  boolValue,
  cssVars,
  datetimeLocal,
  displayVoucher,
  formatClock,
  formatCountdown,
  formatCpf,
  formatMinutes,
  formatPhone,
  fromDatetimeLocal,
  humanAudit,
  isCpfComplete,
  normalizeVoucher,
  onlyDigits,
  portalInstitutionName,
  portalParams,
  textValue,
  validEmail,
} from './utils'
import './styles.css'

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
    const query = new URLSearchParams({ site: params.site })
    if (params.clientMac) query.set('clientMac', params.clientMac)
    if (params.apMac) query.set('apMac', params.apMac)
    api<PortalSettings>(`/api/settings?${query.toString()}`)
      .then(setSettings)
      .catch((error) => {
        setMessage(error.message)
        setMessageTone('error')
      })
  }, [params.apMac, params.clientMac, params.site])

  useEffect(() => {
    if (!params.clientMac || stage !== 'released') return
    const tick = () => api<SessionStatus>(`/api/session/status?clientMac=${encodeURIComponent(params.clientMac)}`).then((current) => { setSession(current); if (!current.authorized) { setStage('idle'); setMessage(settings?.expiredMessage || 'Sua sessao expirou. Autentique-se novamente para continuar usando o Wi-Fi.'); setMessageTone('error') } }).catch(() => undefined)
    tick()
    const handle = window.setInterval(tick, 30000)
    return () => window.clearInterval(handle)
  }, [params.clientMac, settings?.expiredMessage, stage])

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

  if (stage === 'released') return <SuccessScreen session={session} redirectUrl={params.redirectUrl} notices={settings?.notifications ?? []} method={authMethodUsed} networkName={networkName} settings={settings} />

  return (
    <main className="portal-shell public-portal-shell" style={cssVars(settings)}>
      <section className="panel portal-card public-portal-card" aria-labelledby="portal-title">
        <header className="portal-brand">
          <div className="portal-brand-mark" aria-hidden="true">{settings?.logoUrl ? <img src={settings.logoUrl} alt="" /> : <ShieldCheck />}</div>
          <div>
            <span className="portal-eyebrow">{settings?.bannerText || 'Portal de Acesso Wi-Fi'}</span>
            <strong>{institutionName}</strong>
            <p>{settings?.welcomeText || 'Acesso seguro para visitantes'}</p>
          </div>
        </header>

        <div className="portal-heading">
          <h1 id="portal-title">{settings?.bannerText || 'Acesso Wi-Fi'}</h1>
          <p>{settings?.welcomeText || `Conecte este dispositivo com seguranca a ${networkName}.`}</p>
        </div>

        <NoticeList notices={settings?.notifications ?? []} />

        <div className="method-tabs" role="tablist" aria-label="Método de acesso">
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
  return <main className="portal-shell maintenance" style={cssVars(settings)}><section className="panel maintenance-card">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <Clock className="hero-icon" />}<span className="portal-eyebrow">{settings.establishmentName}</span><h1>{item.title}</h1><p>{item.message}</p>{item.startsAt ? <p className="meta">Início: {formatClock(item.startsAt)}</p> : null}{item.endsAt ? <p className="meta">Previsao de retorno: {formatClock(item.endsAt)}</p> : null}</section></main>
}

function NoticeList({ notices }: { notices: Notice[] }) {
  if (!notices.length) return null
  return <div className="notices">{notices.map((notice) => <article key={notice.id} className={`notice ${notice.type.toLowerCase()}`}><Bell /><div><strong>{notice.title}</strong><p>{notice.message}</p>{notice.startsAt ? <small>Início: {formatClock(notice.startsAt)}</small> : null}</div></article>)}</div>
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
  return <main className="portal-shell public-portal-shell" style={cssVars(settings)}><section className="panel success-card public-success-card"><CheckCircle2 className="hero-icon" /><h1>Acesso liberado</h1><p className="muted">Voce ja pode navegar na Internet. Esta janela pode ser dispensada automaticamente pelo Android ou iOS.</p><NoticeList notices={notices} />{session ? <SessionPanel session={session} method={method} networkName={networkName} /> : null}<a className="primary link" href={redirectUrl || 'https://www.gstatic.com/generate_204'}>Continuar para Internet</a></section></main>
}

function SessionPanel({ session, method, networkName }: { session: SessionStatus; method: Method; networkName: string }) {
  const [remaining, setRemaining] = useState(session.remainingSeconds)
  useEffect(() => {
    setRemaining(session.remainingSeconds)
    const handle = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(handle)
  }, [session.remainingSeconds])
  return <div className="session-box success-session-box"><div><span>Rede</span><strong>{session.ssid || networkName}</strong></div><div><span>Método usado</span><strong>{method === 'cpf' ? 'CPF' : method === 'email' ? 'Email' : 'Voucher'}</strong></div><div><span>Autorizada em</span><strong>{formatClock(session.authorizedAt)}</strong></div><div><span>Tempo restante</span><strong>{formatCountdown(remaining)}</strong></div>{remaining <= 600 && remaining > 0 ? <p className="warning-line"><AlertTriangle /> Seu acesso termina em {Math.ceil(remaining / 60)} minutos.</p> : null}{session.warningMessage ? <p className="warning-line"><AlertTriangle /> {session.warningMessage}</p> : null}</div>
}

function Admin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [admin, setAdmin] = useState<AdminMe | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [maintenance, setMaintenance] = useState<MaintenanceAdmin | null>(null)
  const [appearance, setAppearance] = useState<PortalAppearance | null>(null)
  const [siteAppearance, setSiteAppearance] = useState<PortalSiteAppearance | null>(null)
  const [sites, setSites] = useState<SiteNode[]>([])
  const [allowedSites, setAllowedSites] = useState<AllowedSite[]>([])
  const [selectedSiteId, setSelectedSiteId] = useState(() => window.localStorage.getItem('admin_selected_site_id') || 'ALL')
  const [notices, setNotices] = useState<AdminNotice[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [visitors, setVisitors] = useState<ClientRow[]>([])
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([])
  const [sessions, setSessions] = useState<GuestSessionRow[]>([])
  const [admins, setAdmins] = useState<AdminUserRow[]>([])
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all')
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<AdminSection>(() => window.location.pathname.startsWith('/admin/sites/') ? 'site-detail' : 'dashboard')
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
  const loadInFlight = useRef(false)
  const scopedPath = (path: string) => selectedSiteId === 'ALL' ? path : `${path}?siteId=${encodeURIComponent(selectedSiteId)}`
  const handleSiteChange = (siteId: string) => {
    window.localStorage.setItem('admin_selected_site_id', siteId)
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
      const [me, allowedSiteRows, dash, maint, appearanceRow, selectedAppearanceRow, siteRows, noticeRows, auditRows, voucherRows, visitorRows, accessPointRows, sessionRows, adminRows] = await Promise.all([
        api<AdminMe>('/api/admin/me'),
        api<AllowedSite[]>('/api/admin/sites/allowed').catch(() => []),
        api<Dashboard>(scopedPath('/api/admin/dashboard')),
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
      ])
    setAdmin(me)
    setAllowedSites(allowedSiteRows)
    const canUseAll = me.canSelectAllSites || me.siteIds.length > 1
    if (allowedSiteRows.length && selectedSiteId !== 'ALL' && !allowedSiteRows.some((site) => site.siteId === selectedSiteId)) handleSiteChange(canUseAll ? 'ALL' : allowedSiteRows[0].siteId)
    if (!canUseAll && selectedSiteId === 'ALL' && allowedSiteRows.length === 1) handleSiteChange(allowedSiteRows[0].siteId)
    setDashboard(dash)
    setMaintenance(maint)
    setAppearance(appearanceRow)
    setSiteAppearance(selectedAppearanceRow)
    setSites(siteRows)
    setNotices(noticeRows)
    setAudit(auditRows)
    setVouchers(voucherRows)
    setVisitors(visitorRows)
    setAccessPoints(accessPointRows)
    setSessions(sessionRows)
      setAdmins(adminRows)
      setLastUpdatedAt(new Date())
      setRefreshError('')
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Não foi possível atualizar agora.')
      throw err
    } finally {
      setRefreshing(false)
      loadInFlight.current = false
    }
  }

  useEffect(() => { void load().catch(() => setDashboard(null)) }, [])
  useEffect(() => { if (admin) void load().catch(() => undefined) }, [selectedSiteId])
  useEffect(() => {
    if (!dashboard) return undefined
    const intervalMs = activeSection === 'visitors' ? 5000 : 10000
    const tick = () => {
      if (document.hidden || loadInFlight.current) return
      void load().catch(() => undefined)
    }
    const handle = window.setInterval(tick, intervalMs)
    const onVisibility = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(handle)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [activeSection, dashboard])

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
    setAllowedSites([])
    setSiteAppearance(null)
  }

  const endAdminSession = async (sessionId: string) => {
    setSessionActionBusy(true)
    setSessionActionMessage('')
    try {
      await api('/api/admin/sessions/' + encodeURIComponent(sessionId) + '/end', { method: 'POST' })
      setSessionActionMessage('Acesso encerrado com sucesso.')
      await load().catch(() => undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nao foi possivel encerrar o acesso.'
      setSessionActionMessage(message)
      throw new Error(message, { cause: err })
    } finally {
      setSessionActionBusy(false)
    }
  }


  const resetSiteAppearance = async () => {
    if (selectedSiteId === 'ALL') return
    setAppearanceSaving(true)
    setAppearanceMessage('')
    try {
      await api(`/api/admin/portal-appearance/site/${encodeURIComponent(selectedSiteId)}`, { method: 'DELETE' })
      setAppearanceMessage('Visual da unidade voltou a usar a configuração global.')
      await load().catch(() => undefined)
    } catch (err) {
      setAppearanceMessage(err instanceof Error ? err.message : 'Nao foi possivel remover o visual da unidade.')
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
      } else {
        const updated = await api<PortalAppearance>('/api/admin/portal-appearance', { method: 'PUT', body: JSON.stringify(appearance) })
        setAppearance(updated)
        setAppearanceMessage('Visual e termos globais salvos com sucesso.')
      }
      await load().catch(() => undefined)
    } catch (err) {
      setAppearanceMessage(err instanceof Error ? err.message : 'Nao foi possivel salvar o visual do portal.')
    } finally {
      setAppearanceSaving(false)
    }
  }
  const saveMaintenance = async () => {
    if (!maintenance) return
    setSavingMaintenance(true)
    setMaintenanceMessage('')
    try {
      const updated = await api<MaintenanceAdmin>(scopedPath('/api/admin/maintenance'), { method: 'PUT', body: JSON.stringify(maintenance) })
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
      <AdminSidebar active={activeSection} open={menuOpen} onClose={() => setMenuOpen(false)} onSelect={(section) => { setActiveSection(section); setMenuOpen(false); if (section !== 'site-detail') window.history.pushState(null, '', section === 'sites' ? '/admin/sites' : '/admin') }} />
      <section className="admin-main" aria-label="Conteudo administrativo">
        <AdminHeader admin={admin} maintenance={maintenance} refreshing={refreshing} lastUpdatedAt={lastUpdatedAt} refreshError={refreshError} allowedSites={allowedSites} selectedSiteId={selectedSiteId} onSiteChange={handleSiteChange} onLogout={logout} onMenu={() => setMenuOpen(true)} />
        {activeSection === 'dashboard' ? <DashboardHome dashboard={dashboard} maintenance={maintenance} sites={sites} notices={notices} vouchers={vouchers} audit={audit} onSelect={(section, filter) => { setActiveSection(section); if (filter) setSessionFilter(filter) }} /> : null}
        {activeSection === 'sessions' ? <SessionsPage sessions={sessions} sites={sites} filter={sessionFilter} busy={sessionActionBusy} feedback={sessionActionMessage} onFilter={setSessionFilter} onEndSession={endAdminSession} /> : null}
        {activeSection === 'visitors' ? <VisitorsPanel visitors={visitors} busy={sessionActionBusy} onEndSession={endAdminSession} /> : null}
        {activeSection === 'vouchers' ? <VoucherPanel vouchers={vouchers} allowedSites={allowedSites} selectedSiteId={selectedSiteId} onChanged={load} /> : null}
        {activeSection === 'notices' ? <NoticeAdminPanel notices={notices} allowedSites={allowedSites} selectedSiteId={selectedSiteId} canSelectAllSites={Boolean(admin?.canSelectAllSites)} onChanged={load} /> : null}
        {activeSection === 'maintenance' && maintenance ? <MaintenanceAdminPanel maintenance={maintenance} saving={savingMaintenance} feedback={maintenanceMessage} onChange={setMaintenance} onSave={saveMaintenance} /> : null}
        {activeSection === 'sites' ? <SitesPanel sites={sites} onOpen={openSiteDetail} /> : null}
        {activeSection === 'site-detail' ? <SiteDetailPanel siteId={detailSiteId || selectedSiteId} sites={sites} visitors={visitors} sessions={sessions} accessPoints={accessPoints} vouchers={vouchers} notices={notices} maintenance={maintenance} onBack={leaveSiteDetail} onOpenSection={(section) => setActiveSection(section)} /> : null}
        {activeSection === 'access-points' ? <AccessPointsPanel accessPoints={accessPoints} /> : null}
        {activeSection === 'admins' ? <AdminsPanel admin={admin} admins={admins} allowedSites={allowedSites} onChanged={load} /> : null}
        {activeSection === 'audit' ? <AuditPanel audit={audit} /> : null}
        {activeSection === 'settings' && appearance ? <SettingsPanel admin={admin} maintenance={maintenance} appearance={selectedSiteId !== 'ALL' && siteAppearance ? siteAppearance : appearance} allowedSites={allowedSites} selectedSiteId={selectedSiteId} siteAppearance={siteAppearance} notices={notices} saving={appearanceSaving} feedback={appearanceMessage} onChange={(value) => selectedSiteId !== 'ALL' && siteAppearance ? setSiteAppearance({ ...siteAppearance, ...value }) : setAppearance(value)} onSave={saveAppearance} onResetSite={resetSiteAppearance} /> : null}
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





function DashboardHome({ dashboard, maintenance, sites, notices, vouchers, audit, onSelect }: { dashboard: Dashboard; maintenance: MaintenanceAdmin | null; sites: SiteNode[]; notices: AdminNotice[]; vouchers: Voucher[]; audit: AuditEntry[]; onSelect: (section: AdminSection, filter?: SessionFilter) => void }) {
  const activeNotices = notices.filter((notice) => notice.enabled)
  return (
    <div className="admin-content">
      <MetricGrid dashboard={dashboard} onSelect={onSelect} />
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

function SiteBreakdown({ sites, notices, vouchers }: { sites: SiteNode[]; notices: AdminNotice[]; vouchers: Voucher[] }) {
  if (!sites.length) return null
  return <section className="site-breakdown-grid" aria-label="Resumo por site">{sites.map((site) => {
    const siteId = site.siteId || site.name
    const siteNotices = notices.filter((notice) => notice.enabled && (notice.site === siteId || notice.site === site.name || notice.site === 'ALL')).length
    const siteVouchers = vouchers.filter((voucher) => voucher.siteId === siteId || voucher.site === siteId || voucher.siteName === site.name || voucher.site === site.name).length
    return <article className="site-breakdown-card" key={siteId}><div><strong>{site.name}</strong><span>{site.status}</span></div><dl><div><dt>APs</dt><dd>{site.aps}</dd></div><div><dt>Clientes UniFi</dt><dd>{site.connectedClients}</dd></div><div><dt>Sessões</dt><dd>{site.sessions}</dd></div><div><dt>Vouchers</dt><dd>{siteVouchers}</dd></div><div><dt>Avisos</dt><dd>{siteNotices}</dd></div></dl></article>
  })}</section>
}
function MetricGrid({ dashboard, onSelect }: { dashboard: Dashboard; onSelect: (section: AdminSection, filter?: SessionFilter) => void }) {
  const metrics = [
    { title: 'Usuarios online', value: dashboard.onlineUsers, icon: <Activity />, description: 'Sessões autorizadas agora.', state: 'normal' as const, section: 'sessions' as const, filter: 'online' as const },
    { title: 'Expiram em 30 min', value: dashboard.expiringIn30Minutes, icon: <Clock />, description: 'Sessões proximas do fim.', state: dashboard.expiringIn30Minutes > 0 ? 'warning' as const : 'normal' as const, section: 'sessions' as const, filter: 'expiring-30' as const },
    { title: 'Expiram em 10 min', value: dashboard.expiringIn10Minutes, icon: <AlertTriangle />, description: 'Exigem maior atencao.', state: dashboard.expiringIn10Minutes > 0 ? 'critical' as const : 'normal' as const, section: 'sessions' as const, filter: 'expiring-10' as const },
    { title: 'Manutencoes agendadas', value: dashboard.scheduledMaintenances, icon: <FileClock />, description: 'Janelas programadas.', state: dashboard.scheduledMaintenances > 0 ? 'warning' as const : 'normal' as const, section: 'maintenance' as const },
    { title: 'Avisos ativos', value: dashboard.activeNotifications, icon: <Megaphone />, description: 'Comunicados visiveis.', state: dashboard.activeNotifications > 0 ? 'warning' as const : 'normal' as const, section: 'notices' as const },
    { title: 'Encerradas hoje', value: dashboard.sessionsEndedToday, icon: <CheckCircle2 />, description: 'Sessões finalizadas no dia.', state: 'normal' as const, section: 'sessions' as const, filter: 'ended-today' as const },
    { title: 'Tempo medio', value: formatMinutes(dashboard.averageSessionSeconds), icon: <Gauge />, description: 'Duracao media registrada.', state: 'normal' as const, section: 'sessions' as const },
    { title: 'Vouchers disponiveis', value: dashboard.vouchersAvailable, icon: <Ticket />, description: 'Vouchers ativos no portal.', state: dashboard.vouchersAvailable === 0 ? 'warning' as const : 'normal' as const, section: 'vouchers' as const },
  ]
  return <section className="admin-metrics" aria-label="Metricas do dashboard">{metrics.map((metric) => <MetricCard key={metric.title} {...metric} onOpen={() => onSelect(metric.section, metric.filter)} />)}</section>
}

function MetricCard({ title, value, icon, description, state, onOpen }: { title: string; value: number | string; icon: ReactNode; description: string; state: 'normal' | 'warning' | 'critical'; onOpen: () => void }) {
  return <button className={`admin-metric ${state}`} type="button" onClick={onOpen}><div className="metric-icon">{icon}</div><span>{title}</span><strong>{value}</strong><p>{description}</p></button>
}

function SessionsRecent() {
  return <Panel title="Sessões recentes" icon={<MonitorCheck />}><EmptyState message="Nenhuma sessao recente." /></Panel>
}

function SitesPanel({ sites, compact = false, onOpen }: { sites: SiteNode[]; compact?: boolean; onOpen?: (siteId: string) => void }) {
  return <Panel title="Status dos sites" icon={<Building2 />} compact={compact}>{sites.length ? <div className="site-list">{sites.map((site) => {
    const content = <><div><strong>{site.name}</strong><span>{site.status}</span></div><dl><div><dt>APs</dt><dd>{site.aps}</dd></div><div><dt>Clientes</dt><dd>{site.connectedClients}</dd></div><div><dt>Sessões</dt><dd>{site.sessions}</dd></div></dl></>
    return onOpen && site.siteId ? <button key={site.siteId || site.name} className="site-row clickable" type="button" onClick={() => onOpen(site.siteId || site.name)}>{content}</button> : <article key={site.siteId || site.name} className="site-row">{content}</article>
  })}</div> : <EmptyState message="Nenhum site retornado pela API." />}</Panel>
}

function SiteDetailPanel({ siteId, sites, visitors, sessions, accessPoints, vouchers, notices, maintenance, onBack, onOpenSection }: { siteId: string; sites: SiteNode[]; visitors: ClientRow[]; sessions: GuestSessionRow[]; accessPoints: AccessPoint[]; vouchers: Voucher[]; notices: AdminNotice[]; maintenance: MaintenanceAdmin | null; onBack: () => void; onOpenSection: (section: AdminSection) => void }) {
  const site = sites.find((row) => row.siteId === siteId || row.name === siteId)
  const siteName = site?.name || siteId || 'Site'
  const siteSessions = sessions.filter((session) => session.site === siteId || session.site === siteName)
  const siteVisitors = visitors.filter((row) => textValue(row, ['siteId']) === siteId || textValue(row, ['siteName']) === siteName)
  const siteAps = accessPoints.filter((row) => textValue(row, ['siteId']) === siteId || textValue(row, ['siteName']) === siteName)
  const siteVouchers = vouchers.filter((voucher) => voucher.siteId === siteId || voucher.site === siteId || voucher.siteName === siteName || voucher.site === siteName)
  const siteNotices = notices.filter((notice) => notice.site === 'ALL' || notice.site === siteId || notice.site === siteName)
  const authorized = siteSessions.filter((session) => session.status === 'authorized' && session.remainingSeconds > 0).length
  const expiring = siteSessions.filter((session) => session.status === 'authorized' && session.remainingSeconds > 0 && session.remainingSeconds <= 1800).length
  return <div className="admin-content"><PageHeader title={siteName} description="Resumo operacional da unidade selecionada." action={<button className="soft-button" type="button" onClick={onBack}>Voltar para sites</button>} /><section className="site-detail-grid"><InfoTile title="APs" value={site?.aps ?? siteAps.length} detail="Access Points retornados pela UniFi para este site." icon={<Radio />} /><InfoTile title="Clientes UniFi" value={site?.connectedClients ?? siteVisitors.length} detail="Clientes conectados observados no UniFi." icon={<Wifi />} /><InfoTile title="Sessões autorizadas" value={authorized} detail="Sessões ainda válidas no captive portal." icon={<MonitorCheck />} /><InfoTile title="Expiram em 30 min" value={expiring} detail="Acessos próximos do fim." icon={<Clock />} /></section><section className="site-detail-actions"><button className="soft-button" type="button" onClick={() => onOpenSection('visitors')}>Ver clientes</button><button className="soft-button" type="button" onClick={() => onOpenSection('sessions')}>Ver sessões</button><button className="soft-button" type="button" onClick={() => onOpenSection('access-points')}>Ver APs</button><button className="soft-button" type="button" onClick={() => onOpenSection('vouchers')}>Ver vouchers</button><button className="soft-button" type="button" onClick={() => onOpenSection('notices')}>Ver avisos</button><button className="soft-button" type="button" onClick={() => onOpenSection('maintenance')}>Manutenção</button></section><section className="ops-grid"><Panel title="Sessões recentes" icon={<MonitorCheck />} compact>{siteSessions.slice(0, 5).length ? <div className="admin-list">{siteSessions.slice(0, 5).map((session) => <article className="admin-list-item" key={session.id}><div><strong>{session.name || session.clientMac}</strong><span>{session.status} · {formatCountdown(session.remainingSeconds)}</span></div><p>{session.ssid || 'SSID não informado'}</p></article>)}</div> : <EmptyState message="Nenhuma sessão recente neste site." />}</Panel><Panel title="Access Points" icon={<Radio />} compact>{siteAps.slice(0, 5).length ? <div className="admin-list">{siteAps.slice(0, 5).map((ap, index) => <article className="admin-list-item" key={textValue(ap, ['id', 'mac']) || index}><div><strong>{textValue(ap, ['name']) || 'AP sem nome'}</strong><span>{textValue(ap, ['status']) || 'Status indisponível'}</span></div><p>{textValue(ap, ['mac']) || textValue(ap, ['ip']) || 'Identificação indisponível'}</p></article>)}</div> : <EmptyState message="Nenhum AP listado neste site." />}</Panel><Panel title="Vouchers" icon={<Ticket />} compact>{siteVouchers.slice(0, 5).length ? <div className="admin-list">{siteVouchers.slice(0, 5).map((voucher) => <article className="admin-list-item" key={voucher.id}><div><strong>{voucher.codeLabel}</strong><span>{voucher.status}</span></div><p>{voucher.durationMinutes} min · {voucher.usedCount} uso(s)</p></article>)}</div> : <EmptyState message="Nenhum voucher neste site." />}</Panel><Panel title="Avisos e manutenção" icon={<Megaphone />} compact>{siteNotices.slice(0, 4).length ? <div className="admin-list">{siteNotices.slice(0, 4).map((notice) => <article className="admin-list-item" key={notice.id}><div><strong>{notice.title}</strong><span>{notice.site === 'ALL' ? 'Global' : siteName}</span></div><p>{notice.message}</p></article>)}</div> : <EmptyState message={maintenance?.maintenanceEnabled ? 'Sem aviso ativo; manutenção configurada.' : 'Nenhum aviso ativo neste site.'} />}</Panel></section></div>
}
function AuditPanel({ audit, compact = false }: { audit: AuditEntry[]; compact?: boolean }) {
  return <Panel title="Últimas ações administrativas" icon={<History />} compact={compact}>{audit.length ? <div className="admin-list">{audit.slice(0, compact ? 5 : 30).map((entry) => <article key={entry.id} className="admin-list-item"><div><strong>{humanAudit(entry.event)}</strong><span>{formatClock(entry.createdAt)}</span></div><p>{entry.siteLabel && entry.siteLabel !== 'global' ? `Unidade: ${entry.siteLabel}` : 'Escopo: global'} · Referência: {entry.targetId || 'global'}</p></article>)}</div> : <EmptyState message="Nenhuma ação administrativa recente." />}</Panel>
}
function SessionsPage({ sessions, sites, filter, busy, feedback, onFilter, onEndSession }: { sessions: GuestSessionRow[]; sites: SiteNode[]; filter: SessionFilter; busy: boolean; feedback: string; onFilter: (value: SessionFilter) => void; onEndSession: (sessionId: string) => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [confirmEnd, setConfirmEnd] = useState<GuestSessionRow | null>(null)
  const labels: Record<SessionFilter, string> = { all: 'Todas', online: 'Online', 'expiring-30': 'Expiram em 30 min', 'expiring-10': 'Expiram em 10 min', 'ended-today': 'Encerradas hoje' }
  const siteLabel = (value?: string) => sites.find((site) => site.siteId === value || site.name === value)?.name || value || 'Não disponível'
  const rows = sessions.filter((session) => {
    const blob = `${session.name ?? ''} ${session.clientMac} ${session.ssid ?? ''} ${session.site ?? ''} ${session.apMac ?? ''}`.toLowerCase()
    const matchesQuery = !query || blob.includes(query.toLowerCase())
    const remaining = session.remainingSeconds
    const matchesFilter = filter === 'all'
      || (filter === 'online' && session.status === 'authorized' && remaining > 0)
      || (filter === 'expiring-30' && session.status === 'authorized' && remaining > 0 && remaining <= 1800)
      || (filter === 'expiring-10' && session.status === 'authorized' && remaining > 0 && remaining <= 600)
      || (filter === 'ended-today' && ['disconnected', 'expired'].includes(session.status))
    return matchesQuery && matchesFilter
  })
  const requestEnd = async () => {
    if (!confirmEnd) return
    try {
      await onEndSession(confirmEnd.id)
      setConfirmEnd(null)
    } catch {
      return
    }
  }
  return <div className="admin-content"><PageHeader title="Sessões" description="Acompanhe acessos autorizados, encerrados e expirando pelo banco do portal." /><Panel title="Sessões do portal" icon={<MonitorCheck />}><div className="table-toolbar"><input aria-label="Buscar sessao" placeholder="Buscar por dispositivo, MAC observado, SSID, site ou AP..." value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="segmented" role="tablist" aria-label="Filtro de sessoes">{Object.entries(labels).map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} type="button" onClick={() => onFilter(key as SessionFilter)}>{label}</button>)}</div>{feedback ? <p className={feedback.includes('sucesso') ? 'success session-action-feedback' : 'error session-action-feedback'} role="status">{feedback}</p> : null}{rows.length ? <div className="admin-table-wrap"><table className="admin-table sessions-table"><thead><tr><th>Dispositivo</th><th>Método</th><th>Site</th><th>SSID</th><th>Início</th><th>Expira</th><th>Restante</th><th>Status</th><th>Ações</th></tr></thead><tbody>{rows.map((session) => <tr key={session.id}><td><strong>{session.name || session.clientMac}</strong><small>{session.clientMac}</small></td><td>{session.method}</td><td>{siteLabel(session.site)}</td><td>{session.ssid || 'Não disponível'}</td><td>{formatClock(session.authorizedAt || session.createdAt)}</td><td>{formatClock(session.expiresAt)}</td><td>{formatCountdown(session.remainingSeconds)}</td><td><StatusBadge status={session.status} remainingSeconds={session.remainingSeconds} /></td><td>{session.canEndAccess ? <button className="table-action danger" type="button" disabled={busy} onClick={() => setConfirmEnd(session)}>Encerrar</button> : <span className="muted-cell">Indisponível</span>}</td></tr>)}</tbody></table></div> : <EmptyState message="Nenhuma sessao encontrada para os filtros atuais." />}</Panel>{confirmEnd ? <ConfirmDialog title="Encerrar acesso" message={`Esta ação encerra o acesso de ${confirmEnd.name || confirmEnd.clientMac} no UniFi. Continuar?`} busy={busy} onCancel={() => setConfirmEnd(null)} onConfirm={() => void requestEnd()} /> : null}</div>
}

function StatusBadge({ status, remainingSeconds }: { status: string; remainingSeconds?: number }) {
  const tone = status === 'authorized' && (remainingSeconds ?? 0) <= 600 ? 'critical' : status === 'authorized' ? 'ok' : status === 'expired' ? 'warning' : 'neutral'
  const label = status === 'authorized' ? 'Autorizado' : status === 'expired' ? 'Expirado' : status === 'disconnected' ? 'Encerrado' : status
  return <span className={`status-badge ${tone}`}>{label}</span>
}
function VisitorsPanel({ visitors, busy, onEndSession }: { visitors: ClientRow[]; busy: boolean; onEndSession: (sessionId: string) => Promise<void> }) {
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
      setFeedback(err instanceof Error ? err.message : 'Nao foi possivel encerrar o acesso.')
    }
  }
  return <div className="admin-content"><Panel title="Usuarios e visitantes" icon={<UsersRound />}><div className="table-toolbar"><input aria-label="Buscar visitante" placeholder="Buscar por nome, MAC observado, IP, SSID, AP..." value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Filtrar por site" value={site} onChange={(event) => setSite(event.target.value)}><option value="ALL">Todos os sites</option>{sites.map((item) => <option key={item} value={item}>{item}</option>)}</select><select aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Todos os status</option><option value="authorized">Autorizado</option><option value="expired">Expirado</option><option value="disconnected">Encerrado</option></select></div>{feedback ? <p className={feedback.includes('sucesso') ? 'success session-action-feedback' : 'error session-action-feedback'} role="status">{feedback}</p> : null}{filtered.length ? <div className="visitor-grid">{filtered.map((row, index) => <button className="visitor-card" key={textValue(row, ['id', 'mac']) || index} type="button" onClick={() => setSelected(row)}><div><strong>{textValue(row, ['name', 'hostname']) || 'Dispositivo sem nome'}</strong><span>{textValue(row, ['siteName']) || 'Site nao informado'} - {textValue(row, ['ssid']) || 'SSID indisponivel'}</span></div><dl><div><dt>MAC observado</dt><dd>{textValue(row, ['mac']) || '-'}</dd></div><div><dt>IP</dt><dd>{textValue(row, ['ip']) || '-'}</dd></div><div><dt>Status</dt><dd>{boolValue(row, 'authorized') ? 'Autorizado' : textValue(row, ['portalStatus', 'status']) || '-'}</dd></div><div><dt>Tempo restante</dt><dd>{row.remainingSeconds ? formatCountdown(Number(row.remainingSeconds)) : '-'}</dd></div></dl></button>)}</div> : <EmptyState message="Nenhum visitante encontrado." />}</Panel>{selected ? <ClientDrawer row={selected} onClose={() => setSelected(null)} onEnd={() => setConfirmEnd(selected)} /> : null}{confirmEnd ? <ConfirmDialog title="Encerrar acesso" message="Esta ação encerra o acesso deste visitante na UniFi. Continuar?" busy={busy} onCancel={() => setConfirmEnd(null)} onConfirm={() => void endAccess(confirmEnd)} /> : null}</div>
}
function ClientDrawer({ row, onClose, onEnd }: { row: ClientRow; onClose: () => void; onEnd: () => void }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label="Informacoes do dispositivo" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span>Informacoes do dispositivo</span><h2>{textValue(row, ['name', 'hostname']) || 'Dispositivo sem nome'}</h2></div><button type="button" aria-label="Fechar" onClick={onClose}><X /></button></div><div className="detail-list"><InfoLine label="MAC observado" value={textValue(row, ['mac'])} /><InfoLine label="IP" value={textValue(row, ['ip'])} /><InfoLine label="Site" value={textValue(row, ['siteName', 'siteId'])} /><InfoLine label="AP" value={textValue(row, ['apMac'])} /><InfoLine label="SSID" value={textValue(row, ['ssid'])} /><InfoLine label="Sinal" value={textValue(row, ['signal'])} /><InfoLine label="Método de autenticacao" value={textValue(row, ['authorizationMethod'])} /><InfoLine label="Autorizado em" value={formatClock(textValue(row, ['authorizedAt']))} /><InfoLine label="Expira em" value={formatClock(textValue(row, ['expiresAt']))} /><InfoLine label="Tempo restante" value={row.remainingSeconds ? formatCountdown(Number(row.remainingSeconds)) : ''} /></div>{boolValue(row, 'canEndAccess') ? <button className="danger-button" type="button" onClick={onEnd}>Encerrar acesso</button> : <p className="panel-note">Nenhuma acao UniFi disponivel para este registro.</p>}</aside></div>
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



function AdminsPanel({ admin, admins, allowedSites, onChanged }: { admin: AdminMe | null; admins: AdminUserRow[]; allowedSites: AllowedSite[]; onChanged: () => Promise<void> }) {
  const canManage = admin?.role === 'SUPERADMIN'
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [invite, setInvite] = useState<AdminInviteResponse | null>(null)
  const [form, setForm] = useState({ name: '', email: '', role: 'ADMIN', siteIds: allowedSites.map((site) => site.siteId) })
  const [editingAccess, setEditingAccess] = useState<AdminUserRow | null>(null)
  const [accessSiteIds, setAccessSiteIds] = useState<string[]>([])
  const siteLabel = (siteId: string) => allowedSites.find((site) => site.siteId === siteId)?.name || siteId
  const adminSiteLabel = (row: AdminUserRow) => row.canSelectAllSites ? 'Todos os sites' : row.siteIds?.length ? row.siteIds.map(siteLabel).join(', ') : 'Sem site atribuído'

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
      setMessage('Permissões de site atualizadas com sucesso.')
      setEditingAccess(null)
      await onChanged()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível atualizar permissões.')
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
      setMessage(response.deliveryStatus === 'sent' ? 'Convite enviado com sucesso.' : 'Convite criado. Copie o link para enviar manualmente.')
      await onChanged()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível criar o convite.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="admin-content"><PageHeader title="Administradores" description="Convide novos administradores com RBAC e escopo de unidades." action={canManage ? <button className="soft-button" type="button" onClick={() => { setForm({ name: '', email: '', role: 'ADMIN', siteIds: allowedSites.map((site) => site.siteId) }); setOpen(true); setMessage(''); setInvite(null) }}><UserCog /> Novo administrador</button> : null} />{message ? <p className={message.includes('sucesso') || message.includes('criado') ? 'success admin-inline-feedback' : 'error admin-inline-feedback'} role="status">{message}</p> : null}<Panel title="Administradores" icon={<UserCog />}>{admins.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Nome</th><th>Email</th><th>Role</th><th>Sites</th><th>Status</th><th>MFA</th><th>Último login</th><th>Criado em</th><th>Ações</th></tr></thead><tbody>{admins.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.email}</td><td>{row.role}</td><td>{adminSiteLabel(row)}</td><td>{row.status}</td><td>{row.mfa === 'not_configured' ? 'Não configurado' : row.mfa}</td><td>{formatClock(row.lastLogin)}</td><td>{formatClock(row.createdAt)}</td><td>{canManage && row.role !== 'SUPERADMIN' ? <button className="table-action" type="button" onClick={() => openAccessEditor(row)}>Sites</button> : <span className="muted-cell">Global</span>}</td></tr>)}</tbody></table></div> : <EmptyState message={canManage ? 'Nenhum administrador adicional encontrado.' : 'Somente SUPERADMIN pode listar administradores.'} />}</Panel>{open ? <div className="modal-backdrop centered" role="presentation"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-invite-title"><div className="modal-head"><div><span>RBAC</span><h2 id="admin-invite-title">Convidar administrador</h2></div><button type="button" aria-label="Fechar" onClick={() => setOpen(false)}><X /></button></div><div className="panel-form"><label htmlFor="invite-name">Nome<input id="invite-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoComplete="name" /></label><label htmlFor="invite-email">Email<input id="invite-email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" /></label><label htmlFor="invite-role">Perfil<select id="invite-role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="ADMIN">ADMIN</option><option value="VIEWER">VIEWER</option><option value="SUPERADMIN">SUPERADMIN</option></select></label>{form.role !== 'SUPERADMIN' ? <fieldset className="site-checks"><legend>Unidades permitidas</legend>{allowedSites.length ? allowedSites.map((site) => <label className="checkline" key={site.siteId}><input type="checkbox" checked={form.siteIds.includes(site.siteId)} onChange={() => toggleInviteSite(site.siteId)} /> {site.name}</label>) : <p className="panel-note">Nenhuma unidade permitida foi retornada pela API.</p>}</fieldset> : <p className="panel-note">SUPERADMIN possui acesso global ao painel.</p>}<button className="primary admin-save" type="button" onClick={() => void createInvite()} disabled={busy || (form.role !== 'SUPERADMIN' && !form.siteIds.length)}>{busy ? 'Enviando...' : 'Enviar convite'}</button>{invite ? <div className="invite-result"><span>{invite.deliveryStatus === 'sent' ? 'Email enviado' : 'Envio de email pendente'}</span><strong>{invite.email}</strong><p>Expira em {formatClock(invite.expiresAt)}</p>{invite.siteIds.length ? <p>Sites: {invite.siteIds.map(siteLabel).join(', ')}</p> : <p>Sites: acesso global</p>}{invite.inviteUrl ? <div className="copy-field"><input aria-label="Link do convite" readOnly value={invite.inviteUrl} /><button className="icon-table-action" type="button" aria-label="Copiar link do convite" onClick={() => void copyToClipboard(invite.inviteUrl || '')}><Copy /></button></div> : null}</div> : null}</div></section></div> : null}{editingAccess ? <div className="modal-backdrop centered" role="presentation"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="site-access-title"><div className="modal-head"><div><span>Permissões</span><h2 id="site-access-title">Sites de {editingAccess.name}</h2></div><button type="button" aria-label="Fechar" onClick={() => setEditingAccess(null)}><X /></button></div><div className="panel-form"><fieldset className="site-checks"><legend>Unidades permitidas</legend>{allowedSites.map((site) => <label className="checkline" key={site.siteId}><input type="checkbox" checked={accessSiteIds.includes(site.siteId)} onChange={() => toggleAccessSite(site.siteId)} /> {site.name}</label>)}</fieldset><button className="primary admin-save" type="button" onClick={() => void saveAccess()} disabled={busy || !accessSiteIds.length}>{busy ? 'Salvando...' : 'Salvar permissões'}</button></div></section></div> : null}</div>
}
function SettingsPanel({ admin, maintenance, appearance, allowedSites, selectedSiteId, siteAppearance, notices, saving, feedback, onChange, onSave, onResetSite }: { admin: AdminMe | null; maintenance: MaintenanceAdmin | null; appearance: PortalAppearance; allowedSites: AllowedSite[]; selectedSiteId: string; siteAppearance: PortalSiteAppearance | null; notices: AdminNotice[]; saving: boolean; feedback: string; onChange: (value: PortalAppearance) => void; onSave: () => void; onResetSite: () => void }) {
  const [device, setDevice] = useState<PreviewDevice>('mobile')
  const [previewState, setPreviewState] = useState<PreviewState>('initial')
  const selectedSite = allowedSites.find((site) => site.siteId === selectedSiteId)
  const scopeLabel = selectedSiteId === 'ALL' ? 'Configuração global' : selectedSite?.name || siteAppearance?.siteName || selectedSiteId
  const activeNotice = notices.find((notice) => notice.enabled && (notice.site === 'ALL' || notice.site === selectedSiteId))
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
  return <div className="admin-content"><PageHeader title="Configurações" description="Edite o visual, mensagens e termos exibidos para quem acessa o Wi-Fi público." /><section className="settings-layout visual-editor-layout"><Panel title={`Editor do portal público · ${scopeLabel}`} icon={<Settings />}><div className="panel-form settings-form">{selectedSiteId !== 'ALL' ? <p className="scope-note wide">Este override vale somente para {scopeLabel}. Campos vazios usam o visual global como fallback no portal público.</p> : <p className="scope-note wide">Você está editando a base institucional usada por todos os sites sem override específico.</p>}<label htmlFor="appearance-network">Nome da rede<input id="appearance-network" value={appearance.networkName} onChange={(event) => onChange({ ...appearance, networkName: event.target.value })} /></label><label htmlFor="appearance-establishment">Nome exibido<input id="appearance-establishment" value={appearance.establishmentName} onChange={(event) => onChange({ ...appearance, establishmentName: event.target.value })} /></label><label htmlFor="appearance-logo">URL do logo<input id="appearance-logo" value={appearance.logoUrl} onChange={(event) => onChange({ ...appearance, logoUrl: event.target.value })} placeholder="https://..." /></label><label htmlFor="appearance-color">Cor principal<div className="color-control"><input id="appearance-color" type="color" value={appearance.primaryColor} onChange={(event) => onChange({ ...appearance, primaryColor: event.target.value })} /><input aria-label="Cor principal em hexadecimal" value={appearance.primaryColor} onChange={(event) => onChange({ ...appearance, primaryColor: event.target.value })} /></div></label><label htmlFor="appearance-banner">Título da tela pública<input id="appearance-banner" value={appearance.bannerText} onChange={(event) => onChange({ ...appearance, bannerText: event.target.value })} /></label><label htmlFor="appearance-welcome">Texto de boas-vindas<textarea id="appearance-welcome" value={appearance.welcomeText} onChange={(event) => onChange({ ...appearance, welcomeText: event.target.value })} rows={3} /></label><label htmlFor="appearance-success">Mensagem de sucesso<textarea id="appearance-success" value={appearance.successMessage} onChange={(event) => onChange({ ...appearance, successMessage: event.target.value })} rows={3} /></label><label htmlFor="appearance-expired">Mensagem de reautenticação<textarea id="appearance-expired" value={appearance.expiredMessage} onChange={(event) => onChange({ ...appearance, expiredMessage: event.target.value })} rows={3} /></label><label className="wide" htmlFor="appearance-terms">Termos de uso<textarea id="appearance-terms" value={appearance.termsText} onChange={(event) => onChange({ ...appearance, termsText: event.target.value })} rows={8} /></label><div className="settings-actions"><button className="primary admin-save" type="button" onClick={onSave} disabled={saving}>{saving ? 'Salvando...' : selectedSiteId === 'ALL' ? 'Salvar visual global' : 'Salvar visual da unidade'}</button>{selectedSiteId !== 'ALL' && siteAppearance?.hasOverride ? <button className="soft-button" type="button" onClick={onResetSite} disabled={saving}>Voltar ao visual global</button> : null}</div>{feedback ? <p className={feedback.includes('sucesso') ? 'success' : 'error'} role="status">{feedback}</p> : null}</div></Panel><Panel title="Preview 1:1" icon={<MonitorCheck />}><div className="preview-toolbar stacked" role="group" aria-label="Escopo do preview"><span>{selectedSiteId === 'ALL' ? 'Visualizando base global' : `Visualizando como ${scopeLabel}`}</span></div><div className="preview-toolbar" role="tablist" aria-label="Tamanho do preview">{(['mobile', 'tablet', 'desktop'] as PreviewDevice[]).map((item) => <button key={item} className={device === item ? 'active' : ''} type="button" onClick={() => setDevice(item)}>{item === 'mobile' ? 'Mobile' : item === 'tablet' ? 'Tablet' : 'Desktop'}</button>)}</div><div className="preview-toolbar wrap" role="tablist" aria-label="Estado do preview">{previewStates.map((item) => <button key={item.id} className={previewState === item.id ? 'active' : ''} type="button" onClick={() => setPreviewState(item.id)}>{item.label}</button>)}</div><PublicPortalPreview appearance={appearance} device={device} state={previewState} noticeTitle={activeNotice?.title} noticeMessage={activeNotice?.message} maintenanceTitle={maintenance?.maintenanceTitle} maintenanceMessage={maintenance?.maintenanceMessage} /><div className="prepared-grid single preview-security"><InfoTile title="Sessão segura" value="HttpOnly" detail="O painel continua usando cookies e CSRF do backend." icon={<LockKeyhole />} /><InfoTile title="Conta" value={admin?.email ?? 'Autenticada'} detail="Dados carregados de /api/admin/me." icon={<UserRound />} /><InfoTile title="Modo manutenção" value={maintenance?.maintenanceEnabled ? 'Ativo' : 'Inativo'} detail="Configuração real carregada do backend." icon={<Clock />} /></div></Panel></section></div>
}
function MaintenanceAdminPanel({ maintenance, saving, feedback, onChange, onSave }: { maintenance: MaintenanceAdmin; saving: boolean; feedback: string; onChange: (value: MaintenanceAdmin) => void; onSave: () => void }) {
  return (
    <div className="admin-content">
      <section className="maintenance-editor" aria-labelledby="maintenance-title">
        <div className={`maintenance-status-card ${maintenance.maintenanceEnabled ? 'active' : ''}`}>
          <div><span>Status do portal</span><strong>{maintenance.maintenanceEnabled ? 'Portal em manutencao' : 'Portal funcionando normalmente'}</strong><p>{maintenance.maintenanceScheduled ? `Início programado: ${formatClock(maintenance.maintenanceStartAt)}` : 'A manutencao pode ser imediata ou programada com inicio e termino.'}</p></div>
          <label className="switch" htmlFor="maintenance-enabled"><input id="maintenance-enabled" type="checkbox" checked={maintenance.maintenanceEnabled} onChange={(event) => onChange({ ...maintenance, maintenanceEnabled: event.target.checked })} /><span aria-hidden="true" /></label>
        </div>
        <div className="maintenance-grid">
          <div className="panel-form">
            <div className="section-heading"><h2 id="maintenance-title">Manutencao</h2><p>Controle a tela que aparece para visitantes durante uma janela de indisponibilidade.</p></div>
            <label htmlFor="maintenance-field-title">Titulo<input id="maintenance-field-title" value={maintenance.maintenanceTitle} onChange={(event) => onChange({ ...maintenance, maintenanceTitle: event.target.value })} /></label>
            <label htmlFor="maintenance-field-message">Mensagem<textarea id="maintenance-field-message" value={maintenance.maintenanceMessage} onChange={(event) => onChange({ ...maintenance, maintenanceMessage: event.target.value })} rows={5} /></label>
            <div className="date-grid"><label htmlFor="maintenance-start">Início<input id="maintenance-start" type="datetime-local" value={datetimeLocal(maintenance.maintenanceStartAt)} onChange={(event) => onChange({ ...maintenance, maintenanceStartAt: fromDatetimeLocal(event.target.value) })} /></label><label htmlFor="maintenance-end">Termino<input id="maintenance-end" type="datetime-local" value={datetimeLocal(maintenance.maintenanceEndAt)} onChange={(event) => onChange({ ...maintenance, maintenanceEndAt: fromDatetimeLocal(event.target.value) })} /></label></div>
            <label htmlFor="maintenance-image">Imagem da manutencao<input id="maintenance-image" value={maintenance.maintenanceImageUrl} onChange={(event) => onChange({ ...maintenance, maintenanceImageUrl: event.target.value })} placeholder="https://..." /></label>
            <button className="primary admin-save" type="button" onClick={onSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alteracoes'}</button>
            {feedback ? <p className={feedback.includes('sucesso') ? 'success' : 'error'} role="status">{feedback}</p> : null}
          </div>
          <aside className="maintenance-preview"><span>Preview publico</span>{maintenance.maintenanceImageUrl ? <img src={maintenance.maintenanceImageUrl} alt="" /> : <Clock className="hero-icon" />}<strong>{maintenance.maintenanceTitle}</strong><p>{maintenance.maintenanceMessage}</p><small>{maintenance.maintenanceStartAt ? `Início: ${formatClock(maintenance.maintenanceStartAt)}` : 'Sem inicio programado.'}</small><small>{maintenance.maintenanceEndAt ? `Termino: ${formatClock(maintenance.maintenanceEndAt)}` : 'Sem termino definido.'}</small></aside>
        </div>
      </section>
    </div>
  )
}


const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

createRoot(document.getElementById('root')!).render(<StrictMode>{window.location.pathname.startsWith('/admin/accept-invite') ? <AcceptInvite /> : window.location.pathname.startsWith('/admin') ? <Admin /> : <Portal />}</StrictMode>)
