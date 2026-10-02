import { Check, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { cn } from '@/shared/lib/cn';

/** Radio tile group (fieldset + legend) for choices such as Company vs Store. */
export function ChoiceGroup({ legend, children, className }: { legend: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset>
      <legend className="mb-2.5 text-body font-semibold text-foreground/90">{legend}</legend>
      <div className={cn('grid gap-3', className)}>{children}</div>
    </fieldset>
  );
}

/**
 * One radio tile (Phase C4, Phase D).
 *
 * The chosen state is carried by three things at once: a doubled border, a tinted ground and a filled check
 * mark in the corner marker. That redundancy is deliberate. A tile that announces itself only by turning teal
 * is unreadable to anyone who cannot separate teal from grey, and invisible in a greyscale print of the screen.
 *
 * Phase D removed the `compact` variant and the 2xl step-up. `compact` existed so the registration form could
 * fit this question above five other fields; the question now has a screen to itself, so there is one size.
 * This is the only implementation of an either/or choice in the product; a page must not hand-roll its own.
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
}: {
  field: UseFormRegisterReturn;
  value: string;
  selected: boolean;
  icon: LucideIcon;
  title: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer flex-col gap-3 rounded-2xl border p-4 transition-[border-color,background-color,box-shadow] duration-fast focus-within:shadow-[0_0_0_2px_hsl(var(--primary)/0.18)] sm:p-5',
        selected
          ? 'border-primary bg-primary/[0.06] shadow-[inset_0_0_0_1px_hsl(var(--primary))]'
          : 'border-input bg-subtle/50 hover:border-primary/40',
      )}
    >
      <input type="radio" value={value} className="sr-only" {...field} />
      <span className="flex items-center justify-between">
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors',
            selected ? 'bg-primary text-primary-foreground' : 'border bg-surface text-muted-foreground',
          )}
        >
          <Icon className="size-[1.125rem]" aria-hidden="true" />
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'flex size-5 items-center justify-center rounded-full border transition-colors',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-surface',
          )}
        >
          {selected ? <Check className="size-3" strokeWidth={3} /> : null}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block break-words font-display text-title-sm font-bold leading-tight">{title}</span>
        {badge ? <span className="mt-0.5 block text-caption font-medium text-muted-foreground">{badge}</span> : null}
        {description ? <span className="mt-1 block text-label leading-relaxed text-muted-foreground">{description}</span> : null}
      </span>
      {children}
    </label>
  );
}
