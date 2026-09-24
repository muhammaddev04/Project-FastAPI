import { Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { Badge, Card, EmptyState, PageHeader } from '@/shared/ui';

/** Courier area (TZ §17.3, P08): today's run. Delivery runs arrive with P08, so this is an honest empty state. */
export function CourierHome() {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        eyebrow={membership.org_name}
        title={t('dashboard.courier.title')}
        actions={<Badge tone="neutral">{t('planned.badge', { phase: 'P08' })}</Badge>}
      />
      <Card>
        <EmptyState icon={Truck} title={t('dashboard.courier.emptyTitle')} description={t('dashboard.courier.emptyText')} className="py-16" />
      </Card>
    </div>
  );
}
