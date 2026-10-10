import { FinanceOverviewCard } from '@/features/finance/overview-card';
import { BarChart3, PackageSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAreaContext } from '@/app/shell/use-area-context';
import { CompanyFigures } from './figures';
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

  return (
    <div className="space-y-6">
      <OrgHero greeting={t('dashboard.company.greeting', { name: me.full_name.split(' ')[0] })} />

      {/* P12 §1.3: the day's figures, each linking to the screen that acts on it. */}
      <CompanyFigures />

      <div className="grid gap-4 lg:grid-cols-3">
        {isOwnerOrManager ? <FinanceOverviewCard /> : null}
        {membership.permissions.includes('reports.sales') ? (
          <Card className="space-y-3 p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <BarChart3 className="size-4" aria-hidden="true" />
              {t('reports.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('reports.description')}</p>
            <Button asChild variant="outline">
              <Link to="/company/reports">{t('reports.open')}</Link>
            </Button>
          </Card>
        ) : null}
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
