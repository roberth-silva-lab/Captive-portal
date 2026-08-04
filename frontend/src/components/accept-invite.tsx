import { useMemo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'

import { api } from '../api'
import type { AdminMe } from '../types'

export function AcceptInvite() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') ?? '', [])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptedPolicy, setAcceptedPolicy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState(false)

  const accept = async () => {
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

  return <main className="portal-shell admin-login-shell"><section className="panel admin-card" aria-labelledby="accept-invite-title"><div className="brand"><ShieldCheck aria-hidden="true" /><span>Portal administrativo</span></div><h1 id="accept-invite-title">Aceitar convite</h1><p className="muted">Defina sua senha administrativa para ativar o acesso ao painel.</p>{token ? <><label htmlFor="invite-password">Senha<input id="invite-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label><label htmlFor="invite-confirm-password">Confirmar senha<input id="invite-confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label><label className="checkline" htmlFor="invite-policy"><input id="invite-policy" type="checkbox" checked={acceptedPolicy} onChange={(event) => setAcceptedPolicy(event.target.checked)} /> Entendo que este acesso é pessoal e administrativo.</label><button className="primary" type="button" onClick={() => void accept()} disabled={busy || done}>{busy ? 'Ativando...' : done ? 'Conta ativada' : 'Ativar conta'}</button>{done ? <a className="soft-button login-link" href="/admin">Ir para o painel</a> : null}</> : <p className="error" role="alert">Convite ausente ou inválido.</p>}{message ? <p className={done ? 'success' : 'error'} role="status">{message}</p> : null}</section></main>
}