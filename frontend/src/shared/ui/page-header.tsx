import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Page title block (Phase C9).
 *
 * Two things changed. The uppercase pill eyebrow is gone: every value passed to it was location context
 * (the area name, the organization name, "Settings"), which the breadcrumb trail in the shell header
 * already states. Printing it twice in two different typographic styles made the page open with a
 * decoration instead of its subject.
 *
 * And the header no longer dictates the rest of the page. `children` renders beneath the title row inside
 * the same block, so a page that needs tabs, a filter bar or a summary line puts it there and keeps it
 * associated with the heading, rather than every page being forced into
 * title, subtitle, card, card, card.
 *
 * `size="sm"` is for a header inside a panel or a dialog, where the page title already sits above it.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
  size = 'md',
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Contextual actions. The primary one goes last so it sits closest to the content it affects. */
  actions?: ReactNode;
  /** Secondary navigation, filters or a summary line belonging to this heading. */
  children?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <header className={cn('space-y-4', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1
            className={cn(
              'font-display font-semibold tracking-tight text-foreground',
              size === 'sm' ? 'text-body-lg' : 'text-title sm:text-title-lg',
            )}
          >
            {title}
          </h1>
          {description ? <p className="mt-1 max-w-prose text-label leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
