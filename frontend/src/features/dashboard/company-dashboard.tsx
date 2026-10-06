import { Bell, PackageSearch, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useCatalogQuery, type Page } from '@/features/catalog/api';
import { Feedback } from '@/features/catalog/shared';
import type { OrderView } from '@/features/orders/api';
import { useAreaContext } from '@/app/shell/use-area-context';
import { OrgHero } from './org-hero';
import { AccessCard, ReadinessChecklist, TeamCard } from './widgets';
import { Button, Card, PlannedPanel } from '@/shared/ui';

/** TZ §23 onboarding checklist: documents, catalog, price list, delivery zones, first client. */
const READINESS = [
  { key: 'verification', phase: 'P02' },
  { key: 'catalog', phase: 'P04' },
  { key: 'prices', phase: 'P04' },
  { key: 'delivery', phase: 'P08' },
  { key: 'clients', phase: 'P06' },
];

const FINANCE_ROLES = ['OWNER', 'MANAGER'];

/**
 * Company dashboard (TZ §17.2: new orders, receivables, notifications, readiness checklist).
 * Only real data is shown; panels for later phases are explicit empty states.
 */
export function CompanyDashboard() {
  const { t } = useTranslation();
  const { me, membership } = useAreaContext();
  const isOwnerOrManager = FINANCE_ROLES.includes(membership.role);
  const orders = useCatalogQuery<Page<OrderView>>(
    '/orders?status=NEW&status=VIEWED&limit=1',
    membership.organization_id,
    membership.permissions.includes('orders.confirm'),
    30_000,
  );

  return (
    <div className="space-y-6">
      <OrgHero greeting={t('dashboard.company.greeting', { name: me.full_name.split(' ')[0] })} />

      <div className="grid gap-4 lg:grid-cols-3">
        {membership.permissions.includes('orders.confirm') ? (
          <Card className="space-y-3 p-5">
            <h2 className="font-semibold">{t('dashboard.company.newOrders')}</h2>
            <Feedback error={orders.error} />
            <p>{orders.isLoading ? '…' : (orders.data?.count ?? 0)}</p>
            <Button asChild variant="outline">
              <Link to="/company/orders">{t('orders.title')}</Link>
            </Button>
          </Card>
        ) : null}
        {isOwnerOrManager ? (
          <PlannedPanel
            emptyTitle={t('dashboard.pending.title')}
            icon={Wallet}
            title={t('dashboard.company.receivables')}
            description={t('dashboard.company.receivablesEmpty')}
            phase="P09"
          />
        ) : null}
        <PlannedPanel
          emptyTitle={t('dashboard.pending.title')}
          icon={Bell}
          title={t('dashboard.notifications.title')}
          description={t('dashboard.notifications.empty')}
          phase="P11"
        />
      </div>

      {isOwnerOrManager ? (
        <PlannedPanel icon={PackageSearch} title={t('home.company.catalog')} description={t('home.company.catalogText')} phase="P04" />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {isOwnerOrManager ? (
            <ReadinessChecklist membership={membership} steps={READINESS} />
          ) : membership.permissions.includes('orders.view') ? (
            <Card className="space-y-3 p-5">
              <h2 className="font-semibold">{t(`dashboard.company.roleFocus.${membership.role}.title`)}</h2>
              <Button asChild>
                <Link to={membership.role === 'WAREHOUSE' ? '/company/warehouse/orders' : '/company/orders'}>
                  {t(membership.role === 'WAREHOUSE' ? 'orders.warehouseOrders' : 'orders.title')}
                </Link>
              </Button>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <TeamCard membership={membership} />
          <AccessCard membership={membership} />
        </div>
      </div>
    </div>
  );
}
