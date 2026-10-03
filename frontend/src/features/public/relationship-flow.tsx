import { motion } from 'framer-motion';
import { Building2, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Availability } from './primitives';

/**
 * Company, TezFarmo, Store: the one picture the product is about (Phase E4).
 *
 * Built from real interface parts and drawn connectors, not an illustration and not a screenshot. There are no
 * invented company names, order numbers or amounts in it: the content is the vocabulary itself, which is the
 * honest version of a product visual for a product this early.
 *
 * Phase E4 added the layering and the motion. The two party plates sit at different heights so the composition
 * has a diagonal rather than a centre line, and the connectors draw themselves as the band arrives, left side
 * first, so the eye is walked across the relationship in the order it happens instead of being handed a
 * finished diagram. Teal appears once, on the agreement, because that is the thing the two parties share.
 */

const DRAW = { duration: 1.1, ease: [0.23, 1, 0.32, 1] as const };

/** One party: who they are, and the two things they bring to the arrangement. */
function Party({ side, icon: Icon, className }: { side: 'company' | 'store'; icon: typeof Building2; className?: string }) {
  const { t } = useTranslation();
  return (
    <motion.div
      className={cn('relative z-10 min-w-0 rounded-2xl border bg-surface p-5 shadow-[0_1px_0_0_hsl(var(--border))] sm:p-6', className)}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1], delay: side === 'company' ? 0 : 0.12 }}
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-subtle text-foreground/70">
          <Icon className="size-[1.125rem]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="break-words text-body font-semibold">{t(`site.flow.${side}.title`)}</p>
          <p className="break-words text-caption text-muted-foreground">{t(`site.flow.${side}.role`)}</p>
        </div>
      </div>
      <dl className="mt-5 space-y-2.5 border-t pt-4">
        {(['brings', 'needs'] as const).map((row) => (
          <div key={row}>
            <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t(`site.flow.${row}`)}</dt>
            <dd className="text-label leading-snug text-foreground/85">{t(`site.flow.${side}.${row}`)}</dd>
          </div>
        ))}
      </dl>
    </motion.div>
  );
}

/**
 * The connectors, on desktop only.
 *
 * Two curves from the party plates into the spine, drawn with `pathLength` so the stroke animates regardless of
 * its measured length. Decorative: the relationship is stated in text by the plates and the spine either side of
 * it, so nothing here needs to reach assistive technology.
 */
function Connectors() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 hidden size-full lg:block"
    >
      {[
        { d: 'M 0 32 C 26 32, 24 50, 50 50', delay: 0.25 },
        { d: 'M 100 68 C 74 68, 76 50, 50 50', delay: 0.4 },
      ].map(({ d, delay }) => (
        <motion.path
          key={d}
          d={d}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth="0.4"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ ...DRAW, delay }}
        />
      ))}
    </svg>
  );
}

export function RelationshipFlow() {
  const { t } = useTranslation();
  /** The exchange, in the order it happens. Only the agreement itself is in the product today. */
  const steps = [{ key: 'partnership', live: true }, { key: 'catalog' }, { key: 'order' }, { key: 'delivery' }, { key: 'ledger' }];

  return (
    <div className="relative">
      <Connectors />
      {/* Offset heights on desktop: the composition runs on a diagonal, not a centre line. */}
      <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
        <Party side="company" icon={Building2} className="lg:-translate-y-10" />

        <motion.div
          className="relative z-10 min-w-0"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1], delay: 0.2 }}
        >
          <ol className="space-y-px overflow-hidden rounded-2xl border bg-border">
            {steps.map(({ key, live }, index) => (
              <motion.li
                key={key}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-3 bg-background px-4 py-3 sm:flex-nowrap',
                  live && 'bg-primary/[0.07]',
                )}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1], delay: 0.35 + index * 0.07 }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={cn('size-1.5 shrink-0 rounded-full', live ? 'bg-primary' : 'border border-muted-foreground/50')}
                  />
                  <span className="min-w-0 break-words">
                    <span className={cn('block text-body font-medium', live && 'text-primary-ink')}>
                      {t(`site.flow.steps.${key}.title`)}
                    </span>
                    <span className="block text-caption text-muted-foreground">{t(`site.flow.steps.${key}.text`)}</span>
                  </span>
                </span>
                {live ? <Availability state="live" /> : null}
              </motion.li>
            ))}
          </ol>
          <p className="mt-3 text-center text-caption text-muted-foreground">{t('site.flow.note')}</p>
        </motion.div>

        <Party side="store" icon={Store} className="lg:translate-y-10" />
      </div>
    </div>
  );
}
