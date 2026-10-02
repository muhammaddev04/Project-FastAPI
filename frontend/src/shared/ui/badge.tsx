import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Status chip (DESIGN.md, revised in Phase C5). The one sanctioned pill shape in the product.
 *
 * It no longer shouts. Uppercase, bold and 0.06em tracking made a status the loudest thing in a table row,
 * competing with the data it described, and uppercase is measurably slower to read in Cyrillic because it
 * removes the ascender and descender cues the eye uses for word shape. Sentence case at medium weight stays
 * legible at 11px and lets the row read as a row.
 *
 * Order-pipeline tones (P07) come from the `status-*` tokens and are defined here ready for that phase.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-micro font-medium [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-subtle text-muted-foreground',
        accent: 'border-primary/30 bg-primary/10 text-primary-ink',
        success: 'border-success/25 bg-success-soft text-success-ink',
        warning: 'border-warning/30 bg-warning-soft text-warning-ink',
        danger: 'border-danger/25 bg-danger-soft text-danger-ink',
        info: 'border-info/25 bg-info-soft text-info-ink',
        new: 'border-status-new/25 bg-status-new-soft text-status-new',
        confirmed: 'border-status-confirmed/25 bg-status-confirmed-soft text-status-confirmed',
        assembling: 'border-status-assembling/30 bg-status-assembling-soft text-status-assembling',
        transit: 'border-status-transit/25 bg-status-transit-soft text-status-transit',
        delivered: 'border-status-delivered/25 bg-status-delivered-soft text-status-delivered',
        disputed: 'border-status-disputed/25 bg-status-disputed-soft text-status-disputed',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({
  className,
  tone,
  dot = false,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
