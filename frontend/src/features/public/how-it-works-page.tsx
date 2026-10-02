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
    <ol>
      {JOURNEY.company.map(({ key, live }, index) => (
        <Reveal key={key}>
          <li className="grid gap-x-8 gap-y-2 border-t py-7 sm:grid-cols-[auto_minmax(0,16rem)_minmax(0,1fr)] sm:items-baseline">
            <Index n={index + 1} className="sm:pt-1" />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-serif text-section-sm font-semibold">{t(`site.how.company.steps.${key}.title`)}</h3>
              <Availability state={live ? 'live' : 'planned'} />
            </div>
            <p className="max-w-measure text-body leading-relaxed text-muted-foreground">
              {t(`site.how.company.steps.${key}.text`)}
            </p>
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
    <ol className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
      {JOURNEY.store.map(({ key, live }, index) => (
        <Reveal key={key} delay={index * 0.04}>
          <li>
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
      {/* Opens on a statement, not on a heading and a lead. */}
      {/* One band, not a section wrapping a band: the hero is a band like every other. */}
      <Band space="tight" className="pt-16 sm:pt-24 lg:pt-32">
          <div className="max-w-[48rem]">
            <Display as="h1" size="hero">
              {t('site.how.title')}
            </Display>
            <Lead className="mt-10 text-body-lg sm:text-lead">{t('site.how.lead')}</Lead>
          </div>
      </Band>

      {/* Company: text in the minority column, the sequence carrying the width. */}
      <Band tone="sunk" hairline>
        <Split aside={<CompanyPath />}>
          <Eyebrow>{t('site.how.company.eyebrow')}</Eyebrow>
          <Display className="mt-5">{t('site.how.company.title')}</Display>
          <p className="mt-3 text-label uppercase tracking-[0.06em] text-muted-foreground">
            {t('site.how.company.subtitle')}
          </p>
          <Lead className="mt-6 text-body-lg">{t('site.how.company.lead')}</Lead>
        </Split>
      </Band>

      {/* Air between the two sides, so they read as two stories rather than one list. */}
      <Band space="air">
        <Reveal>
          <Statement>{t('site.how.between')}</Statement>
        </Reveal>
      </Band>

      {/* Store: reversed, and a grid rather than a column, so the silhouette differs from the company's. */}
      <Band tone="sunk" hairline>
        <Split reverse weight="text-minor" aside={<StorePath />}>
          <Eyebrow>{t('site.how.store.eyebrow')}</Eyebrow>
          <Display className="mt-5">{t('site.how.store.title')}</Display>
          <p className="mt-3 text-label uppercase tracking-[0.06em] text-muted-foreground">
            {t('site.how.store.subtitle')}
          </p>
          <Lead className="mt-6 text-body-lg">{t('site.how.store.lead')}</Lead>
        </Split>
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
                <p className="mt-1.5 text-label leading-relaxed text-muted-foreground">
                  {t(`site.how.pipeline.stages.${stage}.text`)}
                </p>
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
