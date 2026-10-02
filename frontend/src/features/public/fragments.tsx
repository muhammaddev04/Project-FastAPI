import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

/**
 * Oversized interface fragments (Phase E4).
 *
 * These are the graphic compositions that fill the image slots until photography exists, and they are built from
 * the product's own vocabulary and its own design tokens rather than from invented records. No order numbers, no
 * amounts, no company names, no customer counts: a fragment shows the *shape* of a screen, which is a true thing
 * to show, where a populated mock would be a claim about a product that has not shipped those screens yet.
 *
 * They are drawn far larger than working size and allowed to run off the frame, so a band reads as a window onto
 * the product rather than a picture of it centred on a card.
 */

/** The five pipeline stages, each with the status colour the design system already defines for it. */
const STAGES = [
  { key: 'new', dot: 'bg-status-new', soft: 'bg-status-new-soft' },
  { key: 'confirmed', dot: 'bg-status-confirmed', soft: 'bg-status-confirmed-soft' },
  { key: 'assembling', dot: 'bg-status-assembling', soft: 'bg-status-assembling-soft' },
  { key: 'transit', dot: 'bg-status-transit', soft: 'bg-status-transit-soft' },
  { key: 'delivered', dot: 'bg-status-delivered', soft: 'bg-status-delivered-soft' },
] as const;

/**
 * The order pipeline at display scale, cropped off the right edge.
 *
 * The one place the status palette appears on the public site. It is the product's real colour language for the
 * stages of an order, so showing it is showing something true, and it gives the band the chromatic lift the page
 * otherwise gets only from a single teal accent.
 */
export function PipelineFragment({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex h-full items-center', className)}>
      <ol className="flex w-full min-w-[46rem] items-stretch gap-3 px-6 sm:gap-4 sm:px-10 lg:min-w-[62rem]">
        {STAGES.map(({ key, dot, soft }, index) => (
          <li
            key={key}
            className={cn(
              'flex min-w-0 flex-1 flex-col justify-between rounded-2xl border border-border/70 p-4 sm:p-5',
              soft,
              // The last cell is the one the crop cuts, which is what makes the row read as continuing.
              index === STAGES.length - 1 && 'opacity-80',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', dot)} />
              <span className="font-data text-caption tabular-nums text-foreground/45">{String(index + 1).padStart(2, '0')}</span>
            </div>
            <p className="mt-10 truncate text-body-lg font-semibold text-foreground sm:mt-14">
              {t(`site.how.pipeline.stages.${key}.title`)}
            </p>
            <div aria-hidden="true" className="mt-3 space-y-1.5">
              {/* Deliberately blank rules: the shape of a record, with nothing invented written on it. */}
              <span className="block h-1 w-full rounded-full bg-foreground/10" />
              <span className="block h-1 w-2/3 rounded-full bg-foreground/10" />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The verification request, which is a screen that genuinely exists.
 *
 * It is the one interface a visitor will actually meet on their first day, so it is the one worth showing. The
 * four states are the real `OrgVerificationStatus` values and the labels are the real translations.
 */
export function VerificationFragment({ className }: { className?: string }) {
  const { t } = useTranslation();
  const states = [
    { key: 'NOT_SUBMITTED', tone: 'bg-muted text-muted-foreground' },
    { key: 'PENDING', tone: 'bg-warning-soft text-warning-ink' },
    { key: 'APPROVED', tone: 'bg-success-soft text-success-ink' },
    { key: 'REJECTED', tone: 'bg-danger-soft text-danger-ink' },
  ] as const;
  return (
    <div className={cn('flex h-full flex-col justify-center gap-3 p-6 sm:p-8', className)}>
      <p className="text-micro font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('verification.statusLabel')}</p>
      <ul className="space-y-2.5">
        {states.map(({ key, tone }, index) => (
          <li
            key={key}
            className={cn(
              'flex items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3.5',
              // The third one is lit: an approved organization is the outcome this screen exists to reach.
              index === 2 && 'border-success/40',
            )}
          >
            <span className="truncate text-body font-medium">{t(`verification.status.${key}`)}</span>
            <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-micro font-semibold', tone)}>
              {t(`verification.steps.${index < 2 ? 'submit' : index === 2 ? 'review' : 'decision'}`)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-caption leading-relaxed text-muted-foreground">{t('site.media.verificationNote')}</p>
    </div>
  );
}

/**
 * Delivery, as oversized type rather than a diagram.
 *
 * A band that needs to feel like movement, with no photograph to supply it and nothing truthful to screenshot:
 * the words themselves, set large and tracked tight, with the stages running off the edge.
 */
export function HandoverFragment({ className }: { className?: string }) {
  const { t } = useTranslation();
  const legs = ['assembling', 'transit', 'delivered'] as const;
  return (
    <div className={cn('flex h-full flex-col justify-center overflow-hidden', className)}>
      <ol className="space-y-1 sm:space-y-2">
        {legs.map((leg, index) => (
          <li key={leg} className="flex items-baseline gap-4 whitespace-nowrap sm:gap-6">
            <span className="font-data text-caption tabular-nums text-background/40">{String(index + 1).padStart(2, '0')}</span>
            <span
              className={cn(
                'font-serif text-section font-semibold tracking-[-0.03em]',
                index === legs.length - 1 ? 'text-background' : 'text-background/45',
              )}
            >
              {t(`site.how.pipeline.stages.${leg}.title`)}
            </span>
            <span aria-hidden="true" className="h-px w-16 shrink-0 bg-background/25 sm:w-28" />
          </li>
        ))}
      </ol>
    </div>
  );
}
