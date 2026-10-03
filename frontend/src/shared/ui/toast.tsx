import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { useToasts } from './toast-store';

const ICON = { success: CheckCircle2, info: Info, warning: AlertTriangle, danger: XCircle } as const;
const ICON_CLASS = {
  success: 'bg-success/10 text-success',
  info: 'bg-primary/10 text-primary',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
};

/** Glass toasts bottom-right (bottom-center on phones), announced politely to screen readers. */
export function Toaster() {
  const { t } = useTranslation();
  const items = useToasts((state) => state.items);
  const dismiss = useToasts((state) => state.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-end sm:p-6"
    >
      {items.map((item) => {
        const Icon = ICON[item.tone];
        return (
          <div
            key={item.id}
            role={item.tone === 'danger' ? 'alert' : 'status'}
            className="chrome pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-2xl border p-3.5 shadow-pop"
          >
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-xl', ICON_CLASS[item.tone])}>
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-body font-semibold">{item.title}</p>
              {item.description ? <p className="mt-0.5 text-label text-muted-foreground">{item.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label={t('common.close')}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-subtle hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
