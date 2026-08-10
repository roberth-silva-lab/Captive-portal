const csrfToken = () => document.cookie.split('; ').find((item) => item.startsWith('portal_csrf='))?.split('=')[1] ?? ''

const fieldErrorMessage = (detail: unknown) => {
  if (!Array.isArray(detail)) return undefined
  return detail
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const record = item as { loc?: unknown[]; msg?: string }
      const field = Array.isArray(record.loc) ? String(record.loc[record.loc.length - 1] ?? '') : ''
      const label = field === 'confirmPassword' || field === 'confirm_password' ? 'confirmação de senha' : field === 'acceptedPolicy' || field === 'accepted_policy' ? 'política administrativa' : field || 'campo'
      return record.msg ? `${label}: ${record.msg}` : ''
    })
    .filter(Boolean)
    .join(' ')
}

const fallbackMessage = (status: number, detail?: unknown) => {
  const safeDetail = typeof detail === 'string' ? detail : undefined
  if (status === 400) return safeDetail || 'Solicitação inválida.'
  if (status === 401) return 'E-mail ou senha inválidos.'
  if (status === 403) return 'Você não possui permissão para esta ação.'
  if (status === 404) return safeDetail || 'Registro não encontrado.'
  if (status === 409) return safeDetail || 'Já existe um registro com estes dados.'
  if (status === 410) return safeDetail || 'Este convite expirou ou foi revogado.'
  if (status === 413) return safeDetail || 'Arquivo maior que o limite permitido.'
  if (status === 415) return safeDetail || 'Formato de arquivo não permitido.'
  if (status === 422) return fieldErrorMessage(detail) || safeDetail || 'Verifique os campos informados.'
  if (status === 429) return 'Muitas tentativas. Aguarde alguns minutos.'
  if (status === 503) return safeDetail || 'O serviço está temporariamente indisponível.'
  if (status === 500) return 'O serviço está temporariamente indisponível.'
  return safeDetail || 'Não foi possível concluir a solicitação.'
}

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export const api = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const isFormData = init.body instanceof FormData
  const headers = new Headers(init.headers)
  if (!isFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const token = csrfToken()
  if (token && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token)
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers,
  })
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {}
  if (!response.ok) {
    const detail = data.detail ?? data.message
    throw new ApiError(response.status, fallbackMessage(response.status, detail), detail)
  }
  if (!contentType.includes('application/json')) {
    throw new ApiError(502, 'Resposta inválida do servidor do portal.', undefined)
  }
  return data as T
}
