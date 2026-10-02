import { Check, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { cn } from '@/shared/lib/cn';

/** Radio tile group (fieldset + legend) for choices such as Company vs Store. */
export function ChoiceGroup({ legend, children, size = 'md', className }: { legend: ReactNode; children: ReactNode; size?: 'md' | 'lg'; className?: string }) {
  return (
    <fieldset>
      <legend className={cn('mb-2.5 text-foreground/90', size === 'lg' ? 'text-body-lg font-medium 2xl:mb-3 2xl:text-lg' : 'text-body font-semibold')}>{legend}</legend>
      <div className={cn('grid gap-3', className)}>{children}</div>
    </fieldset>
  );
}

/**
 * One radio tile: rounded-2xl card that turns teal with a soft glow when chosen. The icon tile takes the entity
 * gradient of the choice (company teal, store sky) so the identity is visible before the organization exists.
 * `compact` is the one-line tile of the sign-in form; the default shows the description and details.
 */
export function ChoiceCard({
  field,
  value,
  selected,
  icon: Icon,
  title,
  badge,
  description,
  children,
  entity,
  compact = false,
}: {
  field: UseFormRegisterReturn;
  value: string;
  selected: boolean;
  icon: LucideIcon;
  title: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  entity?: 'company' | 'store';
  compact?: boolean;
}) {
  const fill = entity === 'store' ? 'from-brand-sky to-brand-blue' : 'from-brand-light to-brand';
  return (
    <label
      className={cn(
        'relative flex cursor-pointer rounded-2xl border transition-[border-color,background-color,box-shadow,transform] duration-200 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.2)] active:scale-[0.99]',
        compact ? 'items-center gap-2.5 px-2.5 py-3 sm:gap-3 sm:px-3.5 2xl:gap-4 2xl:rounded-2xl 2xl:px-5 2xl:py-4 short:py-1.5 short:2xl:py-3' : 'flex-col gap-3 p-4 sm:p-5',
        selected
          ? 'border-primary/70 bg-primary/[0.07] shadow-[0_16px_34px_-24px_hsl(var(--primary)/0.9)]'
          : 'border-input bg-subtle/50 hover:-translate-y-0.5 hover:border-primary/40',
      )}
    >
      <input type="radio" value={value} className="sr-only" {...field} />
      <span className={cn('flex items-center', compact ? '' : 'justify-between')}>
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-xl transition-colors',
            compact ? 'size-8 sm:size-9 2xl:size-11' : 'size-11',
            selected ? cn('bg-gradient-to-br text-white', fill) : 'border bg-surface text-muted-foreground',
          )}
        >
          <Icon className="size-[1.125rem]" aria-hidden="true" />
        </span>
        {compact ? null : (
          <span
            aria-hidden="true"
            className={cn(
              'flex size-5 items-center justify-center rounded-full border transition-colors',
              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-surface',
            )}
          >
            {selected ? <Check className="size-3" /> : null}
          </span>
        )}
      </span>
      <span className="min-w-0">
        <span className={cn('block break-words font-semibold leading-tight', compact ? 'text-label sm:text-body 2xl:text-title-sm' : 'font-display text-base font-bold')}>
          {title}
        </span>
        {badge ? <span className="block text-micro font-medium text-muted-foreground 2xl:text-body">{badge}</span> : null}
        {description ? <span className="mt-1 block text-label leading-relaxed text-muted-foreground">{description}</span> : null}
      </span>
      {children}
      {compact && selected ? <Check className="absolute right-2.5 top-2.5 size-3.5 text-primary" aria-hidden="true" /> : null}
    </label>
  );
}
