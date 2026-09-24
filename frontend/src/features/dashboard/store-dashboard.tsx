import { Building2, CalendarClock, RefreshCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { Badge, Button, Card, PageHeader } from '@/shared/ui';
import { AccessCard, PendingPanel, ReadinessChecklist, TeamCard } from './widgets';

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
      <PageHeader
        eyebrow={t('shell.areas.store')}
        title={membership.org_name}
        description={t('dashboard.store.greeting', { name: me.full_name.split(' ')[0] })}
        actions={<Badge tone="accent">{t(`roles.${membership.role}`)}</Badge>}
      />

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <RefreshCcw className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold">{t('dashboard.store.repeatTitle')}</p>
            <p className="text-[0.8125rem] text-muted-foreground">{t('dashboard.store.repeatText')}</p>
          </div>
        </div>
        <Button variant="accent" size="lg" disabled aria-describedby="repeat-order-note">
          {t('dashboard.store.repeatAction')}
        </Button>
        <span id="repeat-order-note" className="sr-only">
          {t('planned.badge', { phase: 'P07' })}
        </span>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <PendingPanel
          icon={Building2}
          title={t('dashboard.store.suppliers')}
          description={t('dashboard.store.suppliersEmpty')}
          phase="P06"
        />
        {isOwner ? (
          <PendingPanel
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
