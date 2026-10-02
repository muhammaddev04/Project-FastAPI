import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { JOURNEY_STEPS } from '@/features/auth/journey-steps';
import { Button } from '@/shared/ui';
import { Availability, Band, Display, Eyebrow, Index, Lead, Reveal, Split, Statement } from './primitives';
import { RelationshipFlow } from './relationship-flow';
import { PLANNED_MODULES } from './roadmap';

/**
 * The home page (Phase E, rebuilt).
 *
 * The first version was a hero and then four bands of eyebrow, heading, lead and a grid. Five sections with one
 * silhouette is the generic shape this redesign exists to remove, so the page is now a sequence that changes
 * rhythm: a hero whose headline is the largest object on the screen, a bare statement with nothing else in its
 * band, a wide product moment, a restrained trio with no boxes, two asymmetric stories facing opposite ways, a
 * second statement, an indexed roadmap and one closing action.
 *
 * No section repeats another section's layout. That is the whole brief.
 */

/** The three things that are true today. No icons, no cards: a marker, a line, and two sentences. */
function Truths() {
  const { t } = useTranslation();
  const truths = ['relationships', 'oneFlow', 'history'] as const;
  return (
    <div className="grid gap-12 sm:grid-cols-3 sm:gap-10 lg:gap-16">
      {truths.map((key, index) => (
        <Reveal key={key} delay={index * 0.07}>
          <Index n={index + 1} />
          <h3 className="mt-4 font-serif text-section-sm font-semibold">{t(`site.home.truths.${key}.title`)}</h3>
          <p className="mt-2.5 text-body leading-relaxed text-muted-foreground">{t(`site.home.truths.${key}.text`)}</p>
        </Reveal>
      ))}
    </div>
  );
}

/** Setup, as the five steps the product really has. Bordered, because it is an interface, not an argument. */
function SetupSequence() {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-2xl border bg-surface">
      <ol className="divide-y">
        {JOURNEY_STEPS.map((step, index) => (
          <li key={step} className="flex items-baseline gap-4 px-5 py-4 sm:px-6">
            <Index n={index + 1} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-body font-semibold">{t(`auth.journey.steps.${step}.title`)}</p>
              <p className="mt-0.5 text-label leading-relaxed text-muted-foreground">{t(`auth.journey.steps.${step}.hint`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The roadmap as an indexed editorial list: serif title, quiet status, one line, a rule. No cards. */
function Roadmap() {
  const { t } = useTranslation();
  return (
    <ul className="mt-14">
      {PLANNED_MODULES.map((entry, index) => (
        <Reveal key={entry.key}>
          <li className="grid gap-x-8 gap-y-2 border-t py-6 sm:grid-cols-[auto_minmax(0,18rem)_minmax(0,1fr)] sm:items-baseline">
            <Index n={index + 1} className="sm:pt-1" />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-serif text-section-sm font-semibold">{t(`site.modules.${entry.key}.title`)}</h3>
              <Availability state="planned" />
            </div>
            <p className="max-w-measure text-body leading-relaxed text-muted-foreground">
              {t(`site.modules.${entry.key}.text`)}
            </p>
          </li>
        </Reveal>
      ))}
    </ul>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  return (
    <>
      {/*
       * Hero. The headline is the dominant object; the supporting line is deliberately a fraction of its size.
       * Left-aligned and asymmetric, and the product visual gets the full width of the frame beneath it rather
       * than being squeezed into a column beside the text.
       */}
      <Band space="tight" className="pt-16 sm:pt-24 lg:pt-32">
        <div>
          <div className="max-w-[52rem]">
            <Display as="h1" size="hero">
              {t('site.home.title')}
            </Display>
            <div className="mt-10 grid gap-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Lead className="max-w-[34rem] text-body-lg sm:text-lead">{t('site.home.lead')}</Lead>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="xl">
                  <Link to="/register">
                    {t('site.nav.createAccount')}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="xl">
                  <Link to="/how-it-works">{t('site.home.seeHow')}</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-16 lg:mt-24">
          <Reveal>
            <RelationshipFlow />
          </Reveal>
        </div>
      </Band>

      {/* Rhythm change: one statement, a lot of air, no chrome at all. */}
      <Band space="air">
        <Reveal>
          <Statement answer={t('site.home.statement.answer')}>{t('site.home.statement.problem')}</Statement>
        </Reveal>
      </Band>

      {/* Product moment: the agreement, with the text in the minority column. */}
      <Band tone="sunk" hairline>
        <Split
          aside={
            <Reveal>
              <ol className="space-y-px overflow-hidden rounded-2xl border bg-border">
                {(['request', 'invite', 'terms'] as const).map((key, index) => (
                  <li key={key} className="bg-surface px-5 py-5 sm:px-6">
                    <div className="flex items-baseline gap-3">
                      <Index n={index + 1} />
                      <div className="min-w-0">
                        <h3 className="text-body-lg font-semibold">{t(`site.how.partnership.${key}.title`)}</h3>
                        <p className="mt-1.5 max-w-measure text-body leading-relaxed text-muted-foreground">
                          {t(`site.how.partnership.${key}.text`)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>
          }
        >
          <Eyebrow>{t('site.home.agreement.eyebrow')}</Eyebrow>
          <Display className="mt-5">{t('site.home.agreement.title')}</Display>
          <Lead className="mt-6 text-body-lg">{t('site.home.agreement.lead')}</Lead>
          <Availability state="live" className="mt-6" />
        </Split>
      </Band>

      {/* Restrained trio. Full width, no boxes, separated by whitespace only. */}
      <Band hairline>
        <div className="max-w-[40rem]">
          <Display size="section-sm">{t('site.home.truths.title')}</Display>
        </div>
        <div className="mt-14 lg:mt-20">
          <Truths />
        </div>
      </Band>

      {/* Asymmetric story, reversed: the visual leads and the text follows it. */}
      <Band tone="sunk" hairline>
        <Split
          reverse
          weight="text-minor"
          aside={
            <Reveal>
              <SetupSequence />
            </Reveal>
          }
        >
          <Eyebrow>{t('site.home.setup.eyebrow')}</Eyebrow>
          <Display className="mt-5">{t('site.home.setup.title')}</Display>
          <Lead className="mt-6 text-body-lg">{t('site.home.setup.lead')}</Lead>
          <p className="mt-6 max-w-measure text-label leading-relaxed text-muted-foreground">{t('site.home.setup.note')}</p>
        </Split>
      </Band>

      {/* Second typographic moment, centred this time so it does not echo the first. */}
      <Band space="air" hairline>
        <Reveal>
          <Statement align="center">{t('site.home.openStatement')}</Statement>
        </Reveal>
      </Band>

      <Band tone="sunk" hairline>
        <div className="max-w-[44rem]">
          <Eyebrow>{t('site.home.roadmap.eyebrow')}</Eyebrow>
          <Display className="mt-5">{t('site.home.roadmap.title')}</Display>
          <Lead className="mt-6 text-body-lg">{t('site.home.roadmap.lead')}</Lead>
        </div>
        <Roadmap />
        <Link to="/product" className="link-grow mt-10 inline-flex items-center gap-1.5 text-body font-semibold text-primary">
          {t('site.home.roadmap.more')}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </Band>

      {/* One closing action. The only inverted band on the page. */}
      <Band tone="ink" space="default">
        <div className="max-w-[40rem]">
          <Display>{t('site.home.cta.title')}</Display>
          <p className="mt-6 max-w-measure text-lead text-background/70">{t('site.home.cta.lead')}</p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="xl" className="bg-background text-foreground hover:bg-background/90">
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
      </Band>
    </>
  );
}
