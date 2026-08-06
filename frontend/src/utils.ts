import type { CSSProperties } from 'react'

import type { PortalSettings } from './types'

export const portalParams = () => {
  const params = new URLSearchParams(window.location.search)
  return {
    clientMac: params.get('id') ?? params.get('mac') ?? params.get('clientMac') ?? '',
    apMac: params.get('ap') ?? params.get('apMac') ?? '',
    ssid: params.get('ssid') ?? '',
    site: params.get('site') ?? '',
    redirectUrl: params.get('url') ?? params.get('redirectUrl') ?? 'https://www.gstatic.com/generate_204',
  }
}

export const formatClock = (iso?: string | null) => iso ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : 'sem previsão'
export const formatMinutes = (seconds: number) => `${Math.round(seconds / 60)} min`
export const datetimeLocal = (iso?: string | null) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
export const fromDatetimeLocal = (value: string) => value ? new Date(value).toISOString() : null
export const cssVars = (settings?: Pick<PortalSettings, 'primaryColor'> | null) => ({ '--portal-primary': settings?.primaryColor || '#176b87' }) as CSSProperties
export const formatCountdown = (seconds: number) => {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const rest = safe % 60
  return hours > 0 ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}` : `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`
}

export const humanAudit = (event: string) => {
  const labels: Record<string, string> = {
    'maintenance.updated': 'Modo manutenção atualizado',
    'notification.created': 'Aviso criado',
    'notification.updated': 'Aviso atualizado',
    'notification.deleted': 'Aviso excluído',
    'voucher.created': 'Voucher criado',
    'voucher.revoked': 'Voucher revogado',
    'admin_invitation.created': 'Convite administrativo criado',
    'admin_invitation.accepted': 'Convite administrativo aceito',
    'session.ended': 'Acesso encerrado manualmente',
  }
  return labels[event] ?? event.replaceAll('_', ' ').replaceAll('.', ' ')
}

export const secondsAgo = (date?: Date | null) => {
  if (!date) return 'ainda não atualizado'
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  return seconds < 5 ? 'agora' : `há ${seconds} s`
}
export const onlyDigits = (value: string) => value.replace(/\D/g, '')
export const formatCpf = (value: string) => {
  const digits = onlyDigits(value).slice(0, 11)
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}
export const normalizeVoucher = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
export const displayVoucher = (value: string) => {
  const normalized = normalizeVoucher(value)
  if (normalized.startsWith('RF')) {
    const body = normalized.slice(2)
    return ['RF', body.slice(0, 4), body.slice(4, 8)].filter(Boolean).join('-')
  }
  return normalized.replace(/(.{4})/g, '$1-').replace(/-$/, '')
}
export const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
export const formatPhone = (value: string) => {
  const digits = onlyDigits(value).slice(0, 11)
  if (digits.length <= 10) return digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}
export const isCpfComplete = (value: string) => onlyDigits(value).length === 11

export const isValidCpf = (value: string) => {
  const digits = onlyDigits(value)
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false
  const calc = (factor: number) => {
    const total = digits
      .slice(0, factor - 1)
      .split('')
      .reduce((sum, digit, index) => sum + Number(digit) * (factor - index), 0)
    const rest = (total * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return calc(10) === Number(digits[9]) && calc(11) === Number(digits[10])
}
export const portalInstitutionName = (value?: string) => {
  const name = value?.trim()
  if (!name || name.toLowerCase() === 'gabinete itinerante') return 'Receita Federal'
  return name
}

export const textValue = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && value !== '') return String(value)
  }
  return ''
}
export const boolValue = (row: Record<string, unknown>, key: string) => row[key] === true || String(row[key]).toLowerCase() === 'true'
export const copyToClipboard = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', 'true')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  document.execCommand('copy')
  document.body.removeChild(field)
}

export const exportCsv = (filename: string, rows: string[][]) => {
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
