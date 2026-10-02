import { ArrowRight, Building2, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui';
import { Availability, Display, Eyebrow, Lead, Reveal, Section } from './primitives';

/**
 * The order pipeline, which is the real one: these are the statuses the design system already carries colour
 * tokens for, in the order P07 defines. DISPUTED is shown apart because it is not a stage every order reaches.
 */
const PIPELINE = ['new', 'confirmed', 'assembling', 'transit', 'delivered'] as const;

/** Six steps per side. The keys match the i18n blocks; the availability comes from the TZ phase of each step. */
const JOURNEY: Record<'company' | 'store', { key: string; phase?: string }[]> = {
  company: [
    { key: 'create' },
    { key: 'verify' },
    { key: 'catalog', phase: 'P04' },
    { key: 'partners', phase: 'P06' },
    { key: 'orders', phase: 'P07' },
    { key: 'settle', phase: 'P09' },
  ],
  store: [
    { key: 'create' },
    { key: 'verify' },
    { key: 'find', phase: 'P06' },
    { key: 'terms', phase: 'P06' },
    { key: 'order', phase: 'P07' },
    { key: 'debt', phase: 'P09' },
  ],
};

/**
 * One side's narrative.
 *
 * A numbered column with a hairline connector, not a row of cards: the steps are sequential, and six cards in a
 * grid say "pick one" where the content says "then this". The two sides are stacked rather than put behind a
 * tab, because a visitor who does not yet know which side they are on cannot choose a tab, and the page is the
 * place where they find out.
 */
function Side({ side, icon: Icon }: { side: 'company' | 'store'; icon: typeof Building2 }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-center gap-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-serif text-section-sm font-semibold">{t(`site.how.${side}.title`)}</h2>
          <p className="text-label text-muted-foreground">{t(`site.how.${side}.subtitle`)}</p>
        </div>
      </div>
      <p className="mt-5 max-w-measure text-body leading-relaxed text-muted-foreground">{t(`site.how.${side}.lead`)}</p>

      <ol className="mt-9">
        {JOURNEY[side].map(({ key, phase }, index) => {
          const last = index === JOURNEY[side].length - 1;
          return (
            <Reveal key={key} delay={index * 0.05}>
              <li className="flex gap-5">
                <span className="flex flex-col items-center" aria-hidden="true">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-surface font-data text-caption font-bold">
                    {index + 1}
                  </span>
                  {last ? null : <span className="min-h-10 w-px flex-1 bg-border" />}
                </span>
                <div className={cn('min-w-0', last ? 'pb-0' : 'pb-9')}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <h3 className="text-body-lg font-semibold">{t(`site.how.${side}.steps.${key}.title`)}</h3>
                    <Availability state={phase ? 'planned' : 'live'} phase={phase} />
                  </div>
                  <p className="mt-1.5 max-w-measure text-body leading-relaxed text-muted-foreground">
                    {t(`site.how.${side}.steps.${key}.text`)}
                  </p>
                </div>
              </li>
            </Reveal>
          );
        })}
      </ol>
    </div>
  );
}

export function HowItWorksPage() {
  const { t } = useTranslation();
  return (
    <>
      <Section space="tight" className="pt-14 sm:pt-20 lg:pt-24">
        <div className="max-w-3xl">
          <Eyebrow>{t('site.how.eyebrow')}</Eyebrow>
          <Display as="h1" size="hero" className="mt-5">
            {t('site.how.title')}
          </Display>
          <Lead className="mt-6">{t('site.how.lead')}</Lead>
        </div>
      </Section>

      {/* The agreement, which is the thing both sides arrive at and the reason the rest of the flow exists. */}
      <Section tone="sunk" hairline>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16">
          <div>
            <Eyebrow>{t('site.how.partnership.eyebrow')}</Eyebrow>
            <Display className="mt-4">{t('site.how.partnership.title')}</Display>
          </div>
          <div>
            <Lead>{t('site.how.partnership.lead')}</Lead>
            <dl className="mt-8 space-y-6">
              {(['request', 'invite', 'terms'] as const).map((key) => (
                <Reveal key={key}>
                  <div className="border-t pt-5">
                    <dt className="text-body-lg font-semibold">{t(`site.how.partnership.${key}.title`)}</dt>
                    <dd className="mt-1.5 max-w-measure text-body leading-relaxed text-muted-foreground">
                      {t(`site.how.partnership.${key}.text`)}
                    </dd>
                  </div>
                </Reveal>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      <Section hairline>
        <div className="grid gap-16 lg:grid-cols-2 lg:gap-20">
          <Side side="company" icon={Building2} />
          <Side side="store" icon={Store} />
        </div>
      </Section>

      {/* The life of one order, in the statuses the product actually uses. */}
      <Section tone="sunk" hairline>
        <div className="max-w-3xl">
          <Eyebrow>{t('site.how.pipeline.eyebrow')}</Eyebrow>
          <Display className="mt-4">{t('site.how.pipeline.title')}</Display>
          <Lead className="mt-5">{t('site.how.pipeline.lead')}</Lead>
        </div>
        <ol className="mt-12 grid gap-px overflow-hidden rounded-3xl border bg-border sm:grid-cols-2 lg:grid-cols-5">
          {PIPELINE.map((stage, index) => (
            <li key={stage} className="bg-surface p-5 sm:p-6">
              <span className="font-data text-caption font-bold text-muted-foreground">{`0${index + 1}`}</span>
              <p className="mt-3 text-body-lg font-semibold">{t(`site.how.pipeline.stages.${stage}.title`)}</p>
              <p className="mt-1.5 text-label leading-relaxed text-muted-foreground">
                {t(`site.how.pipeline.stages.${stage}.text`)}
              </p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="max-w-measure text-label leading-relaxed text-muted-foreground">{t('site.how.pipeline.disputed')}</p>
          <Availability state="planned" phase="P07" />
        </div>
      </Section>

      <Section tone="ink">
        <div className="max-w-2xl">
          <Display className="text-background">{t('site.how.cta.title')}</Display>
          <p className="mt-5 max-w-measure text-lead text-background/75">{t('site.how.cta.lead')}</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="xl" className="bg-background text-foreground hover:bg-background/90">
              <Link to="/register">
                {t('site.nav.createAccount')}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="xl" className="text-background hover:bg-background/10">
              <Link to="/product">{t('site.how.cta.product')}</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
