import { FinanceOverviewCard } from '@/features/finance/overview-card';
import { RefreshCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAreaContext } from '@/app/shell/use-area-context';
import { Button, Card } from '@/shared/ui';
import { OrgHero } from './org-hero';
import { AccessCard, ReadinessChecklist, TeamCard } from './widgets';

const READINESS = [
  { key: 'profile', phase: 'P02' },
  { key: 'supplier', phase: 'P06' },
  { key: 'firstOrder', phase: 'P07' },
];

/**
 * Store dashboard (TZ §17.1: my suppliers, a prominent "repeat order" action, upcoming debts).
 * Suppliers, orders and debts open their working screens.
 */
export function StoreDashboard() {
  const { t } = useTranslation();
  const { me, membership } = useAreaContext();
  const isOwner = membership.role === 'OWNER';

  return (
    <div className="space-y-6">
      <OrgHero greeting={t('dashboard.store.greeting', { name: me.full_name.split(' ')[0] })} />

      <Card className="relative flex flex-col gap-4 overflow-hidden p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <RefreshCcw className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold">{t('dashboard.store.repeatTitle')}</p>
            <p className="text-label text-muted-foreground">{t('orders.title')}</p>
          </div>
        </div>
        {membership.permissions.includes('orders.view') && (
          <Button asChild variant="primary" size="lg" className="relative max-sm:w-full">
            <Link to="/store/orders">{t('dashboard.store.repeatAction')}</Link>
          </Button>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {membership.permissions.includes('store_catalog.view') && (
          <Card className="space-y-3 p-5 lg:col-span-2">
            <h2>{t('home.store.catalog')}</h2>
            <Button asChild>
              <Link to="/store/catalog">{t('orders.storeCatalog')}</Link>
            </Button>
          </Card>
        )}
        {membership.permissions.includes('cart.manage') && (
          <Card className="space-y-3 p-5">
            <h2>{t('home.store.cart')}</h2>
            <Button asChild>
              <Link to="/store/cart">{t('orders.openCart')}</Link>
            </Button>
          </Card>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {membership.permissions.includes('partners.view') && (
          <Card className="space-y-3 p-5">
            <h2>{t('dashboard.store.suppliers')}</h2>
            <Button asChild variant="outline">
              <Link to="/store/suppliers">{t('partnerships.suppliers')}</Link>
            </Button>
          </Card>
        )}
        {isOwner ? <FinanceOverviewCard /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {isOwner ? <ReadinessChecklist membership={membership} steps={READINESS} /> : <AccessCard membership={membership} />}
        </div>
        <div className="space-y-4">
          <TeamCard membership={membership} />
          {isOwner ? <AccessCard membership={membership} /> : null}
        </div>
      </div>
    </div>
  );
}
