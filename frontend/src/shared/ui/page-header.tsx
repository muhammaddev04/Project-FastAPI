import type { ReactNode } from 'react';

/**
 * Page title block (DESIGN.md page structure): brand pill eyebrow (as on the sign-in card), Montserrat title,
 * muted description and actions that wrap under the title on phones.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-primary-ink">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-[1.5rem] font-bold leading-tight text-foreground sm:text-[1.875rem]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-[0.875rem] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
