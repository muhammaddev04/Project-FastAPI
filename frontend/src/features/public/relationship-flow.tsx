import { Building2, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Availability } from './primitives';

/**
 * Company, TezFarmo, Store: the one picture the product is about (Phase E).
 *
 * Built from real interface parts and hairlines, not an illustration and not a screenshot. A mocked dashboard
 * would be the single thing on this page a visitor could catch us on after signing up, and an abstract graphic
 * would say nothing. There are no invented company names, order numbers or amounts anywhere in it: the content
 * is the vocabulary itself, which is the honest version of a product visual for a product this early.
 *
 * Teal appears once, on the partnership, because that is the thing the two parties have in common and the one
 * relationship the diagram is actually about. Everything else is ink and hairline.
 */

/** One party plate: who they are, and the two things they bring. */
function Party({
  side,
  icon: Icon,
  align = 'start',
}: {
  side: 'company' | 'store';
  icon: typeof Building2;
  align?: 'start' | 'end';
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('rounded-2xl border bg-surface p-5 sm:p-6', align === 'end' && 'lg:text-right')}>
      <div className={cn('flex items-center gap-3', align === 'end' && 'lg:flex-row-reverse')}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-subtle text-foreground/70">
          <Icon className="size-[1.125rem]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-body font-semibold">{t(`site.flow.${side}.title`)}</p>
          <p className="truncate text-caption text-muted-foreground">{t(`site.flow.${side}.role`)}</p>
        </div>
      </div>
      <dl className={cn('mt-5 space-y-2.5 border-t pt-4', align === 'end' && 'lg:text-right')}>
        {(['brings', 'needs'] as const).map((row) => (
          <div key={row}>
            <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {t(`site.flow.${row}`)}
            </dt>
            <dd className="text-label leading-snug text-foreground/85">{t(`site.flow.${side}.${row}`)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function RelationshipFlow() {
  const { t } = useTranslation();
  /** The exchange, in the order it happens. Only the agreement itself is in the product today. */
  const steps = [
    { key: 'partnership', state: 'live' as const },
    { key: 'catalog', state: 'planned' as const },
    { key: 'order', state: 'planned' as const },
    { key: 'delivery', state: 'planned' as const },
    { key: 'ledger', state: 'planned' as const },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:gap-8">
      <Party side="company" icon={Building2} />

      {/*
       * The spine. On a wide screen a hairline runs through the column and joins the two plates; stacked on a
       * phone it becomes a vertical list, which is the same statement read top to bottom.
       */}
      <div className="relative">
        <span aria-hidden="true" className="absolute inset-x-[-2rem] top-1/2 hidden h-px bg-border lg:block" />
        <ol className="relative space-y-px overflow-hidden rounded-2xl border bg-border">
          {steps.map(({ key, state }, index) => (
            <li
              key={key}
              className={cn(
                'flex items-center justify-between gap-3 bg-background px-4 py-3',
                state === 'live' && 'bg-primary/[0.07]',
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    state === 'live' ? 'bg-primary' : 'border border-muted-foreground/50',
                  )}
                />
                <span className="min-w-0">
                  <span className={cn('block truncate text-body font-medium', state === 'live' && 'text-primary-ink')}>
                    {t(`site.flow.steps.${key}.title`)}
                  </span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {t(`site.flow.steps.${key}.text`)}
                  </span>
                </span>
              </span>
              {index === 0 ? <Availability state="live" /> : null}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-center text-caption text-muted-foreground">{t('site.flow.note')}</p>
      </div>

      <Party side="store" icon={Store} align="end" />
    </div>
  );
}
