import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertTriangle, X, type LucideIcon } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Button } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Dialog panel (DESIGN.md Tier 4): navy scrim, chrome rounded-2xl panel that rises in; focus is trapped and Escape
 * closes (Radix). On phones it becomes a bottom sheet.
 */
export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(({ className, children, hideClose = false, ...props }, ref) => {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade bg-brand-navy/60 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        ref={ref}
        // Focus the panel itself on open (keyboard users tab from there) instead of ringing the close button.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        tabIndex={-1}
        className={cn(
          'chrome fixed inset-x-0 bottom-0 z-50 max-h-[92vh] animate-fade overflow-y-auto rounded-t-2xl border p-5 shadow-pop focus:outline-none',
          'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" className="absolute right-3 top-3 size-9 text-muted-foreground" aria-label={t('common.close')}>
              <X />
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = 'DialogContent';

export function DialogHeader({ icon: Icon, tone = 'primary', title, description }: { icon?: LucideIcon; tone?: 'primary' | 'danger' | 'warning'; title: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 pr-8">
      {Icon ? (
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl',
            tone === 'danger' ? 'bg-danger/10 text-danger' : tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
      ) : null}
      <div className="min-w-0">
        <DialogPrimitive.Title className="font-display text-lg font-bold leading-snug">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-body leading-relaxed text-muted-foreground">{description}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
      </div>
    </div>
  );
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}>{children}</div>;
}

/**
 * FE-002 / FE-003 confirmation: preview → confirm → result. `tone="danger"` for destructive actions; the body can
 * repeat the object's name or amount.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  icon,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  tone?: 'primary' | 'danger' | 'warning';
  icon?: LucideIcon;
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => (loading ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader icon={icon ?? (tone === 'primary' ? undefined : AlertTriangle)} tone={tone} title={title} description={description} />
        {children ? <div className="mt-4">{children}</div> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
