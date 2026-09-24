import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

/** DESIGN.md status chip: the only pill shape in the system, uppercase label-sm with an optional beacon dot. */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold uppercase leading-[0.875rem] tracking-[0.03em]',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-subtle text-muted-foreground',
        accent: 'border-primary/20 bg-primary-soft text-primary',
        success: 'border-success/20 bg-success-soft text-success',
        warning: 'border-warning/25 bg-warning-soft text-warning',
        danger: 'border-danger/20 bg-danger-soft text-danger',
        info: 'border-info/20 bg-info-soft text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

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
