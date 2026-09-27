import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Card surfaces (DESIGN.md, CR-002): rounded-2xl, hairline border, soft navy depth (`.surface-card`).
 * `interactive` lifts and glows teal on hover; `glass` is the translucent sign-in treatment for chrome-like panels;
 * `inset` is a flat tinted block inside another card.
 */
const cardVariants = cva('', {
  variants: {
    variant: {
      standard: 'surface-card',
      elevated: 'surface-card shadow-panel',
      interactive:
        'surface-card transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_18px_40px_-20px_hsl(var(--primary)/0.45)]',
      glass: 'glass rounded-2xl border shadow-card',
      /* Hero / sign-in panel: large glass surface with deep soft depth. */
      panel: 'glass rounded-[1.75rem] border shadow-panel dark:shadow-[0_40px_100px_-30px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.06)]',
      inset: 'rounded-xl border bg-subtle/50',
      tile: 'rounded-2xl border bg-surface/60 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_18px_40px_-20px_hsl(var(--primary)/0.45)]',
    },
  },
  defaultVariants: { variant: 'standard' },
});

export function Card({ className, variant, ...props }: HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Optional icon tile in front of the title (same treatment as SectionHeader). */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-4">{icon}</span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2 border-t px-5 py-3.5 sm:flex-row sm:justify-end', className)} {...props} />;
}
