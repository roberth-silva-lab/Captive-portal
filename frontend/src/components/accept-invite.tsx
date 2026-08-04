import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'

import { api } from '../api'
import type { AdminInviteValidateResponse, AdminMe } from '../types'
import { formatClock } from '../utils'

const extractInviteToken = () => {
  const url = new URL(window.location.href)
  const queryToken = url.searchParams.get('token')?.trim()
  if (queryToken) return queryToken
  const pathMatch = url.pathname.match(/\/admin\/accept-invite\/([^/]+)/)
  return pathMatch ? decodeURIComponent(pathMatch[1]).trim() : ''
}

export function AcceptInvite() {
  const token = useMemo(extractInviteToken, [])
  const [invite, setInvite] = useState<AdminInviteValidateResponse | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptedPolicy, setAcceptedPolicy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [validating, setValidating] = useState(Boolean(token))
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) return
    setValidating(true)
    api<AdminInviteValidateResponse>(`/api/admin/admins/invitations/validate?token=${encodeURIComponent(token)}`)
      .then((payload) => {
        setInvite(payload)
        setMessage('')
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Não foi possível validar o convite.'))
      .finally(() => setValidating(false))
  }, [token])

  const localError = () => {
    if (!token) return 'Link de convite inválido ou incompleto.'
    if (validating) return 'Aguarde a validação do convite.'
    if (!invite) return 'Convite não validado.'
    if (password.length < 12) return 'A senha deve ter pelo menos 12 caracteres.'
    if (password !== confirmPassword) return 'A confirmação da senha não confere.'
    if (!acceptedPolicy) return 'É necessário confirmar a política administrativa.'
    return ''
  }

  const accept = async () => {
    const error = localError()
    if (error) {
      setMessage(error)
      return
    }
    setBusy(true)
    setMessage('')
    try {
      await api<AdminMe>('/api/admin/admins/invitations/accept', { method: 'POST', body: JSON.stringify({ token, password, confirmPassword, acceptedPolicy }) })
      setDone(true)
      setMessage('Conta administrativa ativada com sucesso. Entre no painel para continuar.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível aceitar o convite.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="portal-shell admin-login-shell">
      <section className="panel admin-card invite-accept-card" aria-labelledby="accept-invite-title">
        <div className="brand"><ShieldCheck aria-hidden="true" /><span>Portal administrativo</span></div>
        <h1 id="accept-invite-title">Aceitar convite</h1>
        <p className="muted">Defina sua senha administrativa para ativar o acesso ao painel.</p>

        {validating ? <p className="panel-note" role="status">Validando convite...</p> : null}

        {!token ? <p className="error" role="alert">Link de convite inválido ou incompleto.</p> : null}

        {invite ? <div className="invite-summary" aria-label="Resumo do convite">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <strong>{invite.name}</strong>
            <span>{invite.email}</span>
            <small>{invite.role} · {invite.siteIds.length ? invite.siteIds.join(', ') : 'Acesso global'} · expira em {formatClock(invite.expiresAt)}</small>
          </div>
        </div> : null}

        {token && !validating && invite && !done ? <>
          <label htmlFor="invite-email">E-mail<input id="invite-email" value={invite.email} readOnly autoComplete="email" /></label>
          <label htmlFor="invite-password">Senha<input id="invite-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} /></label>
          <label htmlFor="invite-confirm-password">Confirmar senha<input id="invite-confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} /></label>
          <label className="checkline" htmlFor="invite-policy"><input id="invite-policy" type="checkbox" checked={acceptedPolicy} onChange={(event) => setAcceptedPolicy(event.target.checked)} /> Entendo que este acesso é pessoal e administrativo.</label>
          <button className="primary" type="button" onClick={() => void accept()} disabled={busy}>{busy ? 'Ativando...' : 'Ativar conta'}</button>
        </> : null}

        {done ? <a className="soft-button login-link" href="/admin">Ir para o painel</a> : null}
        {message ? <p className={done ? 'success' : 'error'} role={done ? 'status' : 'alert'}>{done ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />} {message}</p> : null}
      </section>
    </main>
  )
}