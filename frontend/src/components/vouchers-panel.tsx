import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, Mail, Pencil, Printer, Ticket, Trash2, X } from 'lucide-react'

import { api } from '../api'
import type { AllowedSite, CreatedVoucherCode, Voucher, VoucherBatchCreateResponse } from '../types'
import { copyToClipboard, exportCsv, formatClock, fromDatetimeLocal, validEmail } from '../utils'
import { PageHeader } from './admin-layout'
import { ConfirmDialog, EmptyState, Panel } from './shared'

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] || char)
const voucherStatuses = ['Disponível', 'Em uso', 'Utilizado', 'Expirado', 'Revogado']
const durationPresets = [
  { label: '30 min', minutes: 30 },
  { label: '1 h', minutes: 60 },
  { label: '2 h', minutes: 120 },
  { label: '4 h', minutes: 240 },
  { label: '8 h', minutes: 480 },
  { label: '24 h', minutes: 1440 },
  { label: '7 dias', minutes: 10080 },
] as const

type ToastTone = 'success' | 'error' | 'info'
type Toast = { id: number; tone: ToastTone; title: string; message: string }
type DurationMode = 'preset' | 'custom' | 'unlimited'
type VoucherForm = {
  description: string
  quantity: number
  durationMinutes: number
  durationMode: DurationMode
  siteId: string
  site: string
  maxDevices: number
  expiresAt: string
  enabled: boolean
  sendByEmail: boolean
  deliveryEmail: string
}

const siteLabel = (siteId: string, allowedSites: AllowedSite[]) => siteId === 'ALL' ? 'Todas as unidades' : allowedSites.find((site) => site.siteId === siteId)?.name || siteId
const defaultSiteOption = (allowedSites: AllowedSite[], selectedSiteId: string, canCreateGlobal: boolean) => {
  if (selectedSiteId === 'ALL' && canCreateGlobal) return { siteId: 'ALL', name: 'Todas as unidades', allowed: true }
  if (selectedSiteId !== 'ALL') return allowedSites.find((site) => site.siteId === selectedSiteId) ?? { siteId: selectedSiteId, name: selectedSiteId, allowed: true }
  return allowedSites[0] ?? { siteId: 'Default', name: 'Default', allowed: true }
}
const toDatetimeLocal = (value?: string | null) => value ? value.slice(0, 16) : ''
const durationLabel = (voucher: Pick<Voucher, 'durationMinutes' | 'unlimitedDuration'> | CreatedVoucherCode) => voucher.unlimitedDuration ? 'Sem limite' : `${voucher.durationMinutes} min`
const durationModeFor = (voucher: Voucher): DurationMode => voucher.unlimitedDuration ? 'unlimited' : durationPresets.some((item) => item.minutes === voucher.durationMinutes) ? 'preset' : 'custom'

export function VoucherPanel({
  vouchers,
  allowedSites,
  selectedSiteId,
  canCreateGlobal = false,
  canManage = true,
  onChanged,
}: {
  vouchers: Voucher[]
  allowedSites: AllowedSite[]
  selectedSiteId: string
  canCreateGlobal?: boolean
  canManage?: boolean
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  const [busy, setBusy] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [created, setCreated] = useState<CreatedVoucherCode[]>([])
  const [confirmRevoke, setConfirmRevoke] = useState<Voucher | null>(null)
  const initialSite = defaultSiteOption(allowedSites, selectedSiteId, canCreateGlobal)
  const [form, setForm] = useState<VoucherForm>({
    description: '',
    quantity: 1,
    durationMinutes: 120,
    durationMode: 'preset',
    siteId: initialSite.siteId,
    site: initialSite.name,
    maxDevices: 1,
    expiresAt: '',
    enabled: true,
    sendByEmail: false,
    deliveryEmail: '',
  })
  const selectableSites = useMemo(() => {
    const base = allowedSites.length ? allowedSites : [defaultSiteOption(allowedSites, selectedSiteId, canCreateGlobal)]
    return canCreateGlobal ? [{ siteId: 'ALL', name: 'Todas as unidades', allowed: true }, ...base.filter((site) => site.siteId !== 'ALL')] : base
  }, [allowedSites, canCreateGlobal, selectedSiteId])
  const rows = [...vouchers].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const createdText = created.map((voucher) => `${voucher.code} | ${voucher.site} | ${durationLabel(voucher)}`).join('\n')
  const emailInvalid = form.sendByEmail && !validEmail(form.deliveryEmail)
  const formInvalid = form.quantity < 1 || form.maxDevices < 1 || (form.durationMode === 'custom' && (form.durationMinutes < 1 || form.durationMinutes > 10080)) || emailInvalid

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
    if (!canManage) return
    const next = defaultSiteOption(allowedSites, selectedSiteId, canCreateGlobal)
    setEditing(null)
    setForm({
      description: '',
      quantity: 1,
      durationMinutes: 120,
      durationMode: 'preset',
      siteId: next.siteId,
      site: next.name,
      maxDevices: 1,
      expiresAt: '',
      enabled: true,
      sendByEmail: false,
      deliveryEmail: '',
    })
    setCreated([])
    setOpen(true)
  }
  const openEdit = (voucher: Voucher) => {
    if (!canManage) return
    const siteId = voucher.siteId || voucher.site || 'Default'
    setEditing(voucher)
    setCreated([])
    setForm({
      description: voucher.description || '',
      quantity: 1,
      durationMinutes: voucher.durationMinutes,
      durationMode: durationModeFor(voucher),
      siteId,
      site: siteLabel(siteId, allowedSites),
      maxDevices: voucher.maxDevices || 1,
      expiresAt: toDatetimeLocal(voucher.expiresAt),
      enabled: voucher.enabled && voucher.isActive !== false,
      sendByEmail: false,
      deliveryEmail: '',
    })
    setOpen(true)
  }
  const payload = () => ({
    description: form.description.trim(),
    durationMinutes: form.durationMinutes,
    unlimitedDuration: form.durationMode === 'unlimited',
    site: form.siteId === 'ALL' ? 'ALL' : form.site,
    siteId: form.siteId,
    maxDevices: form.maxDevices,
    deviceLimit: form.maxDevices,
    expiresAt: fromDatetimeLocal(form.expiresAt),
    enabled: form.enabled,
  })

  const saveVoucher = async () => {
    if (!canManage || formInvalid) return
    setBusy(true)
    try {
      if (editing) {
        await api<Voucher>(`/api/admin/vouchers/${encodeURIComponent(editing.id)}`, { method: 'PUT', body: JSON.stringify(payload()) })
        notify('success', 'Voucher atualizado', `${editing.codeLabel} foi salvo com as novas regras.`)
      } else {
        const response = await api<VoucherBatchCreateResponse>('/api/admin/vouchers', {
          method: 'POST',
          body: JSON.stringify({
            ...payload(),
            quantity: form.quantity,
            deliveryEmail: form.sendByEmail ? form.deliveryEmail.trim() : null,
          }),
        })
        setCreated(response.vouchers)
        if (response.emailDeliveryStatus === 'sent') {
          notify('success', 'Voucher criado e enviado', `O voucher foi enviado para ${response.emailSentTo || form.deliveryEmail.trim()}.`)
        } else if (response.emailDeliveryStatus === 'failed') {
          notify('info', 'Voucher criado', 'O voucher foi criado, mas o e-mail não pôde ser entregue. O código continua disponível para copiar ou imprimir.')
        } else {
          notify('success', 'Voucher criado', `${response.created} voucher${response.created === 1 ? '' : 's'} criado${response.created === 1 ? '' : 's'} com sucesso.`)
        }
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
    if (!confirmRevoke || !canManage) return
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
      notify('success', 'Código copiado', 'O voucher está na área de transferência.')
    } catch {
      notify('error', 'Falha ao copiar', 'Não foi possível copiar o voucher automaticamente.')
    }
  }
  const printCreated = () => {
    if (!created.length) return
    const cards = created.map((voucher) => `<article class="voucher-print-card"><span>${escapeHtml(voucher.site)} - ${escapeHtml(durationLabel(voucher))}</span><strong>${escapeHtml(voucher.code)}</strong><small>${escapeHtml(voucher.expiresAt ? `Voucher válido até ${formatClock(voucher.expiresAt)}` : 'Sem data limite para uso')}</small></article>`).join('')
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=760,height=720')
    if (!printWindow) { window.print(); return }
    printWindow.document.write(`<html><head><title>Vouchers</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#17212b}.voucher-print-card{border:1px solid #d8e4e0;border-radius:8px;padding:14px;margin:10px 0}.voucher-print-card strong{display:block;font-size:22px;letter-spacing:.08em}.voucher-print-card span,.voucher-print-card small{color:#65746f}</style></head><body>${cards}</body></html>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  return <div className="admin-content">
    <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`admin-toast ${toast.tone}`} role="status"><div><strong>{toast.title}</strong><span>{toast.message}</span></div><button type="button" aria-label="Fechar aviso" onClick={() => dismissToast(toast.id)}><X /></button></div>)}</div>
    <PageHeader
      title="Vouchers"
      description={canManage ? 'Crie, edite, acompanhe e revogue vouchers próprios do portal.' : 'Consulte os vouchers das unidades permitidas. Seu perfil é somente leitura.'}
      action={canManage ? <button className="soft-button" type="button" onClick={openCreate}><Ticket /> Criar voucher</button> : null}
    />
    {!canManage ? <div className="readonly-banner"><span>VIEWER</span><strong>Modo somente leitura</strong><p>Você pode consultar vouchers, mas não pode criar, editar ou revogar.</p></div> : null}
    <Panel title="Vouchers" icon={<Ticket />}>
      {rows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Código</th><th>Descrição</th><th>Unidade</th><th>Duração</th><th>Dispositivos</th><th>Uso</th><th>Validade do código</th><th>Status</th><th>Ações</th></tr></thead><tbody>{rows.map((voucher) => <tr key={voucher.id}><td><strong>{voucher.codeLabel}</strong></td><td>{voucher.description || '-'}</td><td>{voucher.siteId === 'ALL' ? 'Todas as unidades' : voucher.siteName || voucher.site}</td><td>{durationLabel(voucher)}</td><td>{voucher.maxDevices}</td><td>{voucher.usedCount}</td><td>{voucher.expiresAt ? formatClock(voucher.expiresAt) : 'Sem data limite'}</td><td><span className={`status-badge ${voucher.status === 'Revogado' ? 'critical' : voucher.status === 'Expirado' ? 'warning' : 'ok'}`}>{voucherStatuses.includes(voucher.status) ? voucher.status : voucher.enabled ? 'Disponível' : 'Inativo'}</span></td><td><div className="table-actions"><button className="icon-table-action" type="button" aria-label="Copiar identificação do voucher" onClick={() => void copyVoucher(voucher.codeLabel)}><Copy /></button>{canManage ? <><button className="icon-table-action" type="button" aria-label="Editar voucher" onClick={() => openEdit(voucher)}><Pencil /></button>{voucher.isActive && !voucher.revokedAt ? <button className="icon-table-action danger" type="button" aria-label="Revogar voucher" onClick={() => setConfirmRevoke(voucher)}><Trash2 /></button> : null}</> : null}</div></td></tr>)}</tbody></table></div> : <EmptyState message="Nenhum voucher cadastrado." />}
    </Panel>
    {open && canManage ? <div className="modal-backdrop centered" role="presentation"><section className="admin-modal wide voucher-modal-refined" role="dialog" aria-modal="true" aria-labelledby="voucher-modal-title">
      <div className="modal-head"><div><span>Vouchers</span><h2 id="voucher-modal-title">{editing ? `Editar ${editing.codeLabel}` : 'Criar voucher'}</h2><p>{editing ? 'Ajuste as regras do código existente.' : 'Defina o acesso e, se quiser, envie o código diretamente por e-mail.'}</p></div><button type="button" aria-label="Fechar" onClick={() => setOpen(false)}><X /></button></div>
      <div className="modal-grid voucher-modal-grid">
        <div className="panel-form voucher-form-stack">
          <section className="form-section"><div className="form-section-head"><span>1</span><div><strong>Identificação</strong><small>Ajuda a reconhecer para quem ou para qual atendimento o voucher foi criado.</small></div></div><label htmlFor="voucher-description">Descrição<input id="voucher-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Ex.: visitante da manhã" /></label>{!editing ? <label htmlFor="voucher-quantity">Quantidade<input id="voucher-quantity" type="number" min={1} max={500} value={form.quantity} disabled={form.sendByEmail} onChange={(event) => setForm({ ...form, quantity: Math.max(1, Number(event.target.value)) })} /><small className="field-hint">{form.sendByEmail ? 'O envio por e-mail cria um voucher por vez.' : 'Crie vários códigos quando não houver envio individual por e-mail.'}</small></label> : null}</section>

          <section className="form-section"><div className="form-section-head"><span>2</span><div><strong>Duração do acesso</strong><small>Conta a partir da primeira autorização do dispositivo.</small></div></div><div className="duration-choice-grid">{durationPresets.map((item) => <button key={item.minutes} className={form.durationMode === 'preset' && form.durationMinutes === item.minutes ? 'duration-choice active' : 'duration-choice'} type="button" onClick={() => setForm({ ...form, durationMode: 'preset', durationMinutes: item.minutes })}>{item.label}</button>)}<button className={form.durationMode === 'custom' ? 'duration-choice active' : 'duration-choice'} type="button" onClick={() => setForm({ ...form, durationMode: 'custom' })}>Personalizado</button><button className={form.durationMode === 'unlimited' ? 'duration-choice active unlimited' : 'duration-choice unlimited'} type="button" onClick={() => setForm({ ...form, durationMode: 'unlimited' })}>Sem limite</button></div>{form.durationMode === 'custom' ? <label htmlFor="voucher-duration">Minutos personalizados<input id="voucher-duration" type="number" min={1} max={10080} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })} /><small className="field-hint">Entre 1 minuto e 7 dias.</small></label> : null}{form.durationMode === 'unlimited' ? <div className="form-callout"><strong>Até encerramento manual</strong><span>O acesso permanece válido até ser encerrado manualmente. O sistema mantém a liberação automaticamente enquanto o serviço estiver disponível.</span></div> : null}</section>

          <section className="form-section"><div className="form-section-head"><span>3</span><div><strong>Unidade e validade</strong><small>Defina onde o código funciona e quantos aparelhos podem utilizá-lo.</small></div></div><div className="date-grid"><label htmlFor="voucher-site">Unidade<select id="voucher-site" value={form.siteId} onChange={(event) => selectSite(event.target.value)}>{selectableSites.map((site) => <option key={site.siteId} value={site.siteId}>{site.name}</option>)}</select></label><label htmlFor="voucher-devices">Máximo de dispositivos<input id="voucher-devices" type="number" min={1} max={100} value={form.maxDevices} onChange={(event) => setForm({ ...form, maxDevices: Math.max(1, Number(event.target.value)) })} /></label></div><label htmlFor="voucher-expires">Voucher pode ser usado até<input id="voucher-expires" type="datetime-local" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /><small className="field-hint">Opcional. Isso é a validade do código, diferente da duração do acesso.</small></label><label className="checkline" htmlFor="voucher-enabled"><input id="voucher-enabled" type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} disabled={Boolean(editing?.revokedAt)} /> Voucher habilitado</label></section>

          {!editing ? <section className="form-section"><div className="form-section-head"><span>4</span><div><strong>Entrega por e-mail</strong><small>Opcional. O código é enviado no momento da criação para o endereço informado.</small></div></div><label className="checkline" htmlFor="voucher-send-email"><input id="voucher-send-email" type="checkbox" checked={form.sendByEmail} onChange={(event) => setForm({ ...form, sendByEmail: event.target.checked, quantity: event.target.checked ? 1 : form.quantity })} /> Enviar este voucher por e-mail</label>{form.sendByEmail ? <label htmlFor="voucher-email">E-mail do destinatário<input id="voucher-email" type="email" value={form.deliveryEmail} onChange={(event) => setForm({ ...form, deliveryEmail: event.target.value })} placeholder="visitante@exemplo.com" autoComplete="email" />{emailInvalid ? <small className="field-error">Informe um e-mail válido.</small> : <small className="field-hint"><Mail /> O e-mail informa código, unidade, duração, dispositivos permitidos e validade.</small>}</label> : null}</section> : null}

          <button className="primary admin-save" type="button" onClick={() => void saveVoucher()} disabled={busy || formInvalid}>{busy ? 'Salvando...' : editing ? 'Salvar alterações' : form.sendByEmail ? 'Criar e enviar voucher' : 'Criar voucher'}</button>
        </div>
        <aside className="created-vouchers" aria-live="polite">
          <div className="created-actions"><strong>{editing ? 'Resumo das regras' : 'Voucher criado'}</strong><div><button className="icon-table-action" type="button" aria-label="Copiar vouchers criados" disabled={!created.length} onClick={() => void copyVoucher(createdText)}><Copy /></button><button className="icon-table-action" type="button" aria-label="Exportar vouchers criados" disabled={!created.length} onClick={() => { exportCsv('vouchers.csv', [['codigo', 'site', 'duracao', 'expira_em'], ...created.map((voucher) => [voucher.code, voucher.site, durationLabel(voucher), voucher.expiresAt ?? ''])]); notify('success', 'Exportação criada', 'Arquivo CSV dos vouchers gerado pelo navegador.') }}><Download /></button><button className="icon-table-action" type="button" aria-label="Imprimir vouchers criados" disabled={!created.length} onClick={printCreated}><Printer /></button></div></div>
          <div id="created-vouchers-print">{created.length ? created.map((voucher) => <article className="voucher-print-card" key={voucher.id}><span>{voucher.site} · {durationLabel(voucher)}</span><strong>{voucher.code}</strong><small>{voucher.expiresAt ? `Código válido até ${formatClock(voucher.expiresAt)}` : 'Código sem data limite para uso'}</small></article>) : <EmptyState message={editing ? 'As alterações serão aplicadas ao voucher atual.' : 'O código aparecerá aqui após a criação.'} />}</div>
          {!editing ? <div className="voucher-security-note"><strong>Entrega do código</strong><p>Depois da criação, use copiar, exportar ou imprimir para entregar o voucher ao visitante.</p></div> : null}
        </aside>
      </div>
    </section></div> : null}
    {confirmRevoke ? <ConfirmDialog title="Revogar voucher" message={`O voucher ${confirmRevoke.codeLabel} deixará de autorizar novos acessos. Continuar?`} busy={busy} onCancel={() => setConfirmRevoke(null)} onConfirm={() => void revokeVoucher()} /> : null}
  </div>
}
