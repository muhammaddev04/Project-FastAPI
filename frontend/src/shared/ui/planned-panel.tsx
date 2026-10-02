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
 * With `ghostTiles` it sketches the shape of the content (dashed tiles); otherwise it shows a centered state.
 */
export function PlannedPanel({
  icon: Icon,
  title,
  description,
  phase,
  emptyTitle,
  ghostTiles = 0,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description: ReactNode;
  phase: string;
  /** Short headline of the centered state (e.g. "Nothing to show yet"). */
  emptyTitle?: ReactNode;
  ghostTiles?: number;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="px-5 pt-5">
        <SectionHeader icon={Icon} title={title} chip={<PhaseBadge phase={phase} />} />
      </div>
      {ghostTiles > 0 ? (
        <div className="flex-1 px-5 pb-5">
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3" aria-hidden="true">
            {Array.from({ length: ghostTiles }, (_, index) => (
              <div
                key={index}
                className={cn(
                  'h-24 rounded-xl border border-dashed border-border bg-gradient-to-br from-subtle/80 to-transparent sm:h-28',
                  index > 1 && 'hidden md:block',
                )}
              />
            ))}
          </div>
          {emptyTitle ? <p className="mt-4 text-sm font-semibold">{emptyTitle}</p> : null}
          <p className={cn('text-label text-muted-foreground', emptyTitle ? 'mt-1' : 'mt-4')}>{description}</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-7 pt-5 text-center">
          <span className="mb-3 flex size-11 items-center justify-center rounded-2xl border border-dashed border-primary/30 bg-primary/5 text-primary/80">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          {emptyTitle ? <p className="font-display text-body-lg font-bold">{emptyTitle}</p> : null}
          <p className="mt-1 max-w-xs text-label leading-relaxed text-muted-foreground">{description}</p>
        </div>
      )}
    </Card>
  );
}
