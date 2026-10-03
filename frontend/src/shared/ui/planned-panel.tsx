import { Clock3, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Badge } from './badge';
import { Card } from './card';
import { SectionHeader } from './profile';

/** The phase chip of a module that a later TZ part delivers (e.g. "P07"). */
export function PhaseBadge({ phase }: { phase: string }) {
  const { t } = useTranslation();
  return (
    <Badge tone="neutral">
      <Clock3 aria-hidden="true" />
      {t('planned.badge', { phase })}
    </Badge>
  );
}

/**
 * A module of a later TZ phase, drawn in its final place but without sample data (FE-001 empty state).
 *
 * The `ghostTiles` option is gone. It drew dashed placeholder rectangles to sketch the shape of the content
 * that would eventually arrive, which is a mock of a feature rather than an honest statement that the feature
 * is not built. What remains says what the module will do and which phase delivers it.
 */
export function PlannedPanel({
  icon: Icon,
  title,
  description,
  phase,
  emptyTitle,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description: ReactNode;
  phase: string;
  /** Short headline of the centered state (e.g. "Nothing to show yet"). */
  emptyTitle?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('workspace-planned flex flex-col', className)}>
      <div className="px-5 pt-5">
        <SectionHeader icon={Icon} title={title} chip={<PhaseBadge phase={phase} />} />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-6 pt-4 text-center">
        <span className="mb-3 flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Icon className="size-[1.125rem]" aria-hidden="true" />
        </span>
        {emptyTitle ? <p className="text-body-lg font-semibold">{emptyTitle}</p> : null}
        <p className="mt-1 max-w-xs text-label leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </Card>
  );
}
