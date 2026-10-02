import { ArrowRight, Building2, Store, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { Availability, Display, Eyebrow, Lead, Reveal, Section } from './primitives';
import { LIVE_MODULES, PLANNED_MODULES, type ModuleEntry } from './roadmap';

const SIDE_ICON = { company: Building2, store: Store, both: Users } as const;

/**
 * One capability.
 *
 * The live and the planned entries use the same row, with the same weight, and differ only in their marker and
 * in the tense of their sentence. Styling the planned ones as faded placeholders would make the product look
 * broken; styling them identically to the live ones would be a lie. The marker carries the difference.
 */
function Module({ entry }: { entry: ModuleEntry }) {
  const { t } = useTranslation();
  const Icon = SIDE_ICON[entry.side];
  return (
    <Reveal>
      <div className="flex gap-4 border-t py-6">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h3 className="text-body-lg font-semibold">{t(`site.modules.${entry.key}.title`)}</h3>
            <Availability state={entry.phase ? 'planned' : 'live'} phase={entry.phase} />
          </div>
          <p className="mt-1.5 max-w-measure text-body leading-relaxed text-muted-foreground">
            {t(`site.modules.${entry.key}.text`)}
          </p>
          <p className="mt-2 text-label text-muted-foreground">
            {t(`site.product.for.${entry.side}`)}
          </p>
        </div>
      </div>
    </Reveal>
  );
}

export function ProductPage() {
  const { t } = useTranslation();
  return (
    <>
      <Section space="tight" className="pt-14 sm:pt-20 lg:pt-24">
        <div className="max-w-3xl">
          <Eyebrow>{t('site.product.eyebrow')}</Eyebrow>
          <Display as="h1" size="hero" className="mt-5">
            {t('site.product.title')}
          </Display>
          <Lead className="mt-6">{t('site.product.lead')}</Lead>
        </div>
      </Section>

      {/* What a visitor gets the day they sign up. */}
      <Section tone="sunk" hairline>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <Eyebrow>{t('site.product.live.eyebrow')}</Eyebrow>
            <Display size="section" className="mt-4">
              {t('site.product.live.title')}
            </Display>
            <Lead className="mt-5 text-body">{t('site.product.live.lead')}</Lead>
          </div>
          <div className="border-b">
            {LIVE_MODULES.map((entry) => (
              <Module key={entry.key} entry={entry} />
            ))}
          </div>
        </div>
      </Section>

      {/* What is specified and being built, in product language, with the phase tag kept small. */}
      <Section hairline>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <Eyebrow>{t('site.product.planned.eyebrow')}</Eyebrow>
            <Display size="section" className="mt-4">
              {t('site.product.planned.title')}
            </Display>
            <Lead className="mt-5 text-body">{t('site.product.planned.lead')}</Lead>
            <p className="mt-5 max-w-measure text-label leading-relaxed text-muted-foreground">
              {t('site.product.planned.note')}
            </p>
          </div>
          <div className="border-b">
            {PLANNED_MODULES.map((entry) => (
              <Module key={entry.key} entry={entry} />
            ))}
          </div>
        </div>
      </Section>

      <Section tone="ink">
        <div className="max-w-2xl">
          <Display className="text-background">{t('site.product.cta.title')}</Display>
          <p className="mt-5 max-w-measure text-lead text-background/75">{t('site.product.cta.lead')}</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
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
      </Section>
    </>
  );
}
