import { type ReactNode, useState } from 'react'
import {
  Clock,
  History,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Megaphone,
  Menu,
  MonitorCheck,
  Radio,
  Settings,
  Ticket,
  UserCog,
  UsersRound,
  Wifi,
  X,
} from 'lucide-react'

import type { AdminMe, AdminSection, AllowedSite, MaintenanceAdmin } from '../types'
import { formatClock, secondsAgo } from '../utils'

export function AdminSidebar({ active, open, onClose, onSelect }: { active: AdminSection; open: boolean; onClose: () => void; onSelect: (section: AdminSection) => void }) {
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem('admin_sidebar_collapsed') === 'true')
  const groups: Array<{ label: string; items: Array<{ id: AdminSection; label: string; icon: ReactNode }> }> = [
    { label: 'Visão geral', items: [{ id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard /> }] },
    { label: 'Acesso', items: [{ id: 'sessions', label: 'Sessões', icon: <MonitorCheck /> }, { id: 'visitors', label: 'Usuários/Visitantes', icon: <UsersRound /> }, { id: 'vouchers', label: 'Vouchers', icon: <Ticket /> }] },
    { label: 'Infraestrutura', items: [{ id: 'sites', label: 'Sites', icon: <MapPinned /> }, { id: 'access-points', label: 'Access Points', icon: <Radio /> }] },
    { label: 'Comunicação', items: [{ id: 'notices', label: 'Avisos', icon: <Megaphone /> }, { id: 'maintenance', label: 'Manutenção', icon: <Clock /> }] },
    { label: 'Administração', items: [{ id: 'admins', label: 'Administradores', icon: <UserCog /> }, { id: 'audit', label: 'Auditoria', icon: <History /> }, { id: 'settings', label: 'Configurações', icon: <Settings /> }] },
  ]
  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    window.localStorage.setItem('admin_sidebar_collapsed', String(next))
  }
  return (
    <>
      <aside className={`admin-sidebar ${open ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`} aria-label="Navegação administrativa">
        <div className="sidebar-brand"><div className="brand-mark"><Wifi /></div><div><strong>Captive Portal</strong><span>Operação Wi-Fi</span></div></div>
        <button className="sidebar-close" type="button" aria-label="Fechar menu" onClick={onClose}><X /></button>
        <button className="collapse-button" type="button" aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} onClick={toggleCollapsed}>{collapsed ? '>' : '<'}</button>
        <nav className="sidebar-nav">
          {groups.map((group) => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.items.map((item) => <button key={item.id} title={collapsed ? item.label : undefined} className={`nav-item ${active === item.id ? 'active' : ''}`} type="button" onClick={() => onSelect(item.id)} aria-current={active === item.id ? 'page' : undefined}>{item.icon}<span>{item.label}</span></button>)}</div>)}
        </nav>
      </aside>
      {open ? <button className="sidebar-backdrop" type="button" aria-label="Fechar menu" onClick={onClose} /> : null}
    </>
  )
}

export function AdminHeader({ admin, maintenance, refreshing, lastUpdatedAt, refreshError, allowedSites, selectedSiteId, onSiteChange, onLogout, onMenu }: { admin: AdminMe | null; maintenance: MaintenanceAdmin | null; refreshing: boolean; lastUpdatedAt: Date | null; refreshError: string; allowedSites: AllowedSite[]; selectedSiteId: string; onSiteChange: (siteId: string) => void; onLogout: () => void; onMenu: () => void }) {
  const isMaintenance = maintenance?.maintenanceActive
  const canUseAll = Boolean(admin?.canSelectAllSites || (admin?.siteIds?.length ?? 0) > 1)
  return (
    <header className="admin-topbar">
      <button className="mobile-menu" type="button" onClick={onMenu} aria-label="Abrir menu administrativo"><Menu /></button>
      <div className="admin-title"><h1>Painel do Portal</h1><p>Visão geral da infraestrutura e dos acessos</p></div>
      <div className="admin-actions">
        <label className="site-selector" htmlFor="admin-site-selector">
          <MapPinned aria-hidden="true" />
          <span>Unidade</span>
          <select id="admin-site-selector" value={selectedSiteId} onChange={(event) => onSiteChange(event.target.value)} aria-label="Selecionar unidade operacional">
            {canUseAll ? <option value="ALL">Todos os sites</option> : null}
            {allowedSites.map((site) => <option key={site.siteId} value={site.siteId}>{site.name}</option>)}
          </select>
        </label>
        <span className={`status-pill ${isMaintenance ? 'warning' : 'ok'}`}><span />{isMaintenance ? 'Manutenção' : 'Operacional'}</span>
        <span className={`live-pill ${refreshError ? 'warning' : 'ok'}`} title={refreshError || undefined}><span />{refreshing ? 'Atualizando...' : refreshError ? `Falha na atualização: ${secondsAgo(lastUpdatedAt)}` : `Ao vivo · ${secondsAgo(lastUpdatedAt)}`}</span>
        <div className="admin-user" aria-label="Administrador autenticado"><strong>{admin?.name ?? 'Administrador'}</strong><span>{admin?.role ?? 'ADMIN'}</span></div>
        <button className="logout-button" onClick={onLogout} type="button"><LogOut /> Sair</button>
      </div>
    </header>
  )
}
export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <header className="page-header"><div><span>Admin</span><h2>{title}</h2><p>{description}</p></div>{action ? <div className="page-actions">{action}</div> : null}</header>
}

export function MaintenanceSummary({ maintenance }: { maintenance: MaintenanceAdmin }) {
  return <section className={`maintenance-summary ${maintenance.maintenanceActive ? 'active' : ''}`}><div><strong>{maintenance.maintenanceActive ? 'Portal em manutenção' : 'Portal funcionando normalmente'}</strong><span>{maintenance.maintenanceScheduled ? `Agendada para ${formatClock(maintenance.maintenanceStartAt)}` : 'Sem janela ativa programada.'}</span></div><Clock /></section>
}