import { PageHero } from './page-hero';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui';
import { Availability, Band, Display, Eyebrow, Index, Lead, Reveal, Split, Statement } from './primitives';
import { RelationshipFlow } from './relationship-flow';

/** Six steps per side, with the availability of each taken from the TZ phase that delivers it. */
const JOURNEY: Record<'company' | 'store', { key: string; live?: boolean }[]> = {
  company: [
    { key: 'create', live: true },
    { key: 'verify', live: true },
    { key: 'catalog' },
    { key: 'partners' },
    { key: 'orders' },
    { key: 'settle' },
  ],
  store: [
    { key: 'create', live: true },
    { key: 'verify', live: true },
    { key: 'find' },
    { key: 'terms' },
    { key: 'order' },
    { key: 'debt' },
  ],
};

/** The order pipeline: the statuses the design system already carries colour tokens for, in P07's order. */
const PIPELINE = ['new', 'confirmed', 'assembling', 'transit', 'delivered'] as const;

/**
 * The company's path: a vertical editorial sequence, each step a rule and two sentences.
 *
 * The two sides deliberately do not share a layout. Reusing one component for both would make the page say
 * "here is the same thing twice" when the point is that the two sides experience different work.
 */
function CompanyPath() {
  const { t } = useTranslation();
  return (
    <ol className="how-step-grid">
      {JOURNEY.company.map(({ key, live }, index) => (
        <Reveal key={key}>
          <li className="how-step">
            <Index n={index + 1} className="sm:pt-1" />
            <div className="how-step-heading">
              <h3 className="font-serif text-section-sm font-semibold">{t(`site.how.company.steps.${key}.title`)}</h3>
              <Availability state={live ? 'live' : 'planned'} />
            </div>
            <p className="max-w-measure text-body leading-relaxed text-muted-foreground">{t(`site.how.company.steps.${key}.text`)}</p>
          </li>
        </Reveal>
      ))}
    </ol>
  );
}

/**
 * The store's path: the same information as a stepped column with a connector, which reads as a shorter, more
 * linear journey. That is also true of the work itself.
 */
function StorePath() {
  const { t } = useTranslation();
  return (
    <ol className="how-step-grid">
      {JOURNEY.store.map(({ key, live }, index) => (
        <Reveal key={key} delay={index * 0.04}>
          <li className="how-step">
            <div className="flex items-center gap-3">
              <Index n={index + 1} />
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
              <Availability state={live ? 'live' : 'planned'} />
            </div>
            <h3 className="mt-4 font-serif text-section-sm font-semibold">{t(`site.how.store.steps.${key}.title`)}</h3>
            <p className="mt-2 text-body leading-relaxed text-muted-foreground">{t(`site.how.store.steps.${key}.text`)}</p>
          </li>
        </Reveal>
      ))}
    </ol>
  );
}

export function HowItWorksPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHero eyebrow={t('site.nav.howItWorks')} title={t('site.how.title')} lead={t('site.how.lead')} image="journey" />

      <Band tone="sunk" hairline className="how-story">
        <Split
          weight="text-minor"
          aside={
            <figure className="how-photo">
              <img src="/media/tezfarmo-warehouse.png" alt={t('site.how.photos.company')} loading="lazy" decoding="async" />
              <figcaption>{t('site.how.company.subtitle')}</figcaption>
            </figure>
          }
        >
          <Eyebrow>{t('site.how.company.eyebrow')}</Eyebrow>
          <Display className="mt-5">{t('site.how.company.title')}</Display>
          <Lead className="mt-6">{t('site.how.company.lead')}</Lead>
        </Split>
        <CompanyPath />
      </Band>

      <Band space="tight" className="how-bridge">
        <Statement align="center">{t('site.how.between')}</Statement>
      </Band>

      <Band hairline className="how-story">
        <Split
          reverse
          weight="text-minor"
          aside={
            <figure className="how-photo">
              <img src="/media/tezfarmo-shop-order.png" alt={t('site.how.photos.store')} loading="lazy" decoding="async" />
              <figcaption>{t('site.how.store.subtitle')}</figcaption>
            </figure>
          }
        >
          <Eyebrow>{t('site.how.store.eyebrow')}</Eyebrow>
          <Display className="mt-5">{t('site.how.store.title')}</Display>
          <Lead className="mt-6">{t('site.how.store.lead')}</Lead>
        </Split>
        <StorePath />
      </Band>

      {/* One order, as a horizontal progression. Hairline-separated cells, not five cards. */}
      <Band hairline>
        <div className="max-w-[44rem]">
          <Eyebrow>{t('site.how.pipeline.eyebrow')}</Eyebrow>
          <Display className="mt-5">{t('site.how.pipeline.title')}</Display>
          <Lead className="mt-6 text-body-lg">{t('site.how.pipeline.lead')}</Lead>
        </div>
        <ol className="mt-14 grid border-t sm:grid-cols-2 lg:grid-cols-5 lg:border-t-0">
          {PIPELINE.map((stage, index) => (
            <Reveal key={stage} delay={index * 0.05}>
              <li className={cn('border-b py-6 lg:border-b-0 lg:border-t lg:pr-6', index > 0 && 'lg:border-l lg:pl-6')}>
                <div className="flex items-center gap-3">
                  <Index n={index + 1} />
                  <span aria-hidden="true" className="h-px flex-1 bg-border lg:hidden" />
                </div>
                <p className="mt-3 text-body-lg font-semibold">{t(`site.how.pipeline.stages.${stage}.title`)}</p>
                <p className="mt-1.5 text-label leading-relaxed text-muted-foreground">{t(`site.how.pipeline.stages.${stage}.text`)}</p>
              </li>
            </Reveal>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Availability state="planned" />
          <p className="max-w-measure text-label leading-relaxed text-muted-foreground">{t('site.how.pipeline.disputed')}</p>
        </div>
      </Band>

      {/* Both sides brought back together: the same relationship visual that opened the home page. */}
      <Band tone="sunk" hairline>
        <div className="max-w-[44rem]">
          <Display>{t('site.how.together.title')}</Display>
          <Lead className="mt-6 text-body-lg">{t('site.how.together.lead')}</Lead>
        </div>
        <div className="mt-14">
          <Reveal>
            <RelationshipFlow />
          </Reveal>
        </div>
      </Band>

      <Band tone="ink">
        <div className="max-w-[40rem]">
          <Display>{t('site.how.cta.title')}</Display>
          <p className="mt-6 max-w-measure text-lead text-background/70">{t('site.how.cta.lead')}</p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
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
      </Band>
    </>
  );
}
