import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router-dom';
import { useAreaContext } from '@/app/shell/use-area-context';
import { canSee, findItem } from '@/app/shell/nav-config';
import { areaFor } from '@/shared/auth/context';
import { Card, EmptyState, ForbiddenState, PageHeader, PhaseBadge } from '@/shared/ui';

/**
 * Placeholder for a navigation entry whose TZ phase has not been built yet. It states what the module will do
 * and when, and never shows sample data.
 */
export function PlannedModulePage() {
  const { t } = useTranslation();
  const { module = '' } = useParams();
  const { membership } = useAreaContext();
  const area = areaFor(membership);
  const item = findItem(area, module);

  if (!item || !item.phase) return <Navigate to="/404" replace />;
  if (!canSee(item, membership)) return <ForbiddenState className="py-24" />;

  const Icon = item.icon;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t(`nav.${area}.${item.key}`)}
        description={t(`planned.${area}.${item.key}`)}
        actions={<PhaseBadge phase={item.phase} />}
      />
      <Card className="relative overflow-hidden">
        <EmptyState
          icon={Icon}
          title={t('planned.title', { phase: item.phase })}
          description={t('planned.description')}
          action={
            <span className="inline-flex items-center gap-2 rounded-full border bg-surface/70 px-3.5 py-1.5 text-label font-medium text-muted-foreground">
              <CalendarClock className="size-4 text-primary" aria-hidden="true" />
              {t(`planned.phases.${item.phase}`)}
            </span>
          }
          className="relative py-16 sm:py-20"
        />
      </Card>
    </div>
  );
}
