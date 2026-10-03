import { PageHero } from './page-hero';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { JOURNEY_STEPS } from '@/features/auth/journey-steps';
import { Button } from '@/shared/ui';
import { Availability, Band, Display, Eyebrow, Index, Lead, Reveal, Split, Statement } from './primitives';
import { RuledField } from './texture';
import { LIVE_MODULES, PLANNED_MODULES } from './roadmap';

/**
 * The product page (Phase E, rebuilt).
 *
 * It was two sticky columns each listing bordered rows, which made the live capabilities and the unbuilt ones
 * look like the same kind of thing at the same scale. Now what exists gets room to be a product story, and what
 * does not gets an honest indexed sequence. The difference in treatment is itself the message.
 *
 * TZ phase codes are gone from this page. P04 and P07 are internal scheduling; a visitor needs to know whether
 * something works, which the marker says in words.
 */

/** What the setup steps actually are, used as the visual for the first story. Real labels, real order. */
function SetupStories() {
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

/** The role vocabulary, as the visual for the roles story. These are the real roles the backend enforces. */
function RoleMatrix() {
  const { t } = useTranslation();
  const sides = [
    { key: 'company', roles: ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'COURIER'] },
    { key: 'store', roles: ['OWNER', 'SELLER'] },
  ] as const;
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2">
      {sides.map(({ key, roles }) => (
        <div key={key} className="bg-surface p-5 sm:p-6">
          <p className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t(`orgTypes.${key === 'company' ? 'COMPANY' : 'STORE'}`)}
          </p>
          <ul className="mt-4 space-y-2">
            {roles.map((role) => (
              <li key={role} className="flex items-center gap-2.5 text-body text-foreground/85">
                <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                {t(`roles.${role}`)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function ProductPage() {
  const { t } = useTranslation();
  /** The live capabilities, paired with the visual that shows each one honestly. */
  const stories = [
    { entry: LIVE_MODULES[0]!, aside: <SetupStories />, reverse: false },
    { entry: LIVE_MODULES[2]!, aside: <RoleMatrix />, reverse: true },
  ];

  return (
    <>
      <PageHero eyebrow={t('site.nav.product')} title={t('site.product.title')} lead={t('site.product.lead')} image="product" />

      {/* Available today: two full stories, each with its own visual and its own direction. */}
      {stories.map(({ entry, aside, reverse }, index) => (
        <Band key={entry.key} tone={index % 2 === 0 ? 'sunk' : 'default'} hairline>
          <Split reverse={reverse} aside={<Reveal>{aside}</Reveal>}>
            {index === 0 ? <Eyebrow>{t('site.product.live.eyebrow')}</Eyebrow> : null}
            <Display className={index === 0 ? 'mt-5' : undefined}>{t(`site.modules.${entry.key}.title`)}</Display>
            <Lead className="mt-6 text-body-lg">{t(`site.modules.${entry.key}.text`)}</Lead>
            <Availability state="live" className="mt-6" />
          </Split>
        </Band>
      ))}

      {/* The remaining live capabilities, stated plainly rather than given a story each. */}
      <Band hairline space="tight">
        <div className="grid gap-10 sm:grid-cols-2 lg:gap-16">
          {[LIVE_MODULES[1]!, LIVE_MODULES[3]!].map((entry) => (
            <Reveal key={entry.key}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-serif text-section-sm font-semibold">{t(`site.modules.${entry.key}.title`)}</h3>
                <Availability state="live" />
              </div>
              <p className="mt-2.5 max-w-measure text-body leading-relaxed text-muted-foreground">{t(`site.modules.${entry.key}.text`)}</p>
            </Reveal>
          ))}
        </div>
      </Band>

      {/*
       * The transition from what exists to what does not. A statement does the work a section header would have
       * done badly, over the ruled field so the turn in the page has some weight behind it.
       */}
      <Band space="air" hairline className="relative overflow-hidden">
        <RuledField className="pointer-events-none absolute inset-0" />
        <Reveal className="relative">
          <Statement answer={t('site.product.planned.lead')}>{t('site.product.planned.title')}</Statement>
        </Reveal>
      </Band>

      <Band tone="sunk" hairline>
        <ul>
          {PLANNED_MODULES.map((entry, index) => (
            <Reveal key={entry.key}>
              <li className="grid gap-x-8 gap-y-2 border-t py-7 md:grid-cols-[auto_minmax(0,16rem)_minmax(0,1fr)] sm:items-baseline">
                <Index n={index + 1} className="sm:pt-1" />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="font-serif text-section-sm font-semibold">{t(`site.modules.${entry.key}.title`)}</h3>
                  <Availability state="planned" />
                </div>
                <div className="min-w-0">
                  <p className="max-w-measure text-body leading-relaxed text-muted-foreground">{t(`site.modules.${entry.key}.text`)}</p>
                  <p className="mt-1.5 text-caption text-muted-foreground">{t(`site.product.for.${entry.side}`)}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ul>
        <p className="mt-10 max-w-measure text-label leading-relaxed text-muted-foreground">{t('site.product.planned.note')}</p>
      </Band>

      <Band tone="ink">
        <div className="max-w-[40rem]">
          <Display>{t('site.product.cta.title')}</Display>
          <p className="mt-6 max-w-measure text-lead text-background/70">{t('site.product.cta.lead')}</p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="xl" className="bg-background text-foreground hover:bg-background/90">
              <Link to="/register">
                {t('site.nav.createAccount')}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="xl" className="text-background hover:bg-background/10">
              <Link to="/how-it-works">{t('site.product.cta.how')}</Link>
            </Button>
          </div>
        </div>
      </Band>
    </>
  );
}
