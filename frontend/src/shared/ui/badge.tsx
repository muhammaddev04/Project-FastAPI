import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium uppercase tracking-wide',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-subtle text-muted-foreground',
        accent: 'border-transparent bg-accent-soft text-accent',
        success: 'border-transparent bg-success-soft text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
        danger: 'border-transparent bg-danger-soft text-danger',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
