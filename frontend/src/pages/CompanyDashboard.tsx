import { ArrowUpRight, Boxes, ClipboardList, CreditCard, PackageCheck, UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/AppShell';
import type { NavItem } from '../components/AppShell';

export function CompanyDashboard() {
  const { t } = useTranslation();
  const companyNav: NavItem[] = [
    { label: t('dashboard.overview'), path: '/company' },
    { label: t('dashboard.orders'), path: '/company/orders', enabled: false },
    { label: t('dashboard.products'), path: '/company/catalog', enabled: false },
    { label: t('dashboard.partners'), path: '/company/partners', enabled: false },
    { label: t('dashboard.warehouse'), path: '/company/warehouse', enabled: false },
    { label: t('dashboard.delivery'), path: '/company/delivery', enabled: false },
    { label: t('dashboard.finance'), path: '/company/finance', enabled: false },
    { label: t('dashboard.team'), path: '/company/team', enabled: false },
  ];
  const cards = [{ label: t('dashboard.newOrders'), icon: ClipboardList }, { label: t('dashboard.todayDelivery'), icon: PackageCheck }, { label: t('dashboard.receivables'), icon: CreditCard }, { label: t('dashboard.products'), icon: Boxes }];
  return <AppShell area="COMPANY" nav={companyNav}><div className="dashboard-page"><div className="dashboard-heading"><div><p className="dashboard-kicker">{t('dashboard.company')}</p><h1>{t('dashboard.overview')}</h1><p>One place to prepare the supply route between your company and stores.</p></div><button className="outline-action"><ArrowUpRight size={16} /> View setup guide</button></div><section className="metric-grid" aria-label="Company overview"><div className="setup-banner"><div className="setup-banner__mark"><UsersRound size={21} /></div><div><strong>Set up your company workspace</strong><p>Profiles, verification, catalog, and partnerships will appear here as each phase becomes available.</p></div><ArrowUpRight size={18} /></div>{cards.map(({ label: cardLabel, icon: Icon }) => <article className="metric-card" key={cardLabel}><span className="metric-card__icon"><Icon size={18} /></span><span className="metric-card__label">{cardLabel}</span><strong className="metric-card__empty">Awaiting data</strong><small>Connected API data will appear here.</small></article>)}</section><section className="dashboard-lower"><article className="activity-panel"><div className="panel-heading"><div><p className="dashboard-kicker">Operational view</p><h2>Activity feed</h2></div><span className="status-pill">P01 ready</span></div><div className="empty-panel"><ClipboardList size={24} /><strong>No activity yet</strong><p>Once your workspace has members and partnerships, important events will be collected here.</p></div></article><aside className="role-panel"><div className="role-panel__art"><Boxes size={34} /></div><p className="dashboard-kicker">Your next step</p><h2>Build trust before volume.</h2><p>Complete your company profile and verification in the next approved phase.</p><button className="text-action">Open workspace guide <ArrowUpRight size={15} /></button></aside></section></div></AppShell>;
}
