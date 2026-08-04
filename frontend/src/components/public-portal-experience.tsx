import { AlertTriangle, Bell, CheckCircle2, Clock, Mail, ShieldCheck, Ticket, UserRound, Wifi, X } from 'lucide-react'
import type { CSSProperties, RefObject } from 'react'
import { useEffect, useMemo, useState } from 'react'

import type { Method, Notice, PortalAppearance, PortalSettings, PreviewDevice, PreviewState, SessionStatus, Stage } from '../types'
import { cssVars, formatClock, formatCountdown } from '../utils'

type PublicExperienceSettings = Pick<PortalSettings, 'logoUrl' | 'primaryColor' | 'bannerText' | 'welcomeText' | 'successMessage' | 'networkName' | 'establishmentName' | 'termsText'>

type PublicPortalExperienceProps = {
  settings: PublicExperienceSettings | PortalAppearance
  device?: PreviewDevice
  previewState?: PreviewState
  institutionName: string
  networkName: string
  ssid?: string
  method: Method
  identifier: string
  name?: string
  phone?: string
  emailCode?: string
  accepted: boolean
  stage: Stage
  message?: string
  messageTone?: 'info' | 'success' | 'error'
  fieldError?: string
  notices?: Notice[]
  isBusy?: boolean
  codeRequested?: boolean
  emailSending?: boolean
  emailCooldown?: number
  emailRemaining?: number
  session?: SessionStatus | null
  redirectUrl?: string
  maintenanceTitle?: string
  maintenanceMessage?: string
  maintenanceImageUrl?: string
  maintenanceStartsAt?: string | null
  maintenanceEndsAt?: string | null
  termsOpen?: boolean
  codeInputRef?: RefObject<HTMLInputElement | null>
  onSelectMethod?: (method: Method) => void
  onIdentifierChange?: (value: string) => void
  onNameChange?: (value: string) => void
  onPhoneChange?: (value: string) => void
  onEmailCodeChange?: (value: string) => void
  onAcceptedChange?: (value: boolean) => void
  onRequestEmailCode?: () => void
  onSubmit?: () => void
  onOpenTerms?: () => void
  onCloseTerms?: () => void
  onAcceptTerms?: () => void
}

const methodLabel = (method: Method) => method === 'cpf' ? 'CPF' : method === 'email' ? 'E-mail' : 'Voucher'

const previewMethod = (state?: PreviewState): Method => {
  if (state === 'cpf') return 'cpf'
  if (state === 'email' || state === 'code-sent') return 'email'
  return 'voucher'
}

export function PublicPortalExperience(props: PublicPortalExperienceProps) {
  const preview = Boolean(props.previewState)
  const method = preview ? previewMethod(props.previewState) : props.method
  const isReleased = props.stage === 'released' || props.previewState === 'released'
  const isMaintenance = props.previewState === 'maintenance'
  const shouldShowNotice = props.previewState === 'notice'
  const flowStep = useMemo(() => {
    if (isMaintenance) return 'maintenance'
    if (isReleased) return 'success'
    if (props.stage !== 'idle' && props.stage !== 'error') return 'authorizing'
    if (!props.accepted && !preview) return 'welcome'
    if (props.previewState === 'initial') return 'welcome'
    return 'method'
  }, [isMaintenance, isReleased, preview, props.accepted, props.previewState, props.stage])
  const style = cssVars(props.settings) as CSSProperties
  const frameClass = preview ? `public-preview-frame ${props.device || 'mobile'}` : 'public-live-frame'
  return (
    <main className={`portal-shell public-portal-shell ${preview ? 'preview-mode' : ''}`} style={style}>
      <section className={`panel portal-card public-portal-card ${frameClass}`} aria-labelledby="portal-title">
        <header className="portal-brand">
          <div className="portal-brand-mark" aria-hidden="true">{props.settings.logoUrl ? <img src={props.settings.logoUrl} alt="" /> : <ShieldCheck />}</div>
          <div>
            <span className="portal-eyebrow">{props.settings.bannerText || 'Portal de Acesso Wi-Fi'}</span>
            <strong>{props.institutionName}</strong>
            <p>{props.settings.welcomeText || 'Acesso seguro para visitantes'}</p>
          </div>
        </header>

        {shouldShowNotice ? <NoticeList notices={props.notices?.length ? props.notices : [{ id: 'preview', type: 'INFO', title: 'Aviso do portal', message: 'Comunicado vis?vel para esta unidade.', site: 'ALL' }]} /> : <NoticeList notices={props.notices ?? []} />}

        {flowStep === 'maintenance' ? <MaintenanceContent title={props.maintenanceTitle || 'Portal em manuten??o'} message={props.maintenanceMessage || props.message || 'Estamos realizando ajustes para melhorar o acesso.'} imageUrl={props.maintenanceImageUrl} startsAt={props.maintenanceStartsAt} endsAt={props.maintenanceEndsAt} /> : null}
        {flowStep === 'success' ? <SuccessContent session={props.session} method={method} networkName={props.networkName} redirectUrl={props.redirectUrl} successMessage={props.settings.successMessage} /> : null}
        {flowStep === 'welcome' ? <WelcomeStep settings={props.settings} networkName={props.networkName} accepted={props.accepted} fieldError={props.fieldError} onAcceptedChange={props.onAcceptedChange} onOpenTerms={props.onOpenTerms} onSubmit={props.onSubmit} preview={preview} /> : null}
        {flowStep === 'method' ? <MethodStep {...props} method={method} preview={preview} /> : null}
        {flowStep === 'authorizing' ? <AuthorizationStep stage={props.stage} message={props.message} messageTone={props.messageTone} /> : null}
        {props.stage === 'error' && props.message ? <p className="feedback error" role="status">{props.message}</p> : null}
        <div className="portal-footer-info">
          <span className="network-chip"><Wifi /> {props.ssid || props.networkName}</span>
          <small>Ambiente institucional protegido</small>
        </div>
      </section>
      {props.termsOpen ? <TermsModal text={props.settings.termsText} onClose={props.onCloseTerms || (() => undefined)} onAccept={props.onAcceptTerms || (() => undefined)} /> : null}
    </main>
  )
}

function WelcomeStep({ settings, networkName, accepted, fieldError, onAcceptedChange, onOpenTerms, onSubmit, preview }: { settings: PublicExperienceSettings | PortalAppearance; networkName: string; accepted: boolean; fieldError?: string; onAcceptedChange?: (value: boolean) => void; onOpenTerms?: () => void; onSubmit?: () => void; preview: boolean }) {
  return <div className="portal-step welcome-step"><div className="portal-heading"><h1 id="portal-title">{settings.bannerText || 'Portal de Acesso Wi-Fi'}</h1><p>{settings.welcomeText || `Conecte este dispositivo com seguran?a a ${networkName}.`}</p></div><div className={`terms-row ${fieldError === 'terms' ? 'terms-error' : ''}`}><label className="check"><input type="checkbox" checked={accepted || preview} readOnly={preview} onChange={(event) => onAcceptedChange?.(event.target.checked)} /> Li e aceito os <button className="terms-inline-link" type="button" onClick={(event) => { event.preventDefault(); onOpenTerms?.() }}>Termos de Uso</button>.</label></div><button className="primary portal-primary" type="button" onClick={onSubmit} disabled={!preview && !accepted}><ShieldCheck /> Continuar</button></div>
}

function MethodStep(props: PublicPortalExperienceProps & { preview: boolean }) {
  const isBusy = Boolean(props.isBusy)
  const method = props.method
  return <div className="portal-step method-step"><div className="portal-heading compact"><h1 id="portal-title">Como deseja acessar?</h1><p>Escolha uma op??o para liberar este dispositivo na rede.</p></div><div className="method-tabs" role="tablist" aria-label="M?todo de acesso">{(['voucher', 'cpf', 'email'] as Method[]).map((item) => <button key={item} className={method === item ? 'active' : ''} onClick={() => props.onSelectMethod?.(item)} type="button"><MethodIcon method={item} /><span>{methodLabel(item)}</span></button>)}</div><div className="form-stack"><MethodFields {...props} method={method} /><button className="primary portal-primary" type="button" disabled={!props.preview && (isBusy || !props.identifier || (method === 'email' && (!props.codeRequested || !props.emailCode)))} onClick={props.onSubmit}><ShieldCheck /> {isBusy ? 'Liberando acesso...' : 'Liberar acesso'}</button></div>{props.message ? <p className={`feedback ${props.messageTone || 'info'}`} role="status">{props.message}</p> : null}</div>
}

function MethodFields(props: PublicPortalExperienceProps & { preview: boolean }) {
  if (props.method === 'cpf') return <><label className="field-label" htmlFor="visitor-name"><span>Nome completo</span><input id="visitor-name" value={props.name || ''} onChange={(event) => props.onNameChange?.(event.target.value)} autoComplete="name" placeholder="Seu nome completo" readOnly={props.preview} /></label><label className="field-label" htmlFor="visitor-phone"><span>Telefone opcional</span><input id="visitor-phone" value={props.phone || ''} onChange={(event) => props.onPhoneChange?.(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" readOnly={props.preview} /></label><IdentifierField {...props} label="CPF" placeholder="000.000.000-00" help="Digite apenas os n?meros; a m?scara ser? aplicada automaticamente." inputMode="numeric" /></>
  if (props.method === 'email') return <><IdentifierField {...props} label="E-mail" placeholder="seu.email@exemplo.gov.br" help="Use um e-mail ao qual voc? tenha acesso agora." inputMode="email" autoComplete="email" /><div className="email-code-panel email-code-flow"><button type="button" onClick={props.onRequestEmailCode} disabled={props.emailSending || Boolean(props.emailCooldown) || props.isBusy}>{props.emailSending ? 'Enviando c?digo...' : props.emailCooldown ? `Reenviar c?digo em ${formatCountdown(props.emailCooldown)}` : props.codeRequested ? 'Reenviar c?digo' : 'Enviar c?digo'}</button>{props.codeRequested || props.previewState === 'code-sent' ? <div className="email-sent-card"><CheckCircle2 /><div><strong>Solicita??o processada</strong><p>Se o endere?o puder receber mensagens, enviaremos um c?digo em instantes.</p><small>{props.emailRemaining ? `Expira em ${formatCountdown(props.emailRemaining)}.` : 'Verifique tamb?m sua pasta de spam.'}</small></div></div> : null}<label className="field-label compact code-field" htmlFor="email-code"><span>C?digo recebido</span><input ref={props.codeInputRef} id="email-code" className={props.fieldError === 'code' ? 'code-input input-error highlight' : props.emailCode ? 'code-input highlight' : 'code-input'} placeholder="000000" value={props.emailCode || ''} onChange={(event) => props.onEmailCodeChange?.(event.target.value)} inputMode="numeric" autoComplete="one-time-code" readOnly={props.preview} /><div className="otp-slots" aria-hidden="true">{Array.from({ length: 6 }).map((_, index) => <span key={index} className={props.emailCode?.[index] ? 'filled' : ''}>{props.emailCode?.[index] ?? ''}</span>)}</div></label></div></>
  return <IdentifierField {...props} label="Voucher" placeholder="Digite seu voucher" help="Informe o c?digo fornecido pela administra??o." inputMode="text" />
}

function IdentifierField(props: PublicPortalExperienceProps & { label: string; placeholder: string; help: string; inputMode: 'text' | 'numeric' | 'email'; autoComplete?: string; preview: boolean }) {
  return <label className="field-label" htmlFor="portal-identifier"><span>{props.label}</span><input id="portal-identifier" className={props.fieldError === 'identifier' ? 'input-error' : ''} value={props.preview ? previewValue(props.method, props.previewState) : props.identifier} onChange={(event) => props.onIdentifierChange?.(event.target.value)} inputMode={props.inputMode} autoComplete={props.autoComplete || 'off'} placeholder={props.placeholder} readOnly={props.preview} /><small className="field-help">{props.help}</small></label>
}

function previewValue(method: Method, state?: PreviewState) {
  if (method === 'cpf') return '000.000.000-00'
  if (method === 'email') return state === 'code-sent' ? 'ro***@exemplo.com' : 'visitante@example.com'
  return 'RF-ABCD-1234'
}

function MethodIcon({ method }: { method: Method }) {
  if (method === 'cpf') return <UserRound />
  if (method === 'email') return <Mail />
  return <Ticket />
}

function AuthorizationStep({ stage, message, messageTone }: { stage: Stage; message?: string; messageTone?: 'info' | 'success' | 'error' }) {
  return <div className="portal-step authorizing-step"><div className="portal-heading compact"><h1 id="portal-title">Preparando seu acesso</h1><p>{message || 'Aguarde enquanto confirmamos a autoriza??o na rede.'}</p></div><StageList stage={stage} />{message ? <p className={`feedback ${messageTone || 'info'}`} role="status">{message}</p> : null}</div>
}

function MaintenanceContent({ title, message, imageUrl, startsAt, endsAt }: { title: string; message: string; imageUrl?: string; startsAt?: string | null; endsAt?: string | null }) {
  return <div className="portal-step maintenance-step">{imageUrl ? <img className="maintenance-hero-image" src={imageUrl} alt="" /> : <Clock className="hero-icon" />}<span className="portal-eyebrow">Status do portal</span><h1 id="portal-title">{title}</h1><p>{message}</p>{startsAt ? <small>In?cio: {formatClock(startsAt)}</small> : null}{endsAt ? <small>Previs?o de retorno: {formatClock(endsAt)}</small> : null}<button className="soft-button" type="button" onClick={() => window.location.reload()}>Tentar novamente</button></div>
}

function NoticeList({ notices }: { notices: Notice[] }) {
  if (!notices.length) return null
  return <div className="notices">{notices.map((notice) => <article key={notice.id} className={`notice ${notice.type.toLowerCase()}`}><Bell /><div><strong>{notice.title}</strong><p>{notice.message}</p>{notice.startsAt ? <small>In?cio: {formatClock(notice.startsAt)}</small> : null}</div></article>)}</div>
}

function TermsModal({ text, onClose, onAccept }: { text?: string; onClose: () => void; onAccept: () => void }) {
  return <div className="terms-backdrop" role="presentation" onMouseDown={onClose}><section className="terms-modal" role="dialog" aria-modal="true" aria-labelledby="terms-title" onMouseDown={(event) => event.stopPropagation()}><div className="terms-modal-head"><div><span>Termos da rede</span><h2 id="terms-title">Termos de uso</h2></div><button type="button" aria-label="Fechar termos" onClick={onClose}><X /></button></div><div className="terms-scroll"><p>{text || 'Ao continuar, voc? declara ci?ncia e aceite das regras de uso da rede de visitantes.'}</p></div><div className="terms-actions"><button className="terms-secondary" type="button" onClick={onClose}>Fechar</button><button className="primary terms-close" type="button" onClick={onAccept}>Li e aceito os termos</button></div></section></div>
}

function StageList({ stage }: { stage: Stage }) {
  const steps: Array<[Stage, string]> = [['validating', 'Credencial validada'], ['authorizing', 'Autorizando na rede'], ['confirming', 'Confirmando authorized=true'], ['checking', 'Verificando acesso'], ['released', 'Conex?o liberada']]
  const index = steps.findIndex(([id]) => id === stage)
  if (stage === 'idle' || stage === 'error') return null
  return <ol className="stages">{steps.map(([id, label], stepIndex) => <li key={id} className={stepIndex <= index ? 'done' : ''}><CheckCircle2 /> {label}</li>)}</ol>
}

function SuccessContent({ session, method, networkName, redirectUrl, successMessage }: { session?: SessionStatus | null; method: Method; networkName: string; redirectUrl?: string; successMessage?: string }) {
  return <div className="portal-step success-step"><CheckCircle2 className="hero-icon" /><h1 id="portal-title">Acesso autorizado</h1><p className="muted">{successMessage || 'Tudo certo. Você já pode navegar na Internet.'}</p>{session ? <SessionPanel session={session} method={method} networkName={networkName} /> : null}<a className="primary link" href={redirectUrl || 'https://www.gstatic.com/generate_204'}>Continuar para Internet</a></div>
}

function SessionPanel({ session, method, networkName }: { session: SessionStatus; method: Method; networkName: string }) {
  const [remaining, setRemaining] = useState(session.remainingSeconds)
  useEffect(() => {
    setRemaining(session.remainingSeconds)
    const handle = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(handle)
  }, [session.remainingSeconds])
  return <div className="session-box success-session-box"><div><span>Rede</span><strong>{session.ssid || networkName}</strong></div><div><span>M?todo usado</span><strong>{methodLabel(method)}</strong></div><div><span>Autorizada em</span><strong>{formatClock(session.authorizedAt)}</strong></div><div><span>Tempo restante</span><strong>{formatCountdown(remaining)}</strong></div>{remaining <= 600 && remaining > 0 ? <p className="warning-line"><AlertTriangle /> Seu acesso termina em {Math.ceil(remaining / 60)} minutos.</p> : null}{session.warningMessage ? <p className="warning-line"><AlertTriangle /> {session.warningMessage}</p> : null}</div>
}
