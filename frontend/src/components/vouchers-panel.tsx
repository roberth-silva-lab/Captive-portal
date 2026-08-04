import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, Printer, Ticket, Trash2, X } from 'lucide-react'

import { api } from '../api'
import type { AllowedSite, CreatedVoucherCode, Voucher, VoucherBatchCreateResponse } from '../types'
import { copyToClipboard, exportCsv, formatClock, fromDatetimeLocal } from '../utils'
import { PageHeader } from './admin-layout'
import { ConfirmDialog, EmptyState, Panel } from './shared'

const voucherStatuses = ['Disponível', 'Em uso', 'Utilizado', 'Expirado', 'Revogado']

const defaultSiteOption = (allowedSites: AllowedSite[], selectedSiteId: string) => {
  if (selectedSiteId !== 'ALL') return allowedSites.find((site) => site.siteId === selectedSiteId) ?? { siteId: selectedSiteId, name: selectedSiteId, allowed: true }
  return allowedSites[0] ?? { siteId: 'Default', name: 'Default', allowed: true }
}

export function VoucherPanel({ vouchers, allowedSites, selectedSiteId, onChanged }: { vouchers: Voucher[]; allowedSites: AllowedSite[]; selectedSiteId: string; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [created, setCreated] = useState<CreatedVoucherCode[]>([])
  const [confirmRevoke, setConfirmRevoke] = useState<Voucher | null>(null)
  const initialSite = defaultSiteOption(allowedSites, selectedSiteId)
  const [form, setForm] = useState({ description: '', quantity: 1, durationMinutes: 120, siteId: initialSite.siteId, site: initialSite.name, maxDevices: 1, expiresAt: '' })
  const selectableSites = useMemo(() => allowedSites.length ? allowedSites : [defaultSiteOption(allowedSites, selectedSiteId)], [allowedSites, selectedSiteId])
  const rows = [...vouchers].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const createdText = created.map((voucher) => `${voucher.code} | ${voucher.site} | ${voucher.durationMinutes} min`).join('\n')

  useEffect(() => {
    const next = defaultSiteOption(allowedSites, selectedSiteId)
    setForm((current) => selectableSites.some((site) => site.siteId === current.siteId) ? current : { ...current, siteId: next.siteId, site: next.name })
  }, [allowedSites, selectableSites, selectedSiteId])

  const selectSite = (siteId: string) => {
    const site = selectableSites.find((item) => item.siteId === siteId) ?? { siteId, name: siteId, allowed: true }
    setForm({ ...form, siteId: site.siteId, site: site.name })
  }

  const createVouchers = async () => {
    setBusy(true)
    setMessage('')
    try {
      const response = await api<VoucherBatchCreateResponse>('/api/admin/vouchers', {
        method: 'POST',
        body: JSON.stringify({
          description: form.description.trim(),
          quantity: form.quantity,
          durationMinutes: form.durationMinutes,
          site: form.site,
          siteId: form.siteId,
          maxDevices: form.maxDevices,
          expiresAt: fromDatetimeLocal(form.expiresAt),
          enabled: true,
        }),
      })
      setCreated(response.vouchers)
      setMessage(`${response.created} voucher${response.created === 1 ? '' : 's'} criado${response.created === 1 ? '' : 's'} com sucesso.`)
      await onChanged()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível criar os vouchers.')
    } finally {
      setBusy(false)
    }
  }

  const revokeVoucher = async () => {
    if (!confirmRevoke) return
    setBusy(true)
    setMessage('')
    try {
      await api<Voucher>(`/api/admin/vouchers/${encodeURIComponent(confirmRevoke.id)}/revoke`, { method: 'POST' })
      setMessage('Voucher revogado com sucesso.')
      setConfirmRevoke(null)
      await onChanged()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível revogar o voucher.')
    } finally {
      setBusy(false)
    }
  }

  const printCreated = () => {
    const printable = document.getElementById('created-vouchers-print')?.innerHTML
    if (!printable) return
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=760,height=720')
    if (!printWindow) {
      window.print()
      return
    }
    printWindow.document.write(`<html><head><title>Vouchers</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#17212b}.voucher-print-card{border:1px solid #d8e4e0;border-radius:8px;padding:14px;margin:10px 0}.voucher-print-card strong{font-size:22px;letter-spacing:.08em}</style></head><body>${printable}</body></html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  return <div className="admin-content"><PageHeader title="Vouchers" description="Crie, acompanhe e revogue vouchers próprios do portal." action={<button className="soft-button" type="button" onClick={() => { const next = defaultSiteOption(allowedSites, selectedSiteId); setForm({ ...form, siteId: next.siteId, site: next.name }); setOpen(true); setMessage(''); setCreated([]) }}><Ticket /> Criar voucher</button>} />{message ? <p className={message.includes('sucesso') ? 'success admin-inline-feedback' : 'error admin-inline-feedback'} role="status">{message}</p> : null}<Panel title="Vouchers" icon={<Ticket />}>{rows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Código</th><th>Descrição</th><th>Site</th><th>Duração</th><th>Dispositivos</th><th>Uso</th><th>Expira</th><th>Status</th><th>Ações</th></tr></thead><tbody>{rows.map((voucher) => <tr key={voucher.id}><td><strong>{voucher.codeLabel}</strong></td><td>{voucher.description || '-'}</td><td>{voucher.siteName || voucher.site}</td><td>{voucher.durationMinutes} min</td><td>{voucher.maxDevices}</td><td>{voucher.usedCount}</td><td>{formatClock(voucher.expiresAt)}</td><td><span className={`status-badge ${voucher.status === 'Revogado' ? 'critical' : voucher.status === 'Expirado' ? 'warning' : 'ok'}`}>{voucherStatuses.includes(voucher.status) ? voucher.status : voucher.enabled ? 'Disponível' : 'Inativo'}</span></td><td><div className="table-actions"><button className="icon-table-action" type="button" aria-label="Copiar voucher" onClick={() => void copyToClipboard(voucher.codeLabel)}><Copy /></button>{voucher.isActive && !voucher.revokedAt ? <button className="icon-table-action danger" type="button" aria-label="Revogar voucher" onClick={() => setConfirmRevoke(voucher)}><Trash2 /></button> : null}</div></td></tr>)}</tbody></table></div> : <EmptyState message="Nenhum voucher cadastrado." />}</Panel>{open ? <div className="modal-backdrop centered" role="presentation"><section className="admin-modal wide" role="dialog" aria-modal="true" aria-labelledby="voucher-modal-title"><div className="modal-head"><div><span>Vouchers</span><h2 id="voucher-modal-title">Criar vouchers do portal</h2></div><button type="button" aria-label="Fechar" onClick={() => setOpen(false)}><X /></button></div><div className="modal-grid"><div className="panel-form"><label htmlFor="voucher-description">Descrição<input id="voucher-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Ex.: atendimento do dia" /></label><div className="date-grid"><label htmlFor="voucher-quantity">Quantidade<input id="voucher-quantity" type="number" min={1} max={500} value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} /></label><label htmlFor="voucher-duration">Duração em minutos<input id="voucher-duration" type="number" min={1} max={10080} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })} /></label></div><div className="date-grid"><label htmlFor="voucher-site">Site<select id="voucher-site" value={form.siteId} onChange={(event) => selectSite(event.target.value)}>{selectableSites.map((site) => <option key={site.siteId} value={site.siteId}>{site.name}</option>)}</select></label><label htmlFor="voucher-devices">Máximo de dispositivos<input id="voucher-devices" type="number" min={1} max={100} value={form.maxDevices} onChange={(event) => setForm({ ...form, maxDevices: Number(event.target.value) })} /></label></div><label htmlFor="voucher-expires">Expira em<input id="voucher-expires" type="datetime-local" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /></label><button className="primary admin-save" type="button" onClick={() => void createVouchers()} disabled={busy}>{busy ? 'Criando...' : 'Criar vouchers'}</button></div><aside className="created-vouchers" aria-live="polite"><div className="created-actions"><strong>Vouchers criados</strong><div><button className="icon-table-action" type="button" aria-label="Copiar vouchers criados" disabled={!created.length} onClick={() => void copyToClipboard(createdText)}><Copy /></button><button className="icon-table-action" type="button" aria-label="Exportar vouchers criados" disabled={!created.length} onClick={() => exportCsv('vouchers.csv', [['codigo', 'site', 'duracao_minutos', 'expira_em'], ...created.map((voucher) => [voucher.code, voucher.site, String(voucher.durationMinutes), voucher.expiresAt ?? ''])])}><Download /></button><button className="icon-table-action" type="button" aria-label="Imprimir vouchers criados" disabled={!created.length} onClick={printCreated}><Printer /></button></div></div><div id="created-vouchers-print">{created.length ? created.map((voucher) => <article className="voucher-print-card" key={voucher.id}><span>{voucher.site} · {voucher.durationMinutes} min</span><strong>{voucher.code}</strong><small>{voucher.expiresAt ? `Expira em ${formatClock(voucher.expiresAt)}` : 'Sem expiração definida'}</small></article>) : <EmptyState message="Os códigos aparecerão aqui somente após a criação." />}</div></aside></div></section></div> : null}{confirmRevoke ? <ConfirmDialog title="Revogar voucher" message={`O voucher ${confirmRevoke.codeLabel} deixará de autorizar novos acessos. Continuar?`} busy={busy} onCancel={() => setConfirmRevoke(null)} onConfirm={() => void revokeVoucher()} /> : null}</div>
}