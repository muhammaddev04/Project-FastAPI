import { ArrowUpRight, ClipboardList, CreditCard, Store, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/AppShell';
import type { NavItem } from '../components/AppShell';

export function StoreDashboard() {
  const { t } = useTranslation();
  const storeNav: NavItem[] = [
    { label: t('dashboard.overview'), path: '/store' },
    { label: t('dashboard.suppliers'), path: '/store/suppliers', enabled: false },
    { label: t('dashboard.catalog'), path: '/store/catalog', enabled: false },
    { label: t('dashboard.orders'), path: '/store/orders', enabled: false },
    { label: t('dashboard.delivery'), path: '/store/delivery', enabled: false },
    { label: t('dashboard.debt'), path: '/store/finance', enabled: false },
  ];
  const cards = [{ label: t('dashboard.activeOrders'), icon: ClipboardList }, { label: t('dashboard.todayDelivery'), icon: Truck }, { label: t('dashboard.debt'), icon: CreditCard }, { label: t('dashboard.suppliers'), icon: Store }];
  return <AppShell area="STORE" nav={storeNav}><div className="dashboard-page"><div className="dashboard-heading"><div><p className="dashboard-kicker">{t('dashboard.store')}</p><h1>{t('dashboard.overview')}</h1><p>{t('dashboard.connectedSupply')} — your order and supplier context in one view.</p></div><button className="outline-action"><ArrowUpRight size={16} /> Explore workspace</button></div><section className="metric-grid" aria-label="Store overview"><div className="setup-banner setup-banner--store"><div className="setup-banner__mark"><Store size={21} /></div><div><strong>Connect your first supplier</strong><p>Supplier relationships, catalog access, orders, delivery, and debt will appear here when partnerships are active.</p></div><ArrowUpRight size={18} /></div>{cards.map(({ label: cardLabel, icon: Icon }) => <article className="metric-card" key={cardLabel}><span className="metric-card__icon metric-card__icon--store"><Icon size={18} /></span><span className="metric-card__label">{cardLabel}</span><strong className="metric-card__empty">Awaiting data</strong><small>Connected API data will appear here.</small></article>)}</section><section className="dashboard-lower"><article className="activity-panel"><div className="panel-heading"><div><p className="dashboard-kicker">Order rhythm</p><h2>Recent orders</h2></div><span className="status-pill status-pill--store">P01 ready</span></div><div className="empty-panel"><ClipboardList size={24} /><strong>No orders yet</strong><p>Your active suppliers and order history will be visible here after the partnership phase.</p></div></article><aside className="role-panel role-panel--store"><div className="role-panel__art"><Truck size={34} /></div><p className="dashboard-kicker">Store first step</p><h2>Know who supplies you.</h2><p>When partnerships arrive, your catalog, cart, delivery, and debt will stay connected.</p><button className="text-action">View store guide <ArrowUpRight size={15} /></button></aside></section></div></AppShell>;
}
