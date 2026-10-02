import { AlertOctagon, Clock, Inbox, SearchX, ShieldX, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Button } from './button';

type StateProps = {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/**
 * The six states every page owes the person looking at it (FE-001, Phase C7): empty, no results, error,
 * forbidden, unavailable, loading. One frame renders all of them so they cannot drift apart.
 *
 * Deliberately restrained. The icon is a 36px glyph in a muted square, not a 56px tile with a teal glow
 * behind it: an empty table is a routine condition, and decorating it implies something went wrong. There
 * are no illustrations, because an illustration would need three translations' worth of nothing to say.
 *
 * `compact` is for a state inside a card or a table body, where the surrounding chrome already provides the
 * padding and a 10rem-tall empty state would push the page around.
 */
function StateFrame({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  tone = 'neutral',
  compact = false,
}: StateProps & { tone?: 'neutral' | 'danger'; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center px-6 text-center', compact ? 'py-8' : 'py-12', className)}>
      <span
        className={cn(
          'mb-3 flex size-9 items-center justify-center rounded-xl',
          tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-[1.125rem]" aria-hidden="true" />
      </span>
      <p className="text-body-lg font-semibold text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-label leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Nothing exists yet. The action should be the thing that creates the first one. */
export function EmptyState(props: StateProps & { compact?: boolean }) {
  return <StateFrame {...props} />;
}

/**
 * Records exist, but none match the current search or filters. Distinct from `EmptyState` on purpose: the
 * useful next step is to widen the query, not to create something.
 *
 * Defaults to the `table.*` wording the product already ships in all three languages rather than a second
 * set of keys for the same sentence. `action` lets a caller pass the reset control it already renders, so
 * the affordance is identical in the toolbar and here.
 */
export function NoResultsState({
  title,
  description,
  onClear,
  action,
  className,
  compact,
}: {
  title?: ReactNode;
  description?: ReactNode;
  onClear?: () => void;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <StateFrame
      icon={SearchX}
      title={title ?? t('table.noMatches')}
      description={description ?? t('table.noMatchesHint')}
      action={
        action ??
        (onClear ? (
          <Button variant="secondary" size="sm" onClick={onClear}>
            {t('table.resetFilters')}
          </Button>
        ) : undefined)
      }
      className={className}
      compact={compact}
    />
  );
}

/** A request failed. Always offers the retry, because the usual cause is transient. */
export function ErrorState({
  message,
  onRetry,
  className,
  compact,
}: {
  message?: ReactNode;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <StateFrame
      icon={AlertOctagon}
      tone="danger"
      title={t('states.errorTitle')}
      description={message ?? t('errors.generic')}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : undefined
      }
      className={className}
      compact={compact}
    />
  );
}

/** The role lacks the permission. Names who can grant it rather than just refusing. */
export function ForbiddenState({ action, className, compact }: { action?: ReactNode; className?: string; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <StateFrame
      icon={ShieldX}
      title={t('states.forbiddenTitle')}
      description={t('states.forbiddenDescription')}
      action={action}
      className={className}
      compact={compact}
    />
  );
}

/** A dependency is down or a feature is switched off server-side. Not the same as forbidden. */
export function UnavailableState({
  description,
  action,
  className,
  compact,
}: {
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <StateFrame
      icon={Clock}
      title={t('states.unavailableTitle')}
      description={description ?? t('states.unavailableDescription')}
      action={action}
      className={className}
      compact={compact}
    />
  );
}
