import { AlertTriangle, ArrowLeft, ArrowRight, Bell, CheckCircle2, Clock, FileCheck, LogIn, Mail, ShieldCheck, Ticket, UserRound, Wifi, X } from 'lucide-react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { useEffect, useMemo, useState } from 'react'

import type { Method, Notice, PortalAppearance, PortalSettings, PreviewDevice, PreviewState, SessionStatus, Stage } from '../types'
import { cssVars, displayVoucher, formatClock, formatCountdown } from '../utils'

type PublicExperienceSettings = Pick<PortalSettings, 'logoUrl' | 'primaryColor' | 'bannerText' | 'welcomeText' | 'successMessage' | 'networkName' | 'establishmentName' | 'termsText' | 'allowedAuthMethods'>

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
  formInstanceKey?: string | number
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

const DEFAULT_LOGO_URL = '/leaoreceita.png'
const DEFAULT_TERMS_TEXT = `TERMOS DE USO DA REDE WI-FI

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

Ao marcar a opção abaixo, você confirma que leu e concorda com estas condições.`

const text = {
  hotspot: 'Hotspot para convidados',
  wifiAccess: 'Portal de Acesso Wi-Fi',
  secureAccess: 'Acesso Wi-Fi seguro',
  welcomeTitle: 'Bem-vindo ao Wi-Fi para visitantes',
  welcomeFallback: 'Acesso seguro para visitantes',
  institution: 'Instituição',
  network: 'Rede',
  termsTitle: 'Termos de uso',
  termsAndPrivacy: 'Termos de uso e privacidade',
  termsAccept: 'Li e aceito os ',
  privacySuffix: ' e a política de privacidade da rede.',
  continue: 'Continuar',
  choosePrompt: 'Como deseja entrar?',
  chooseTitle: 'Escolha uma forma de acesso',
  chooseDescription: 'Use apenas uma forma de identificação para liberar este dispositivo.',
  back: 'Voltar',
  protected: 'Ambiente institucional protegido',
  authorizingTitle: 'Preparando seu acesso',
  authorizingFallback: 'Aguarde enquanto confirmamos a autorização na rede.',
  maintenance: 'Portal em manutenção',
  maintenanceFallback: 'Estamos realizando ajustes para melhorar o acesso.',
  status: 'Status do portal',
  starts: 'Início',
  returns: 'Previsão de retorno',
  tryAgain: 'Tentar novamente',
  noticeFallback: 'Comunicado visível para esta unidade.',
  accessReleased: 'Acesso liberado',
  successFallback: 'Tudo certo. Você já pode navegar na Internet.',
  internet: 'Continuar para a Internet',
  usedMethod: 'Método usado',
  authorizedAt: 'Autorizada em',
  remaining: 'Tempo restante',
  emailSentTitle: 'Código enviado',
  emailSentBody: 'Enviamos um código de 6 dígitos para o e-mail informado.',
  emailSpam: 'Verifique também sua pasta de spam.',
  emailCode: 'Código recebido',
  emailCodeHelp: 'Digite os 6 números. A verificação acontece automaticamente.',
}

const methodLabel = (method: Method) => method === 'cpf' ? 'CPF' : method === 'email' ? 'E-mail' : 'Voucher'

const previewMethod = (state?: PreviewState): Method => {
  if (state === 'cpf') return 'cpf'
  if (state === 'email' || state === 'code-sent') return 'email'
  return 'voucher'
}

const methodCopy: Record<Method, { title: string; description: string; icon: ReactNode }> = {
  voucher: { title: 'Voucher', description: 'Código fornecido pela administração', icon: <Ticket /> },
  cpf: { title: 'CPF', description: 'Cadastro rápido com seus dados', icon: <UserRound /> },
  email: { title: 'E-mail', description: 'Código enviado para seu e-mail', icon: <Mail /> },
}

const flowSteps = [
  { icon: <Wifi />, label: 'Conecte-se ao Wi-Fi' },
  { icon: <FileCheck />, label: 'Aceite os termos' },
  { icon: <LogIn />, label: 'Faça login' },
]

const normalizeTermsText = (value?: string) => {
  const trimmed = value?.trim() || ''
  const simplified = trimmed.toLowerCase()
  if (!trimmed || trimmed.length < 140 || simplified === 'ao continuar, você aceita os termos de uso da rede.') return DEFAULT_TERMS_TEXT
  return trimmed
}

const voucherDisplaySlots = (value: string) => displayVoucher(value).split('').filter(Boolean)
const CAPTIVE_CLOSE_DELAY_SECONDS = 3
const DEFAULT_CLOSE_REDIRECT_URL = 'https://www.gstatic.com/generate_204'

export function attemptCaptivePortalClose(redirectUrl?: string, win: Window = window) {
  let fallbackTimer: number | undefined
  try {
    win.close()
  } catch (error) {
    console.info('Captive portal window close was blocked', { name: error instanceof Error ? error.name : 'unknown' })
  }
  const target = redirectUrl?.trim()
  if (target) {
    fallbackTimer = win.setTimeout(() => {
      try {
        win.location.assign(target)
      } catch (error) {
        console.info('Captive portal fallback redirect was blocked', { name: error instanceof Error ? error.name : 'unknown' })
      }
    }, 800)
  }
  return () => {
    if (fallbackTimer) win.clearTimeout(fallbackTimer)
  }
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
  const logoUrl = props.settings.logoUrl?.trim() || DEFAULT_LOGO_URL
  const networkLabel = props.ssid || props.networkName || props.settings.networkName

  return (
    <main className={`portal-shell public-portal-shell public-hotspot-shell ${preview ? 'preview-mode' : ''}`} style={style}>
      <div className="public-hotspot-backdrop" aria-hidden="true" />
      <header className="public-hotspot-topbar" aria-label="Identificação do portal">
        <div className="public-hotspot-topmark" aria-hidden="true"><img src={logoUrl} alt="" /></div>
        <div><strong>{props.institutionName}</strong><span>{text.hotspot}</span></div>
      </header>

      <section className={`panel portal-card public-portal-card public-hotspot-card ${frameClass}`} aria-labelledby="portal-title">
        <header className="portal-brand public-hotspot-brand">
          <div className="portal-brand-mark public-hotspot-logo" aria-hidden="true"><img src={logoUrl} alt="" /></div>
          <div><span className="portal-eyebrow">{props.settings.bannerText || text.wifiAccess}</span><strong>{props.institutionName}</strong><p>{networkLabel}</p></div>
        </header>

        {!isMaintenance && !isReleased ? <FlowIndicator accepted={props.accepted || preview} methodReady={flowStep === 'method' || flowStep === 'authorizing'} /> : null}
        {shouldShowNotice ? <NoticeList notices={props.notices?.length ? props.notices : [{ id: 'preview', type: 'INFO', title: 'Aviso do portal', message: text.noticeFallback, site: 'ALL' }]} /> : <NoticeList notices={props.notices ?? []} />}
        {flowStep === 'maintenance' ? <MaintenanceContent title={props.maintenanceTitle || text.maintenance} message={props.maintenanceMessage || props.message || text.maintenanceFallback} imageUrl={props.maintenanceImageUrl || logoUrl} startsAt={props.maintenanceStartsAt} endsAt={props.maintenanceEndsAt} /> : null}
        {flowStep === 'success' ? <SuccessContent session={props.session} method={method} networkName={networkLabel} redirectUrl={props.redirectUrl} successMessage={props.settings.successMessage} /> : null}
        {flowStep === 'welcome' ? <WelcomeStep settings={props.settings} institutionName={props.institutionName} networkName={networkLabel} accepted={props.accepted} fieldError={props.fieldError} onAcceptedChange={props.onAcceptedChange} onOpenTerms={props.onOpenTerms} onSubmit={props.onSubmit} preview={preview} /> : null}
        {flowStep === 'method' ? <MethodStep {...props} method={method} networkName={networkLabel} preview={preview} /> : null}
        {flowStep === 'authorizing' ? <AuthorizationStep stage={props.stage} message={props.message} messageTone={props.messageTone} /> : null}
        {props.stage === 'error' && props.message ? <p className="feedback error public-inline-feedback" role="status">{props.message}</p> : null}
        <div className="portal-footer-info"><span className="network-chip"><Wifi /> {networkLabel}</span><small>{text.protected}</small></div>
      </section>
      {props.termsOpen ? <TermsModal text={normalizeTermsText(props.settings.termsText)} onClose={props.onCloseTerms || (() => undefined)} onAccept={props.onAcceptTerms || (() => undefined)} /> : null}
    </main>
  )
}

function FlowIndicator({ accepted, methodReady }: { accepted: boolean; methodReady: boolean }) {
  return <div className="public-flow-steps" aria-label="Etapas de acesso">{flowSteps.map((step, index) => {
    const active = index === 0 || (index === 1 && accepted) || (index === 2 && methodReady)
    return <div key={step.label} className={active ? 'active' : ''}><span>{step.icon}</span><small>{step.label}</small></div>
  })}</div>
}

function WelcomeStep({ settings, institutionName, networkName, accepted, fieldError, onAcceptedChange, onOpenTerms, onSubmit, preview }: { settings: PublicExperienceSettings | PortalAppearance; institutionName: string; networkName: string; accepted: boolean; fieldError?: string; onAcceptedChange?: (value: boolean) => void; onOpenTerms?: () => void; onSubmit?: () => void; preview: boolean }) {
  const termsText = normalizeTermsText(settings.termsText)
  return <div className="portal-step welcome-step"><div className="portal-heading public-welcome-heading"><span className="public-method-pill">{text.secureAccess}</span><h1 id="portal-title">{text.welcomeTitle}</h1><p>{settings.welcomeText || text.welcomeFallback}</p></div><div className="welcome-summary" aria-label="Dados da rede"><div><span>{text.institution}</span><strong>{institutionName}</strong></div><div><span>{text.network}</span><strong>{networkName}</strong></div></div><div className="public-terms-box"><div className="public-terms-title"><ShieldCheck /><span>{text.termsTitle}</span></div><div className="public-terms-preview">{termsText}</div><div className={`terms-row ${fieldError === 'terms' ? 'terms-error' : ''}`}><label className="check"><input type="checkbox" checked={accepted || preview} readOnly={preview} onChange={(event) => onAcceptedChange?.(event.target.checked)} /> <span>{text.termsAccept}<button className="terms-inline-link" type="button" onClick={(event) => { event.preventDefault(); onOpenTerms?.() }}>{text.termsTitle}</button>{text.privacySuffix}</span></label></div></div><button className="primary portal-primary" type="button" onClick={onSubmit} disabled={!preview && !accepted}><ShieldCheck /> {text.continue}</button></div>
}

function MethodStep(props: PublicPortalExperienceProps & { preview: boolean }) {
  const allowedMethods = props.preview ? (["voucher", "cpf", "email"] as Method[]) : (props.settings.allowedAuthMethods?.length ? props.settings.allowedAuthMethods : (["voucher", "cpf", "email"] as Method[]))
  const initialMethod = props.preview && props.previewState !== 'initial' ? props.method : null
  const [activeMethod, setActiveMethod] = useState<Method | null>(initialMethod)

  useEffect(() => {
    if (props.preview && props.previewState !== 'initial') setActiveMethod(props.method)
  }, [props.method, props.preview, props.previewState])

  const openMethod = (item: Method) => {
    props.onSelectMethod?.(item)
    setActiveMethod(item)
  }
  const backToChoices = () => {
    if (activeMethod) props.onSelectMethod?.(activeMethod)
    setActiveMethod(null)
  }

  if (!activeMethod) {
    return <div className="portal-step method-step"><div className="portal-heading compact public-method-heading"><span className="public-method-pill">{text.choosePrompt}</span><h1 id="portal-title">{allowedMethods.length === 1 ? `Acesse com ${methodCopy[allowedMethods[0]].title}` : text.chooseTitle}</h1><p>{allowedMethods.length === 1 ? 'Esta unidade definiu uma forma única de acesso para visitantes.' : text.chooseDescription}</p></div><div className="method-tabs method-cards public-method-list" role="list" aria-label="Metodo de acesso">{allowedMethods.map((item) => <button key={item} onClick={() => openMethod(item)} type="button"><span className="public-method-icon"><MethodIcon method={item} /></span><span>{methodCopy[item].title}</span><small>{methodCopy[item].description}</small><ArrowRight className="public-method-arrow" /></button>)}</div>{props.message ? <p className={`feedback ${props.messageTone || 'info'}`} role="status" aria-live="polite">{props.message}</p> : null}</div>
  }

  return <MethodFormScreen key={`${activeMethod}-${props.formInstanceKey ?? 0}`} {...props} method={activeMethod} onBack={backToChoices} />
}

function MethodFormScreen(props: PublicPortalExperienceProps & { preview: boolean; method: Method; onBack: () => void }) {
  const isBusy = Boolean(props.isBusy)
  const method = props.method
  const canSubmit = method === 'email' ? Boolean(props.codeRequested && props.emailCode?.length === 6) : Boolean(props.identifier)
  const title = methodCopy[method].title
  const showEmailCode = method === 'email' && (props.codeRequested || props.previewState === 'code-sent')

  return <div className="portal-step method-detail-step"><button className="public-back-button" type="button" onClick={props.onBack} disabled={isBusy}><ArrowLeft /> {text.back}</button><div className="portal-heading compact public-method-heading"><span className="public-method-pill">{title}</span><h1 id="portal-title">{method === 'email' && showEmailCode ? text.emailSentTitle : title}</h1><p>{methodCopy[method].description}</p></div><div className="form-stack public-form-card" data-method={method}>{method === 'email' && showEmailCode ? <EmailCodeStep {...props} /> : <MethodFields {...props} />}{method !== 'email' ? <button className="primary portal-primary" type="button" disabled={!props.preview && (isBusy || !canSubmit)} onClick={props.onSubmit}><ShieldCheck /> {isBusy ? 'Liberando acesso...' : 'Liberar acesso'}</button> : null}{method === 'email' && !showEmailCode ? <button className="primary portal-primary" type="button" onClick={props.onRequestEmailCode} disabled={props.emailSending || Boolean(props.emailCooldown) || props.isBusy || !props.identifier}>{props.emailSending ? 'Enviando código...' : props.emailCooldown ? `Reenviar código em ${formatCountdown(props.emailCooldown)}` : 'Enviar código'}</button> : null}</div>{props.message ? <p className={`feedback ${props.messageTone || 'info'}`} role="status" aria-live="polite">{props.message}</p> : null}</div>
}

function MethodFields(props: PublicPortalExperienceProps & { preview: boolean; method: Method }) {
  if (props.method === 'cpf') {
    const formKey = props.formInstanceKey ?? 'portal'
    return <><label className="field-label" htmlFor="visitor-name"><span>Nome completo</span><input id="visitor-name" name={`visitor-name-${formKey}`} value={props.name || ''} onChange={(event) => props.onNameChange?.(event.target.value)} autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" placeholder="Digite seu nome completo" readOnly={props.preview} /></label><IdentifierField {...props} label="CPF" placeholder="000.000.000-00" inputMode="numeric" autoComplete="new-password" fieldName={`visitor-cpf-${formKey}`} /><label className="field-label" htmlFor="visitor-phone"><span>Telefone opcional</span><input id="visitor-phone" name={`visitor-phone-${formKey}`} value={props.phone || ''} onChange={(event) => props.onPhoneChange?.(event.target.value)} inputMode="tel" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" placeholder="(00) 00000-0000" readOnly={props.preview} /></label></>
  }
  if (props.method === 'email') return <IdentifierField {...props} label="E-mail" placeholder="seu.email@exemplo.gov.br" help="Use um e-mail ao qual você tenha acesso agora." inputMode="email" autoComplete="email" />
  return <VoucherField {...props} />
}

function EmailCodeStep(props: PublicPortalExperienceProps & { preview: boolean }) {
  return <div className="email-code-screen"><div className="email-sent-card" aria-live="polite"><CheckCircle2 /><div><strong>{text.emailSentTitle}</strong><p>{text.emailSentBody}</p><small>{props.emailRemaining ? `Expira em ${formatCountdown(props.emailRemaining)}.` : text.emailSpam}</small></div></div><label className="field-label compact code-field" htmlFor="email-code"><span>{text.emailCode}</span><input ref={props.codeInputRef} id="email-code" className={props.fieldError === 'code' ? 'code-input input-error highlight' : props.emailCode ? 'code-input highlight' : 'code-input'} placeholder="000000" value={props.emailCode || ''} onChange={(event) => props.onEmailCodeChange?.(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} readOnly={props.preview} autoFocus /><div className="otp-slots" aria-hidden="true">{Array.from({ length: 6 }).map((_, index) => <span key={index} className={props.emailCode?.[index] ? 'filled' : ''}>{props.emailCode?.[index] ?? ''}</span>)}</div><small className="field-help">{text.emailCodeHelp}</small></label><button type="button" className="soft-button" onClick={props.onRequestEmailCode} disabled={props.emailSending || Boolean(props.emailCooldown) || props.isBusy}>{props.emailSending ? 'Enviando código...' : props.emailCooldown ? `Reenviar código em ${formatCountdown(props.emailCooldown)}` : 'Reenviar código'}</button></div>
}

function VoucherField(props: PublicPortalExperienceProps & { preview: boolean; method: Method }) {
  const value = props.preview ? previewValue('voucher', props.previewState) : props.identifier
  const slots = voucherDisplaySlots(value)
  const displaySlots = Array.from({ length: 12 }, (_, index) => slots[index] ?? '')
  return <label className="field-label voucher-code-field" htmlFor="portal-voucher"><span>Voucher</span><div className={`voucher-entry ${props.fieldError === 'identifier' ? 'input-error' : ''}`}><input id="portal-voucher" value={value} onChange={(event) => props.onIdentifierChange?.(event.target.value)} inputMode="text" autoComplete="off" aria-label="Voucher" maxLength={12} readOnly={props.preview} autoFocus /><div className="voucher-slots" aria-hidden="true">{displaySlots.map((char, index) => <span key={index} className={char === '-' ? 'separator' : char ? 'filled' : ''}>{char}</span>)}</div></div><small className="field-help">Informe o código no formato RF-XXXX-XXXX.</small></label>
}
function IdentifierField(props: PublicPortalExperienceProps & { label: string; placeholder: string; help?: string; inputMode: 'text' | 'numeric' | 'email'; autoComplete?: string; fieldName?: string; preview: boolean; method: Method }) {
  return <label className="field-label" htmlFor="portal-identifier"><span>{props.label}</span><input id="portal-identifier" name={props.fieldName || `portal-${props.method}-identifier`} data-lpignore={props.method === 'cpf' ? 'true' : undefined} data-1p-ignore={props.method === 'cpf' ? 'true' : undefined} className={props.fieldError === 'identifier' ? 'input-error' : ''} value={props.preview ? previewValue(props.method, props.previewState) : props.identifier} onChange={(event) => props.onIdentifierChange?.(event.target.value)} inputMode={props.inputMode} autoComplete={props.autoComplete || 'off'} placeholder={props.placeholder} maxLength={props.method === 'voucher' ? 39 : undefined} readOnly={props.preview} />{props.help ? <small className="field-help">{props.help}</small> : null}</label>
}

function previewValue(method: Method, state?: PreviewState) {
  if (method === 'cpf') return '000.000.000-00'
  if (method === 'email') return state === 'code-sent' ? 'visitante@example.com' : 'visitante@example.com'
  return 'RF-ABCD-1234'
}

function MethodIcon({ method }: { method: Method }) {
  if (method === 'cpf') return <UserRound />
  if (method === 'email') return <Mail />
  return <Ticket />
}

function AuthorizationStep({ stage, message, messageTone }: { stage: Stage; message?: string; messageTone?: 'info' | 'success' | 'error' }) {
  return <div className="portal-step authorizing-step"><div className="portal-heading compact"><h1 id="portal-title">{text.authorizingTitle}</h1><p>{message || text.authorizingFallback}</p></div><StageList stage={stage} />{message ? <p className={`feedback ${messageTone || 'info'}`} role="status" aria-live="polite">{message}</p> : null}</div>
}

function MaintenanceContent({ title, message, imageUrl, startsAt, endsAt }: { title: string; message: string; imageUrl?: string; startsAt?: string | null; endsAt?: string | null }) {
  return <div className="portal-step maintenance-step">{imageUrl ? <img className="maintenance-hero-image" src={imageUrl} alt="" /> : <Clock className="hero-icon" />}<span className="portal-eyebrow">{text.status}</span><h1 id="portal-title">{title}</h1><p>{message}</p>{startsAt ? <small>{text.starts}: {formatClock(startsAt)}</small> : null}{endsAt ? <small>{text.returns}: {formatClock(endsAt)}</small> : null}<button className="soft-button" type="button" onClick={() => window.location.reload()}>{text.tryAgain}</button></div>
}

function NoticeList({ notices }: { notices: Notice[] }) {
  if (!notices.length) return null
  return <div className="notices">{notices.map((notice) => <article key={notice.id} className={`notice ${notice.type.toLowerCase()}`}><Bell /><div><strong>{notice.title}</strong><p>{notice.message}</p>{notice.startsAt ? <small>{text.starts}: {formatClock(notice.startsAt)}</small> : null}</div></article>)}</div>
}

function TermsModal({ text: termsText, onClose, onAccept }: { text?: string; onClose: () => void; onAccept: () => void }) {
  return <div className="terms-backdrop" role="presentation" onMouseDown={onClose}><section className="terms-modal" role="dialog" aria-modal="true" aria-labelledby="terms-title" onMouseDown={(event) => event.stopPropagation()}><div className="terms-modal-head"><div><span>Termos da rede</span><h2 id="terms-title">{text.termsAndPrivacy}</h2></div><button type="button" aria-label="Fechar termos" onClick={onClose}><X /></button></div><div className="terms-scroll"><p>{normalizeTermsText(termsText)}</p></div><div className="terms-actions"><button className="terms-secondary" type="button" onClick={onClose}>Fechar</button><button className="primary terms-close" type="button" onClick={onAccept}>Li e aceito os termos</button></div></section></div>
}

function StageList({ stage }: { stage: Stage }) {
  const steps: Array<[Stage, string]> = [['validating', 'Dados validados'], ['authorizing', 'Solicitando autorização'], ['confirming', 'Confirmando acesso'], ['checking', 'Verificando conexão'], ['released', 'Conexão liberada']]
  const index = steps.findIndex(([id]) => id === stage)
  if (stage === 'idle' || stage === 'error') return null
  return <ol className="stages">{steps.map(([id, label], stepIndex) => <li key={id} className={stepIndex <= index ? 'done' : ''}><CheckCircle2 /> {label}</li>)}</ol>
}

function SuccessContent({ session, method, networkName, redirectUrl, successMessage }: { session?: SessionStatus | null; method: Method; networkName: string; redirectUrl?: string; successMessage?: string }) {
  const [countdown, setCountdown] = useState(CAPTIVE_CLOSE_DELAY_SECONDS)
  const [closeAttempted, setCloseAttempted] = useState(false)
  const fallbackUrl = redirectUrl || DEFAULT_CLOSE_REDIRECT_URL
  useEffect(() => {
    setCountdown(CAPTIVE_CLOSE_DELAY_SECONDS)
    setCloseAttempted(false)
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const countdownTimer = reducedMotion ? undefined : window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000)
    let cleanupFallback = () => undefined
    const closeTimer = window.setTimeout(() => {
      setCountdown(0)
      setCloseAttempted(true)
      cleanupFallback = attemptCaptivePortalClose(fallbackUrl)
    }, CAPTIVE_CLOSE_DELAY_SECONDS * 1000)
    return () => {
      window.clearTimeout(closeTimer)
      if (countdownTimer) window.clearInterval(countdownTimer)
      cleanupFallback()
    }
  }, [fallbackUrl])
  return <div className="portal-step success-step"><CheckCircle2 className="hero-icon" /><h1 id="portal-title">{text.accessReleased}</h1><p className="muted">{successMessage || text.successFallback}</p>{session ? <SessionPanel session={session} method={method} networkName={networkName} /> : null}<p className="close-countdown" aria-live="polite">{closeAttempted ? 'Se a janela não fechar automaticamente, continue pelo botão abaixo.' : `Esta janela será fechada em ${countdown} segundos.`}</p><a className="primary link" href={fallbackUrl} rel="noopener noreferrer">{text.internet}</a></div>
}

function SessionPanel({ session, method, networkName }: { session: SessionStatus; method: Method; networkName: string }) {
  const [remaining, setRemaining] = useState(session.remainingSeconds)
  useEffect(() => {
    setRemaining(session.remainingSeconds)
    const handle = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(handle)
  }, [session.remainingSeconds])
  return <div className="session-box success-session-box"><div><span>{text.network}</span><strong>{session.ssid || networkName}</strong></div><div><span>{text.usedMethod}</span><strong>{methodLabel(method)}</strong></div><div><span>{text.authorizedAt}</span><strong>{formatClock(session.authorizedAt)}</strong></div><div><span>{text.remaining}</span><strong>{formatCountdown(remaining)}</strong></div>{remaining <= 600 && remaining > 0 ? <p className="warning-line"><AlertTriangle /> Seu acesso termina em {Math.ceil(remaining / 60)} minutos.</p> : null}{session.warningMessage ? <p className="warning-line"><AlertTriangle /> {session.warningMessage}</p> : null}</div>
}
