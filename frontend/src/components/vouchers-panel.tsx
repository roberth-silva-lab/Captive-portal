import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, Pencil, Printer, Ticket, Trash2, X } from 'lucide-react'

import { api } from '../api'
import type { AllowedSite, CreatedVoucherCode, Voucher, VoucherBatchCreateResponse } from '../types'
import { copyToClipboard, exportCsv, formatClock, fromDatetimeLocal } from '../utils'
import { PageHeader } from './admin-layout'
import { ConfirmDialog, EmptyState, Panel } from './shared'

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] || char)
const voucherStatuses = ['Disponível', 'Em uso', 'Utilizado', 'Expirado', 'Revogado']
type ToastTone = 'success' | 'error' | 'info'
type Toast = { id: number; tone: ToastTone; title: string; message: string }
type VoucherForm = { description: string; quantity: number; durationMinutes: number; siteId: string; site: string; maxDevices: number; expiresAt: string; enabled: boolean }

const siteLabel = (siteId: string, allowedSites: AllowedSite[]) => siteId === 'ALL' ? 'Todos os sites' : allowedSites.find((site) => site.siteId === siteId)?.name || siteId
const defaultSiteOption = (allowedSites: AllowedSite[], selectedSiteId: string, canCreateGlobal: boolean) => {
  if (selectedSiteId === 'ALL' && canCreateGlobal) return { siteId: 'ALL', name: 'Todos os sites', allowed: true }
  if (selectedSiteId !== 'ALL') return allowedSites.find((site) => site.siteId === selectedSiteId) ?? { siteId: selectedSiteId, name: selectedSiteId, allowed: true }
  return allowedSites[0] ?? { siteId: 'Default', name: 'Default', allowed: true }
}
const toDatetimeLocal = (value?: string | null) => value ? value.slice(0, 16) : ''

export function VoucherPanel({ vouchers, allowedSites, selectedSiteId, canCreateGlobal = false, onChanged }: { vouchers: Voucher[]; allowedSites: AllowedSite[]; selectedSiteId: string; canCreateGlobal?: boolean; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  const [busy, setBusy] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [created, setCreated] = useState<CreatedVoucherCode[]>([])
  const [confirmRevoke, setConfirmRevoke] = useState<Voucher | null>(null)
  const initialSite = defaultSiteOption(allowedSites, selectedSiteId, canCreateGlobal)
  const [form, setForm] = useState<VoucherForm>({ description: '', quantity: 1, durationMinutes: 120, siteId: initialSite.siteId, site: initialSite.name, maxDevices: 1, expiresAt: '', enabled: true })
  const selectableSites = useMemo(() => {
    const base = allowedSites.length ? allowedSites : [defaultSiteOption(allowedSites, selectedSiteId, canCreateGlobal)]
    return canCreateGlobal ? [{ siteId: 'ALL', name: 'Todos os sites', allowed: true }, ...base.filter((site) => site.siteId !== 'ALL')] : base
  }, [allowedSites, canCreateGlobal, selectedSiteId])
  const rows = [...vouchers].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const createdText = created.map((voucher) => `${voucher.code} | ${voucher.site} | ${voucher.durationMinutes} min`).join('\n')

  const notify = (tone: ToastTone, title: string, message: string) => {
    const id = Date.now() + Math.random()
    setToasts((items) => [...items, { id, tone, title, message }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 5200)
  }
  const dismissToast = (id: number) => setToasts((items) => items.filter((item) => item.id !== id))

  useEffect(() => {
    const next = defaultSiteOption(allowedSites, selectedSiteId, canCreateGlobal)
    setForm((current) => selectableSites.some((site) => site.siteId === current.siteId) ? current : { ...current, siteId: next.siteId, site: next.name })
  }, [allowedSites, canCreateGlobal, selectableSites, selectedSiteId])

  const selectSite = (siteId: string) => setForm((current) => ({ ...current, siteId, site: siteLabel(siteId, allowedSites) }))
  const openCreate = () => {
    const next = defaultSiteOption(allowedSites, selectedSiteId, canCreateGlobal)
    setEditing(null)
    setForm({ description: '', quantity: 1, durationMinutes: 120, siteId: next.siteId, site: next.name, maxDevices: 1, expiresAt: '', enabled: true })
    setCreated([])
    setOpen(true)
  }
  const openEdit = (voucher: Voucher) => {
    const siteId = voucher.siteId || voucher.site || 'Default'
    setEditing(voucher)
    setCreated([])
    setForm({ description: voucher.description || '', quantity: 1, durationMinutes: voucher.durationMinutes, siteId, site: siteLabel(siteId, allowedSites), maxDevices: voucher.maxDevices || 1, expiresAt: toDatetimeLocal(voucher.expiresAt), enabled: voucher.enabled && voucher.isActive !== false })
    setOpen(true)
  }
  const payload = () => ({ description: form.description.trim(), durationMinutes: form.durationMinutes, site: form.siteId === 'ALL' ? 'ALL' : form.site, siteId: form.siteId, maxDevices: form.maxDevices, deviceLimit: form.maxDevices, expiresAt: fromDatetimeLocal(form.expiresAt), enabled: form.enabled })

  const saveVoucher = async () => {
    setBusy(true)
    try {
      if (editing) {
        await api<Voucher>(`/api/admin/vouchers/${encodeURIComponent(editing.id)}`, { method: 'PUT', body: JSON.stringify(payload()) })
        notify('success', 'Voucher atualizado', `${editing.codeLabel} foi salvo com as novas regras.`)
      } else {
        const response = await api<VoucherBatchCreateResponse>('/api/admin/vouchers', { method: 'POST', body: JSON.stringify({ ...payload(), quantity: form.quantity }) })
        setCreated(response.vouchers)
        notify('success', 'Voucher criado', `${response.created} voucher${response.created === 1 ? '' : 's'} criado${response.created === 1 ? '' : 's'} com sucesso.`)
      }
      await onChanged()
      if (editing) setOpen(false)
    } catch (err) {
      notify('error', editing ? 'Falha ao editar voucher' : 'Falha ao criar voucher', err instanceof Error ? err.message : 'Não foi possível concluir a operação.')
    } finally {
      setBusy(false)
    }
  }

  const revokeVoucher = async () => {
    if (!confirmRevoke) return
    setBusy(true)
    try {
      await api<Voucher>(`/api/admin/vouchers/${encodeURIComponent(confirmRevoke.id)}/revoke`, { method: 'POST' })
      notify('success', 'Voucher revogado', `${confirmRevoke.codeLabel} não autoriza mais novos acessos.`)
      setConfirmRevoke(null)
      await onChanged()
    } catch (err) {
      notify('error', 'Falha ao revogar voucher', err instanceof Error ? err.message : 'Não foi possível revogar o voucher.')
    } finally {
      setBusy(false)
    }
  }

  const copyVoucher = async (code: string) => {
    try {
      await copyToClipboard(code)
      notify('success', 'Código copiado', `${code} está na área de transferência.`)
    } catch {
      notify('error', 'Falha ao copiar', 'Não foi possível copiar o voucher automaticamente.')
    }
  }
  const printCreated = () => {
    if (!created.length) return
    const cards = created.map((voucher) => `<article class="voucher-print-card"><span>${escapeHtml(voucher.site)} - ${voucher.durationMinutes} min</span><strong>${escapeHtml(voucher.code)}</strong><small>${escapeHtml(voucher.expiresAt ? `Expira em ${formatClock(voucher.expiresAt)}` : 'Sem expiração definida')}</small></article>`).join('')
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=760,height=720')
    if (!printWindow) { window.print(); return }
    printWindow.document.write(`<html><head><title>Vouchers</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#17212b}.voucher-print-card{border:1px solid #d8e4e0;border-radius:8px;padding:14px;margin:10px 0}.voucher-print-card strong{display:block;font-size:22px;letter-spacing:.08em}.voucher-print-card span,.voucher-print-card small{color:#65746f}</style></head><body>${cards}</body></html>`)
    printWindow.document.close(); printWindow.focus(); printWindow.print()
  }

  return <div className="admin-content"><div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`admin-toast ${toast.tone}`} role="status"><div><strong>{toast.title}</strong><span>{toast.message}</span></div><button type="button" aria-label="Fechar aviso" onClick={() => dismissToast(toast.id)}><X /></button></div>)}</div><PageHeader title="Vouchers" description="Crie, edite, acompanhe e revogue vouchers próprios do portal." action={<button className="soft-button" type="button" onClick={openCreate}><Ticket /> Criar voucher</button>} /><Panel title="Vouchers" icon={<Ticket />}>{rows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Código</th><th>Descrição</th><th>Site</th><th>Duração</th><th>Dispositivos</th><th>Uso</th><th>Expira</th><th>Status</th><th>Ações</th></tr></thead><tbody>{rows.map((voucher) => <tr key={voucher.id}><td><strong>{voucher.codeLabel}</strong></td><td>{voucher.description || '-'}</td><td>{voucher.siteId === 'ALL' ? 'Todos os sites' : voucher.siteName || voucher.site}</td><td>{voucher.durationMinutes} min</td><td>{voucher.maxDevices}</td><td>{voucher.usedCount}</td><td>{voucher.expiresAt ? formatClock(voucher.expiresAt) : 'Sem expiração'}</td><td><span className={`status-badge ${voucher.status === 'Revogado' ? 'critical' : voucher.status === 'Expirado' ? 'warning' : 'ok'}`}>{voucherStatuses.includes(voucher.status) ? voucher.status : voucher.enabled ? 'Disponível' : 'Inativo'}</span></td><td><div className="table-actions"><button className="icon-table-action" type="button" aria-label="Copiar voucher" onClick={() => void copyVoucher(voucher.codeLabel)}><Copy /></button><button className="icon-table-action" type="button" aria-label="Editar voucher" onClick={() => openEdit(voucher)}><Pencil /></button>{voucher.isActive && !voucher.revokedAt ? <button className="icon-table-action danger" type="button" aria-label="Revogar voucher" onClick={() => setConfirmRevoke(voucher)}><Trash2 /></button> : null}</div></td></tr>)}</tbody></table></div> : <EmptyState message="Nenhum voucher cadastrado." />}</Panel>{open ? <div className="modal-backdrop centered" role="presentation"><section className="admin-modal wide" role="dialog" aria-modal="true" aria-labelledby="voucher-modal-title"><div className="modal-head"><div><span>Vouchers</span><h2 id="voucher-modal-title">{editing ? `Editar ${editing.codeLabel}` : 'Criar vouchers do portal'}</h2></div><button type="button" aria-label="Fechar" onClick={() => setOpen(false)}><X /></button></div><div className="modal-grid"><div className="panel-form"><label htmlFor="voucher-description">Descrição<input id="voucher-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Ex.: atendimento do dia" /></label>{!editing ? <label htmlFor="voucher-quantity">Quantidade<input id="voucher-quantity" type="number" min={1} max={500} value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} /></label> : null}<div className="date-grid"><label htmlFor="voucher-duration">Duração em minutos<input id="voucher-duration" type="number" min={1} max={10080} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })} /></label><label htmlFor="voucher-devices">Máximo de dispositivos<input id="voucher-devices" type="number" min={1} max={100} value={form.maxDevices} onChange={(event) => setForm({ ...form, maxDevices: Number(event.target.value) })} /></label></div><div className="date-grid"><label htmlFor="voucher-site">Site<select id="voucher-site" value={form.siteId} onChange={(event) => selectSite(event.target.value)}>{selectableSites.map((site) => <option key={site.siteId} value={site.siteId}>{site.name}</option>)}</select></label><label className="checkline" htmlFor="voucher-enabled"><input id="voucher-enabled" type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} disabled={Boolean(editing?.revokedAt)} /> Voucher habilitado</label></div><label htmlFor="voucher-expires">Expira em<input id="voucher-expires" type="datetime-local" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /><small className="field-hint">Opcional. Se ficar vazio, o voucher não expira por data; a duração começa quando for usado.</small></label><button className="primary admin-save" type="button" onClick={() => void saveVoucher()} disabled={busy}>{busy ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar vouchers'}</button></div><aside className="created-vouchers" aria-live="polite"><div className="created-actions"><strong>{editing ? 'Resumo' : 'Vouchers criados'}</strong><div><button className="icon-table-action" type="button" aria-label="Copiar vouchers criados" disabled={!created.length} onClick={() => void copyVoucher(createdText)}><Copy /></button><button className="icon-table-action" type="button" aria-label="Exportar vouchers criados" disabled={!created.length} onClick={() => { exportCsv('vouchers.csv', [['codigo', 'site', 'duracao_minutos', 'expira_em'], ...created.map((voucher) => [voucher.code, voucher.site, String(voucher.durationMinutes), voucher.expiresAt ?? ''])]); notify('success', 'Exportação criada', 'Arquivo CSV dos vouchers gerado pelo navegador.') }}><Download /></button><button className="icon-table-action" type="button" aria-label="Imprimir vouchers criados" disabled={!created.length} onClick={printCreated}><Printer /></button></div></div><div id="created-vouchers-print">{created.length ? created.map((voucher) => <article className="voucher-print-card" key={voucher.id}><span>{voucher.site} · {voucher.durationMinutes} min</span><strong>{voucher.code}</strong><small>{voucher.expiresAt ? `Expira em ${formatClock(voucher.expiresAt)}` : 'Sem expiração definida'}</small></article>) : <EmptyState message={editing ? 'Altere os campos e salve para aplicar as novas regras do voucher.' : 'Os códigos aparecerão aqui somente após a criação.'} />}</div></aside></div></section></div> : null}{confirmRevoke ? <ConfirmDialog title="Revogar voucher" message={`O voucher ${confirmRevoke.codeLabel} deixará de autorizar novos acessos. Continuar?`} busy={busy} onCancel={() => setConfirmRevoke(null)} onConfirm={() => void revokeVoucher()} /> : null}</div>
}