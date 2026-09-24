import { Bell, ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';
import { primaryMembership } from '../lib/types';
import { BrandMark } from './BrandMark';
import { LanguageSwitcher } from './LanguageSwitcher';

export type NavItem = { label: string; path: string; enabled?: boolean };

export function AppShell({ area, nav, children }: { area: 'COMPANY' | 'STORE'; nav: NavItem[]; children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const membership = primaryMembership(user);
  const title = area === 'COMPANY' ? t('dashboard.company') : t('dashboard.store');

  return <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}`}>
    <aside className={`app-sidebar${mobileOpen ? ' app-sidebar--open' : ''}`}>
      <div className="app-sidebar__top"><BrandMark compact /><button className="sidebar-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
      <div className="workspace-switcher"><span className="workspace-switcher__avatar">{area === 'COMPANY' ? 'C' : 'S'}</span><span><strong>{membership?.organization_name ?? title}</strong><small>{membership?.role ?? 'OWNER'}</small></span><ChevronDown size={15} /></div>
      <nav className="app-nav" aria-label={`${title} navigation`}>
        {nav.map((item) => <button key={item.path} className={`app-nav__item${item.enabled === false ? ' app-nav__item--disabled' : ''}`} disabled={item.enabled === false} onClick={() => { setMobileOpen(false); if (item.enabled !== false) navigate(item.path); }}><span className="app-nav__dot" />{item.label}{item.enabled === false ? <small>Later</small> : null}</button>)}
      </nav>
      <div className="sidebar-footer"><button className="app-nav__item" onClick={() => navigate(area === 'COMPANY' ? '/company/settings' : '/store/settings')}><span className="app-nav__dot" />{t('dashboard.settings')}</button><button className="app-nav__item" onClick={() => void logout().then(() => navigate('/login', { replace: true }))}><span className="app-nav__dot" />{t('common.signOut')}</button></div>
    </aside>
    {mobileOpen ? <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}
    <div className="app-main"><header className="app-header"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><button className="collapse-menu" aria-label="Toggle sidebar" onClick={() => setCollapsed((value) => !value)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><div className="app-search"><Search size={16} /><input aria-label="Search" placeholder="Search your workspace" /></div><div className="app-header__actions"><LanguageSwitcher /><button className="header-icon" aria-label={t('dashboard.notifications')}><Bell size={18} /><span /></button><div className="user-chip"><span>{user?.full_name.slice(0, 1).toUpperCase()}</span><strong>{user?.full_name}</strong></div></div></header><main className="app-content">{children}</main></div>
  </div>;
}
