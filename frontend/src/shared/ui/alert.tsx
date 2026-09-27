import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/** Inline alerts: rounded-xl tinted panel with a status icon tile (success / info / warning / danger). */
const styles = {
  info: { box: 'border-border bg-subtle/70', icon: Info, iconClass: 'bg-primary/10 text-primary' },
  success: { box: 'border-success/25 bg-success-soft', icon: CheckCircle2, iconClass: 'bg-success/10 text-success' },
  warning: { box: 'border-warning/30 bg-warning-soft', icon: AlertTriangle, iconClass: 'bg-warning/10 text-warning' },
  danger: { box: 'border-danger/25 bg-danger-soft', icon: XCircle, iconClass: 'bg-danger/10 text-danger' },
  /* Teal notice for guidance in a flow ("we sent a code to …"). */
  brand: { box: 'border-primary/20 bg-primary/[0.08]', icon: Info, iconClass: 'bg-primary/15 text-primary' },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  icon,
  className,
}: {
  tone?: keyof typeof styles;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Replaces the tone's icon (e.g. a mail icon or a spinner). */
  icon?: ReactNode;
  className?: string;
}) {
  const { box, icon: Icon, iconClass } = styles[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex animate-fade-in flex-wrap items-start gap-3 rounded-xl border px-3.5 py-3 text-[0.8125rem] leading-5 text-foreground', box, className)}
    >
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4', iconClass)}>
        {icon ?? <Icon aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1 basis-0 space-y-0.5 pt-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(tone === 'brand' ? 'text-foreground/85' : 'text-muted-foreground', 'break-words')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center max-sm:ml-10 max-sm:basis-full">{action}</div> : null}
    </div>
  );
}
