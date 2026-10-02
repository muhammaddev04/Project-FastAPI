import { ArrowRight, Building2, Check, ShieldCheck, Store, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { JOURNEY_STEPS } from '@/features/auth/journey-steps';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui';
import { Availability, Display, Eyebrow, Lead, Reveal, Section } from './primitives';
import { ROADMAP } from './roadmap';

/** The three things TezFarmo does today. Every one of them is implemented; none is a promise. */
const TRUTHS = [
  { key: 'verified', icon: ShieldCheck },
  { key: 'memberships', icon: Users },
  { key: 'roles', icon: Building2 },
] as const;

/**
 * The relationship the whole product exists to serve, drawn once.
 *
 * Two columns and the agreement between them, not a flow chart: the point is that a company and a store are
 * two parties to one arrangement, and that either of them can start it. The arrow directions are the real ones
 * from the TZ, where a store requests with the company's public code and a company invites.
 */
function Relationship() {
  const { t } = useTranslation();
  const sides = [
    { key: 'company', icon: Building2 },
    { key: 'store', icon: Store },
  ] as const;
  return (
    <div className="mt-12 grid gap-4 lg:mt-16 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch lg:gap-6">
      {sides.map(({ key, icon: Icon }, index) => (
        <Reveal key={key} delay={index * 0.08} className="flex">
          <div className="flex w-full flex-col rounded-3xl border bg-surface p-6 sm:p-8">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <h3 className="mt-5 font-serif text-section-sm font-semibold">{t(`site.home.relationship.${key}.title`)}</h3>
            <p className="mt-2 text-body leading-relaxed text-muted-foreground">{t(`site.home.relationship.${key}.text`)}</p>
            <ul className="mt-5 space-y-2 border-t pt-4">
              {(t(`site.home.relationship.${key}.points`, { returnObjects: true }) as string[]).map((point) => (
                <li key={point} className="flex gap-2.5 text-label leading-relaxed text-muted-foreground">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      ))}

      {/* The agreement sits between the two parties on a wide screen, and under the first one on a phone. */}
      <Reveal
        delay={0.16}
        className="order-last flex items-center justify-center lg:order-none lg:row-start-1 lg:col-start-2"
      >
        <div className="flex w-full flex-col items-center gap-3 rounded-3xl border border-primary/30 bg-primary/[0.06] px-6 py-6 text-center lg:h-full lg:w-[13rem] lg:justify-center">
          <p className="font-serif text-title font-semibold text-primary-ink">{t('site.home.relationship.bridge.title')}</p>
          <p className="text-label leading-relaxed text-muted-foreground">{t('site.home.relationship.bridge.text')}</p>
          <p className="mt-1 text-micro font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t('site.home.relationship.bridge.note')}
          </p>
        </div>
      </Reveal>
    </div>
  );
}

/**
 * What setting up actually involves, stated as the five steps the product really has.
 *
 * This is the honest alternative to a product screenshot. The application has three working screens and a
 * verification queue; a mocked dashboard full of invented orders would be the one thing on this page that
 * could not survive a visitor signing up, so the setup path is shown instead, because it is real.
 */
function SetupPreview() {
  const { t } = useTranslation();
  return (
    <div className="mt-12 overflow-hidden rounded-3xl border bg-surface">
      <ol className="divide-y">
        {JOURNEY_STEPS.map((step, index) => (
          <li key={step} className="flex items-start gap-4 px-5 py-4 sm:px-8 sm:py-5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-data text-caption font-bold text-primary-ink">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-body-lg font-semibold">{t(`auth.journey.steps.${step}.title`)}</p>
              <p className="mt-0.5 text-label leading-relaxed text-muted-foreground">{t(`auth.journey.steps.${step}.hint`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t bg-subtle/60 px-5 py-4 text-label text-muted-foreground sm:px-8">{t('site.home.setup.note')}</p>
    </div>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  return (
    <>
      {/*
       * Hero. One sentence of what this is, one of who it is for, two actions. The reference opens on a single
       * large statement and a photograph, not on a value-proposition stack, so there is no second headline
       * here, no badge row and no statistics strip.
       */}
      <Section space="tight" className="pt-14 sm:pt-20 lg:pt-28">
        <div className="max-w-3xl">
          <Reveal>
            <Eyebrow>{t('site.home.eyebrow')}</Eyebrow>
            <Display as="h1" size="hero" className="mt-5">
              {t('site.home.title')}
            </Display>
            <Lead className="mt-6">{t('site.home.lead')}</Lead>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="xl" className="sm:w-auto">
                <Link to="/register">
                  {t('site.nav.createAccount')}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="secondary" size="xl">
                <Link to="/how-it-works">{t('site.home.seeHow')}</Link>
              </Button>
            </div>
            <p className="mt-5 text-label text-muted-foreground">{t('site.home.heroNote')}</p>
          </Reveal>
        </div>
      </Section>

      <Section tone="sunk" hairline>
        <div className="max-w-3xl">
          <Eyebrow>{t('site.home.relationship.eyebrow')}</Eyebrow>
          <Display className="mt-4">{t('site.home.relationship.title')}</Display>
          <Lead className="mt-5">{t('site.home.relationship.lead')}</Lead>
        </div>
        <Relationship />
      </Section>

      <Section hairline>
        <div className="max-w-3xl">
          <Eyebrow>{t('site.home.truths.eyebrow')}</Eyebrow>
          <Display className="mt-4">{t('site.home.truths.title')}</Display>
          <Lead className="mt-5">{t('site.home.truths.lead')}</Lead>
        </div>
        <dl className="mt-12 grid gap-10 sm:grid-cols-3 sm:gap-8 lg:mt-16">
          {TRUTHS.map(({ key, icon: Icon }, index) => (
            <Reveal key={key} delay={index * 0.08}>
              <Icon className="size-5 text-primary" aria-hidden="true" />
              <dt className="mt-4 font-serif text-section-sm font-semibold">{t(`site.home.truths.${key}.title`)}</dt>
              <dd className="mt-2 text-body leading-relaxed text-muted-foreground">{t(`site.home.truths.${key}.text`)}</dd>
            </Reveal>
          ))}
        </dl>
      </Section>

      <Section tone="sunk" hairline>
        <div className="max-w-3xl">
          <Eyebrow>{t('site.home.setup.eyebrow')}</Eyebrow>
          <Display className="mt-4">{t('site.home.setup.title')}</Display>
          <Lead className="mt-5">{t('site.home.setup.lead')}</Lead>
        </div>
        <SetupPreview />
      </Section>

      {/* Being built in the open: the roadmap in product language, with the phase tag kept small. */}
      <Section hairline>
        <div className="max-w-3xl">
          <Eyebrow>{t('site.home.roadmap.eyebrow')}</Eyebrow>
          <Display className="mt-4">{t('site.home.roadmap.title')}</Display>
          <Lead className="mt-5">{t('site.home.roadmap.lead')}</Lead>
        </div>
        <ul className="mt-10 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROADMAP.map((item) => (
            <li key={item.key} className={cn('flex items-center justify-between gap-3 border-b py-3')}>
              <span className="min-w-0 text-body font-medium">{t(`site.modules.${item.key}.title`)}</span>
              <Availability state={item.phase ? 'planned' : 'live'} phase={item.phase} />
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-measure text-label leading-relaxed text-muted-foreground">{t('site.home.roadmap.note')}</p>
        <Link to="/product" className="link-grow mt-4 inline-flex items-center gap-1.5 text-body font-semibold text-primary">
          {t('site.home.roadmap.more')}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </Section>

      {/* Closing action. One heading, one button, nothing else on the band. */}
      <Section tone="ink">
        <div className="max-w-2xl">
          <Display className="text-background">{t('site.home.cta.title')}</Display>
          <p className="mt-5 max-w-measure text-lead text-background/75">{t('site.home.cta.lead')}</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              asChild
              size="xl"
              className="bg-background text-foreground hover:bg-background/90"
            >
              <Link to="/register">
                {t('site.nav.createAccount')}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="xl" className="text-background hover:bg-background/10">
              <Link to="/login">{t('site.nav.signIn')}</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
