import { Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, PageHeader, PhaseBadge } from '@/shared/ui';

/** Courier area (TZ §17.3, P08): today's run. Delivery runs arrive with P08, so this is an honest empty state. */
export function CourierHome() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title={t('dashboard.courier.title')}
        actions={<PhaseBadge phase="P08" />}
      />
      <Card>
        <EmptyState icon={Truck} title={t('dashboard.courier.emptyTitle')} description={t('dashboard.courier.emptyText')} className="py-16" />
      </Card>
    </div>
  );
}
