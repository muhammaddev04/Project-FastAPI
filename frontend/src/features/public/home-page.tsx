import { useState } from 'react';
import { ArrowDown, ArrowRight, Check, CheckCheck, Package, ShieldCheck, Sparkles, Store, Sun, Truck, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { JOURNEY_STEPS } from '@/features/auth/journey-steps';
import { Button } from '@/shared/ui';
import { Availability, Band, Display, Eyebrow, Frame, Lead, Reveal, Statement } from './primitives';
import { PLANNED_MODULES } from './roadmap';
const FEATURES = [
  { key: 'catalog', icon: Package, color: 'peach' },
  { key: 'delivery', icon: Truck, color: 'sage' },
  { key: 'finance', icon: Wallet, color: 'butter' },
] as const;
function Sunflower() {
  return <Sun className="day-sun" strokeWidth={1} aria-hidden="true" />;
}
export function HomePage() {
  const { t } = useTranslation();
  const [audience, setAudience] = useState<'company' | 'store'>('company');
  return (
    <>
      <section className="day-hero">
        <div className="day-hero-landscape" aria-hidden="true" />
        <Frame className="day-hero-content">
          <div className="day-kicker">
            <span />
            <span>{t('site.daylight.kicker')}</span>
          </div>
          <h1 className="font-serif text-hero day-hero-title">
            {t('site.daylight.title')}
            <br />
            <em>{t('site.daylight.titleAccent')}</em>
          </h1>
          <p className="day-hero-lead">{t('site.home.lead')}</p>
          <div className="day-hero-actions">
            <Button asChild size="xl" className="day-button">
              <Link to="/register">
                {t('site.nav.createAccount')}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Link className="day-text-link" to="/how-it-works">
              {t('site.home.seeHow')}
              <span className="day-round-arrow">
                <ArrowRight size={17} aria-hidden="true" />
              </span>
            </Link>
          </div>
          <p className="day-small-note">
            <Check size={14} aria-hidden="true" />
            {t('site.daylight.free')}
          </p>
        </Frame>
        <div className="day-hero-bottom">
          <span>TEZFARMO · B2B</span>
          <a href="#discover" aria-label={t('site.daylight.discover')}>
            <ArrowDown size={19} aria-hidden="true" />
          </a>
          <span>{t('site.daylight.location')}</span>
        </div>
      </section>
      <section className="day-intro" id="discover">
        <Frame>
          <Reveal>
            <Sunflower />
            <Eyebrow>{t('site.daylight.introLabel')}</Eyebrow>
            <Statement align="center">
              {t('site.daylight.introTitle')} <em>{t('site.daylight.introAccent')}</em>
            </Statement>
            <p className="day-centered-copy">{t('site.daylight.introText')}</p>
            <div className="day-connection">
              <span>{t('site.flow.company.title')}</span>
              <ArrowRight size={15} aria-hidden="true" />
              <span>{t('site.flow.steps.partnership.title')}</span>
              <ArrowRight size={15} aria-hidden="true" />
              <span>{t('site.flow.store.title')}</span>
            </div>
          </Reveal>
        </Frame>
      </section>
      <section className="day-audience">
        <Frame>
          <div className="day-audience-heading">
            <div>
              <Eyebrow>{t('site.daylight.audienceLabel')}</Eyebrow>
              <Display className="mt-4">{t('site.daylight.audienceTitle')}</Display>
            </div>
            <div className="day-tabs" role="tablist" aria-label={t('site.daylight.audienceLabel')}>
              {(['company', 'store'] as const).map((side) => (
                <button
                  key={side}
                  id={`audience-${side}`}
                  role="tab"
                  aria-selected={audience === side}
                  aria-controls="audience-panel"
                  tabIndex={audience === side ? 0 : -1}
                  onClick={() => setAudience(side)}
                  onKeyDown={(event) => {
                    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                      event.preventDefault();
                      const next =
                        event.key === 'Home' ? 'company' : event.key === 'End' ? 'store' : audience === 'company' ? 'store' : 'company';
                      setAudience(next);
                      document.getElementById(`audience-${next}`)?.focus();
                    }
                  }}
                >
                  {side === 'company' ? <Package size={16} /> : <Store size={16} />}
                  {t(`site.how.${side}.eyebrow`)}
                </button>
              ))}
            </div>
          </div>
          <div className="day-audience-grid" id="audience-panel" role="tabpanel" aria-labelledby={`audience-${audience}`}>
            <Reveal key={audience} className="day-audience-copy">
              <span className="day-overline">01 — {t(`site.how.${audience}.subtitle`)}</span>
              <h3 className="font-serif">{t(`site.how.${audience}.title`)}</h3>
              <Lead>{t(`site.how.${audience}.lead`)}</Lead>
              <ul>
                {(['first', 'second', 'third'] as const).map((key) => (
                  <li key={key}>
                    <CheckCheck size={18} aria-hidden="true" />
                    {t(`site.daylight.${audience}.${key}`)}
                  </li>
                ))}
              </ul>
              <Link to="/register" className="day-text-link">
                {t('site.nav.createAccount')}
                <ArrowRight size={18} />
              </Link>
            </Reveal>
            <div className={`day-product-scene ${audience}`}>
              <div className="day-scene-orbit" aria-hidden="true" />
              <Package className="day-scene-leaf" aria-hidden="true" />
              <div className="day-interface">
                <div className="day-interface-top">
                  <span className="day-mini-brand">
                    tezfarmo<span>✳</span>
                  </span>
                  <span className="day-interface-dot" />
                </div>
                <p className="day-interface-label">{t('site.daylight.preview')}</p>
                <div className="day-interface-title">{t(`site.how.${audience}.title`)}</div>
                <div className="day-interface-stats">
                  <div>
                    <ShieldCheck size={23} />
                    <span>{t('site.modules.verification.title')}</span>
                    <Availability state="live" />
                  </div>
                  <div>
                    <Store size={23} />
                    <span>{t('site.modules.partnerships.title')}</span>
                    <Availability state="planned" />
                  </div>
                </div>
                <div className="day-interface-list">
                  {FEATURES.map(({ key, icon: Icon }) => (
                    <div key={key}>
                      <span className={`day-mini-icon ${key}`}>
                        <Icon size={18} />
                      </span>
                      <span>{t(`site.modules.${key}.title`)}</span>
                      <ArrowRight size={15} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="day-float-note">
                <ShieldCheck size={20} />
                <span>{t('site.daylight.safe')}</span>
              </div>
              <span className="day-scene-caption">{t('site.daylight.concept')}</span>
            </div>
          </div>
        </Frame>
      </section>
      <section className="day-features">
        <Frame>
          <div className="day-section-center">
            <Eyebrow>{t('site.daylight.featuresLabel')}</Eyebrow>
            <Display className="mt-4">{t('site.daylight.featuresTitle')}</Display>
          </div>
          <div className="day-feature-grid">
            {FEATURES.map(({ key, icon: Icon, color }, i) => (
              <Reveal key={key} delay={i * 0.08}>
                <article className={`day-feature ${color}`}>
                  <div className="day-feature-art">
                    <Icon strokeWidth={1.15} aria-hidden="true" />
                    <span className="day-feature-ring" />
                    <span className="day-feature-number">0{i + 1}</span>
                  </div>
                  <h3 className="font-serif">{t(`site.modules.${key}.title`)}</h3>
                  <p>{t(`site.modules.${key}.text`)}</p>
                  <Availability state="planned" />
                </article>
              </Reveal>
            ))}
          </div>
        </Frame>
      </section>
      <section className="day-landscape-band">
        <figure>
          <img
            style={{ backgroundImage: 'var(--preview-delivery)', backgroundSize: 'cover' }}
            src="/media/tezfarmo-delivery.webp"
            srcSet="/media/tezfarmo-delivery-640.webp 640w, /media/tezfarmo-delivery.webp 1280w"
            sizes="(max-width: 640px) 100vw, 50vw"
            alt={t('site.media.delivery-run.alt')}
            loading="lazy"
            decoding="async"
          />
          <figcaption>
            <span className="day-kicker">{t('site.daylight.location')}</span>
            <h2 className="font-serif">{t('site.daylight.landscapeTitle')}</h2>
            <p>{t('site.daylight.landscapeText')}</p>
          </figcaption>
        </figure>
      </section>
      <section className="day-values">
        <Frame>
          <div className="day-section-center">
            <Sunflower />
            <Display>{t('site.home.truths.title')}</Display>
          </div>
          <div className="day-values-grid">
            {(['relationships', 'oneFlow', 'history'] as const).map((key, i) => (
              <Reveal key={key} delay={i * 0.08}>
                <span className="day-value-index">0{i + 1}</span>
                <h3 className="font-serif">{t(`site.home.truths.${key}.title`)}</h3>
                <p>{t(`site.home.truths.${key}.text`)}</p>
              </Reveal>
            ))}
          </div>
        </Frame>
      </section>
      <section className="day-setup">
        <Frame>
          <div className="day-setup-grid">
            <div>
              <Eyebrow>{t('site.home.setup.eyebrow')}</Eyebrow>
              <Display className="mt-4">{t('site.home.setup.title')}</Display>
              <Lead className="mt-6">{t('site.home.setup.lead')}</Lead>
              <Link to="/register" className="day-text-link mt-8">
                {t('site.nav.createAccount')}
                <ArrowRight size={18} />
              </Link>
            </div>
            <ol className="day-step-list">
              {JOURNEY_STEPS.map((step, i) => (
                <li key={step}>
                  <span className="day-step-number">{i + 1}</span>
                  <div>
                    <h3>{t(`auth.journey.steps.${step}.title`)}</h3>
                    <p>{t(`auth.journey.steps.${step}.hint`)}</p>
                  </div>
                  <ArrowRight size={18} aria-hidden="true" />
                </li>
              ))}
            </ol>
          </div>
        </Frame>
      </section>
      <section className="day-roadmap">
        <Frame>
          <div className="day-section-center">
            <Eyebrow>{t('site.home.roadmap.eyebrow')}</Eyebrow>
            <Display className="mt-4">{t('site.home.roadmap.title')}</Display>
            <p className="day-centered-copy">{t('site.home.roadmap.lead')}</p>
          </div>
          <div className="day-roadmap-grid">
            {PLANNED_MODULES.map((entry) => (
              <Link to="/product" key={entry.key} className="day-roadmap-item">
                <span>{t(`site.modules.${entry.key}.title`)}</span>
                <Availability state="planned" />
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </div>
          <Link className="day-text-link mt-8" to="/product">
            {t('site.home.roadmap.more')}
            <ArrowRight size={18} />
          </Link>
        </Frame>
      </section>
      <Band tone="ink" className="day-closing">
        <div className="day-closing-content">
          <Sparkles size={35} strokeWidth={1} aria-hidden="true" />
          <Eyebrow className="mt-5">{t('site.daylight.closingLabel')}</Eyebrow>
          <Display className="mt-4">{t('site.home.cta.title')}</Display>
          <p className="day-centered-copy">{t('site.home.cta.lead')}</p>
          <Button asChild size="xl" className="day-button">
            <Link to="/register">
              {t('site.nav.createAccount')}
              <ArrowRight />
            </Link>
          </Button>
          <p className="day-small-note">{t('site.daylight.free')}</p>
        </div>
      </Band>
    </>
  );
}
