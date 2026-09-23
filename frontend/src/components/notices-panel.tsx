import { useMemo, useState } from 'react'
import { Megaphone, Trash2, X } from 'lucide-react'

import { api } from '../api'
import type { AdminNotice, AllowedSite } from '../types'
import { datetimeLocal, fromDatetimeLocal } from '../utils'
import { ConfirmDialog, EmptyState, Panel } from './shared'

type NoticeForm = { type: string; title: string; message: string; site: string; startsAt: string; endsAt: string; enabled: boolean }

export function NoticeAdminPanel({ notices, allowedSites = [], selectedSiteId = 'ALL', canSelectAllSites = false, canManage = true, compact = false, onChanged }: { notices: AdminNotice[]; allowedSites?: AllowedSite[]; selectedSiteId?: string; canSelectAllSites?: boolean; canManage?: boolean; compact?: boolean; onChanged?: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AdminNotice | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<AdminNotice | null>(null)
  const defaultSite = selectedSiteId !== 'ALL' ? selectedSiteId : canSelectAllSites ? 'ALL' : allowedSites[0]?.siteId ?? 'Default'
  const [form, setForm] = useState<NoticeForm>({ type: 'INFO', title: '', message: '', site: defaultSite, startsAt: '', endsAt: '', enabled: true })
  const siteOptions = useMemo(() => {
    const options = allowedSites.map((site) => ({ value: site.siteId, label: site.name }))
    return canSelectAllSites ? [{ value: 'ALL', label: 'Todos os sites' }, ...options] : options
  }, [allowedSites, canSelectAllSites])
  const visible = compact ? notices.slice(0, 4) : notices
  const siteLabel = (value: string) => value === 'ALL' ? 'Todos os sites' : siteOptions.find((site) => site.value === value)?.label || value

  const openCreate = () => {
    if (!canManage) return
    setEditing(null)
    setForm({ type: 'INFO', title: '', message: '', site: defaultSite, startsAt: '', endsAt: '', enabled: true })
    setMessage('')
    setOpen(true)
  }
  const openEdit = (notice: AdminNotice) => {
    if (!canManage) return
    setEditing(notice)
    setForm({ type: notice.type, title: notice.title, message: notice.message, site: notice.site, startsAt: datetimeLocal(notice.startsAt), endsAt: datetimeLocal(notice.endsAt), enabled: notice.enabled })
    setMessage('')
    setOpen(true)
  }
  const payload = () => ({ type: form.type, title: form.title.trim(), message: form.message.trim(), site: form.site, startsAt: fromDatetimeLocal(form.startsAt), endsAt: fromDatetimeLocal(form.endsAt), enabled: form.enabled })
  const save = async () => {
    setBusy(true)
    setMessage('')
    try {
      await api<AdminNotice>(editing ? `/api/admin/notifications/${encodeURIComponent(editing.id)}` : '/api/admin/notifications', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload()) })
      setMessage(editing ? 'Aviso atualizado com sucesso.' : 'Aviso criado com sucesso.')
      setOpen(false)
      await onChanged?.()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível salvar o aviso.')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!confirmDelete) return
    setBusy(true)
    setMessage('')
    try {
      await api(`/api/admin/notifications/${encodeURIComponent(confirmDelete.id)}`, { method: 'DELETE' })
      setMessage('Aviso excluído com sucesso.')
      setConfirmDelete(null)
      await onChanged?.()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível excluir o aviso.')
    } finally {
      setBusy(false)
    }
  }

  return <Panel title="Avisos ativos" icon={<Megaphone />} compact={compact}>{!compact && !canManage ? <div className="readonly-banner compact"><span>VIEWER</span><strong>Somente leitura</strong><p>Você pode consultar os avisos, mas não pode publicar ou alterar comunicados.</p></div> : null}{!compact && onChanged && canManage ? <div className="panel-toolbar"><button className="soft-button" type="button" onClick={openCreate}><Megaphone /> Novo aviso</button></div> : null}{message ? <p className={message.includes('sucesso') ? 'success admin-inline-feedback' : 'error admin-inline-feedback'} role="status">{message}</p> : null}{visible.length ? <div className="admin-list notice-admin-list">{visible.map((notice) => <article key={notice.id} className={`admin-list-item ${notice.type.toLowerCase()}`}><div><strong>{notice.title}</strong><span>{siteLabel(notice.site)} · {notice.type} · {notice.enabled ? 'Ativo' : 'Inativo'}</span></div><p>{notice.message}</p>{!compact && canManage ? <div className="list-actions"><button className="soft-button" type="button" onClick={() => openEdit(notice)}>Editar</button><button className="icon-table-action danger" type="button" aria-label="Excluir aviso" onClick={() => setConfirmDelete(notice)}><Trash2 /></button></div> : null}</article>)}</div> : <EmptyState message="Nenhum aviso ativo." />}{open ? <div className="modal-backdrop centered" role="presentation"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="notice-modal-title"><div className="modal-head"><div><span>Comunicados</span><h2 id="notice-modal-title">{editing ? 'Editar aviso' : 'Novo aviso'}</h2></div><button type="button" aria-label="Fechar" onClick={() => setOpen(false)}><X /></button></div><div className="panel-form"><div className="date-grid"><label htmlFor="notice-type">Tipo<select id="notice-type" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="INFO">INFO</option><option value="WARNING">WARNING</option><option value="MAINTENANCE">MAINTENANCE</option><option value="CRITICAL">CRITICAL</option></select></label><label htmlFor="notice-site">Site<select id="notice-site" value={form.site} onChange={(event) => setForm({ ...form, site: event.target.value })}>{siteOptions.map((site) => <option key={site.value} value={site.value}>{site.label}</option>)}</select></label></div><label htmlFor="notice-title">Título<input id="notice-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label htmlFor="notice-message">Mensagem<textarea id="notice-message" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} rows={5} /></label><div className="date-grid"><label htmlFor="notice-start">Início<input id="notice-start" type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label><label htmlFor="notice-end">Término<input id="notice-end" type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label></div><label className="checkline" htmlFor="notice-enabled"><input id="notice-enabled" type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> Aviso habilitado</label><button className="primary admin-save" type="button" onClick={() => void save()} disabled={busy || !siteOptions.length}>{busy ? 'Salvando...' : 'Salvar aviso'}</button></div></section></div> : null}{confirmDelete ? <ConfirmDialog title="Excluir aviso" message={`O aviso "${confirmDelete.title}" será removido do portal. Continuar?`} busy={busy} onCancel={() => setConfirmDelete(null)} onConfirm={() => void remove()} /> : null}</Panel>
}