import type { ReactNode } from 'react';

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
    <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-primary">{eyebrow}</p> : null}
        <h1 className="font-display text-[1.375rem] font-semibold leading-7 text-foreground sm:text-[1.75rem] sm:leading-9">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[0.8125rem] text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
