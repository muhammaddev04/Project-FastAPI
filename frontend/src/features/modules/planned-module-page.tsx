import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router-dom';
import { useAreaContext } from '@/app/shell/use-area-context';
import { canSee, findItem } from '@/app/shell/nav-config';
import { areaFor } from '@/shared/auth/context';
import { Badge, Card, EmptyState, ForbiddenState, PageHeader } from '@/shared/ui';

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
        eyebrow={t(`shell.areas.${area}`)}
        title={t(`nav.${area}.${item.key}`)}
        description={t(`planned.${area}.${item.key}`)}
        actions={<Badge tone="neutral">{t('planned.badge', { phase: item.phase })}</Badge>}
      />
      <Card>
        <EmptyState
          icon={Icon}
          title={t('planned.title', { phase: item.phase })}
          description={t('planned.description')}
          action={
            <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
              <CalendarClock className="size-4" aria-hidden="true" />
              {t(`planned.phases.${item.phase}`)}
            </span>
          }
          className="py-16"
        />
      </Card>
    </div>
  );
}
