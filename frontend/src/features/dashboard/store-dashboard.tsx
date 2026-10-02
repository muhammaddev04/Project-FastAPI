import { Building2, CalendarClock, PackageSearch, RefreshCcw, ShoppingCart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { Button, Card, PlannedPanel } from '@/shared/ui';
import { OrgHero } from './org-hero';
import { AccessCard, ReadinessChecklist, TeamCard } from './widgets';

const READINESS = [
  { key: 'profile', phase: 'P02' },
  { key: 'supplier', phase: 'P06' },
  { key: 'firstOrder', phase: 'P07' },
];

/**
 * Store dashboard (TZ §17.1: my suppliers, a prominent "repeat order" action, upcoming debts).
 * Suppliers, ordering and debts come with P06/P07/P09, so those panels are honest empty states.
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
            <p className="text-label text-muted-foreground">{t('dashboard.store.repeatText')}</p>
          </div>
        </div>
        <Button variant="brand" size="lg" disabled aria-describedby="repeat-order-note" className="relative max-sm:w-full">
          {t('dashboard.store.repeatAction')}
        </Button>
        <span id="repeat-order-note" className="sr-only">
          {t('planned.badge', { phase: 'P07' })}
        </span>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <PlannedPanel
          icon={PackageSearch}
          title={t('home.store.catalog')}
          description={t('home.store.catalogText')}
          phase="P04"
          ghostTiles={6}
          className="lg:col-span-2"
        />
        <PlannedPanel icon={ShoppingCart} title={t('home.store.cart')} description={t('home.store.cartText')} phase="P07" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PlannedPanel
            emptyTitle={t('dashboard.pending.title')}
          icon={Building2}
          title={t('dashboard.store.suppliers')}
          description={t('dashboard.store.suppliersEmpty')}
          phase="P06"
        />
        {isOwner ? (
          <PlannedPanel
            emptyTitle={t('dashboard.pending.title')}
            icon={CalendarClock}
            title={t('dashboard.store.debts')}
            description={t('dashboard.store.debtsEmpty')}
            phase="P09"
          />
        ) : null}
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
