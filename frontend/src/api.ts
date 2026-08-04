const csrfToken = () => document.cookie.split('; ').find((item) => item.startsWith('portal_csrf='))?.split('=')[1] ?? ''

const fallbackMessage = (status: number, detail?: string) => {
  if (status === 401) return 'Email ou senha inválidos.'
  if (status === 403) return 'Sessão expirada ou validação de segurança recusada. Recarregue a página e tente novamente.'
  if (status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  if (status === 500 || status === 503) return 'Portal temporariamente indisponível. Tente novamente em instantes.'
  return detail || 'Não foi possível concluir a solicitação.'
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const api = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
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
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : typeof data.message === 'string' ? data.message : undefined
    throw new ApiError(response.status, fallbackMessage(response.status, detail))
  }
  return data as T
}
