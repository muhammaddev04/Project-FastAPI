import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Card surfaces (DESIGN.md, CR-002 revision).
 *
 * This had seven variants, of which only `standard` was ever used: `elevated`, `interactive`, `chrome`,
 * `panel` and `tile` had zero call sites between them and existed to offer frosted panels and hover
 * lift-and-glow effects. They are gone, and with them the last of the Card-level glassmorphism.
 *
 * What remains is the distinction that actually carries meaning: a card is a raised surface, an inset is a
 * recessed block inside one. `interactive` is kept for the one case where elevation has to answer the
 * pointer, and it shifts border and background rather than translating the element, so a grid of cards
 * cannot jitter under the cursor.
 */
const cardVariants = cva('', {
  variants: {
    variant: {
      standard: 'surface-card',
      interactive: 'surface-card transition-[border-color,background-color] duration-200 hover:border-primary/40 hover:bg-subtle/40',
      inset: 'rounded-xl border bg-subtle/50',
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
          <h2 className="text-body-lg font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-0.5 text-label text-muted-foreground">{description}</p> : null}
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
