import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

const styles = {
  info: { box: 'border-border bg-subtle', icon: Info, iconClass: 'text-muted-foreground' },
  success: { box: 'border-success/25 bg-success-soft', icon: CheckCircle2, iconClass: 'text-success' },
  warning: { box: 'border-warning/25 bg-warning-soft', icon: AlertTriangle, iconClass: 'text-warning' },
  danger: { box: 'border-danger/25 bg-danger-soft', icon: XCircle, iconClass: 'text-danger' },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof styles;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { box, icon: Icon, iconClass } = styles[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex animate-fade-in gap-3 rounded-md border px-3.5 py-3 text-[0.8125rem] leading-5 text-foreground', box, className)}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
