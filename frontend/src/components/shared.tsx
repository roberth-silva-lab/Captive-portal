import type { ReactNode } from 'react'

import { LockKeyhole } from 'lucide-react'

export function Panel({ title, icon, children, compact = false }: { title: string; icon: ReactNode; children: ReactNode; compact?: boolean }) {
  return <section className={`ops-panel ${compact ? 'compact' : ''}`}><div className="panel-title">{icon}<h2>{title}</h2></div>{children}</section>
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state"><LockKeyhole /><p>{message}</p></div>
}

export function InfoLine({ label, value }: { label: string; value?: string }) {
  return <div className="info-line"><span>{label}</span><strong>{value || '-'}</strong></div>
}

export function InfoTile({ title, value, detail, icon }: { title: string; value: string; detail: string; icon: ReactNode }) {
  return <article className="info-tile"><div className="metric-icon">{icon}</div><span>{title}</span><strong>{value}</strong><p>{detail}</p></article>
}

export function ConfirmDialog({ title, message, busy, confirmLabel = 'Encerrar acesso', onCancel, onConfirm }: { title: string; message: string; busy: boolean; confirmLabel?: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" role="presentation"><section className="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{message}</p><div className="confirm-actions"><button type="button" onClick={onCancel} disabled={busy}>Cancelar</button><button className="danger-button" type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Processando...' : confirmLabel}</button></div></section></div>
}