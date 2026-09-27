import { AlertOctagon, Inbox, ShieldX, type LucideIcon } from 'lucide-react';
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

function StateFrame({ icon: Icon = Inbox, title, description, action, className, tone = 'neutral' }: StateProps & { tone?: 'neutral' | 'danger' }) {
  return (
    <div className={cn('flex animate-fade-in flex-col items-center px-6 py-10 text-center', className)}>
      <span
        className={cn(
          'relative mb-4 flex size-14 items-center justify-center rounded-2xl border',
          tone === 'danger'
            ? 'border-danger/20 bg-danger-soft text-danger'
            : 'border-primary/20 bg-primary/10 text-primary shadow-[0_14px_30px_-18px_hsl(var(--primary)/0.8)]',
        )}
      >
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <p className="font-display text-base font-bold text-foreground">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** FE-001 empty state. */
export function EmptyState(props: StateProps) {
  return <StateFrame {...props} />;
}

/** FE-001 error state with retry. */
export function ErrorState({ message, onRetry, className }: { message?: ReactNode; onRetry?: () => void; className?: string }) {
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
    />
  );
}

/** FE-001 forbidden state. */
export function ForbiddenState({ action, className }: { action?: ReactNode; className?: string }) {
  const { t } = useTranslation();
  return (
    <StateFrame
      icon={ShieldX}
      title={t('states.forbiddenTitle')}
      description={t('states.forbiddenDescription')}
      action={action}
      className={className}
    />
  );
}
