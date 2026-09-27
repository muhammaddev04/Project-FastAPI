import { Bell, ClipboardList, PackageSearch, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { OrgHero } from './org-hero';
import { AccessCard, ReadinessChecklist, TeamCard } from './widgets';
import { PlannedPanel } from '@/shared/ui';

/** TZ §23 onboarding checklist: documents, catalog, price list, delivery zones, first client. */
const READINESS = [
  { key: 'verification', phase: 'P02' },
  { key: 'catalog', phase: 'P04' },
  { key: 'prices', phase: 'P04' },
  { key: 'delivery', phase: 'P08' },
  { key: 'clients', phase: 'P06' },
];

const ORDER_ROLES = ['OWNER', 'MANAGER', 'OPERATOR'];
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

      <div className="grid gap-4 lg:grid-cols-3">
        {ORDER_ROLES.includes(membership.role) ? (
          <PlannedPanel
            emptyTitle={t('dashboard.pending.title')}
            icon={ClipboardList}
            title={t('dashboard.company.newOrders')}
            description={t('dashboard.company.newOrdersEmpty')}
            phase="P07"
          />
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
        <PlannedPanel icon={PackageSearch} title={t('home.company.catalog')} description={t('home.company.catalogText')} phase="P04" ghostTiles={3} />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {isOwnerOrManager ? (
            <ReadinessChecklist membership={membership} steps={READINESS} />
          ) : (
            <PlannedPanel
            emptyTitle={t('dashboard.pending.title')}
              icon={ClipboardList}
              title={t(`dashboard.company.roleFocus.${membership.role}.title`)}
              description={t(`dashboard.company.roleFocus.${membership.role}.text`)}
              phase={membership.role === 'WAREHOUSE' ? 'P05' : 'P07'}
            />
          )}
        </div>
        <div className="space-y-4">
          <TeamCard membership={membership} />
          <AccessCard membership={membership} />
        </div>
      </div>
    </div>
  );
}
