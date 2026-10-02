import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMeta } from '@/shared/api/meta';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { ThemeSwitcher } from '@/shared/theme/theme-switcher';
import { BrandMark, SupportLink } from '@/shared/ui';
import { JourneyProgress, JourneyRail } from './journey';
import type { JourneyStep } from './journey-steps';

/**
 * Frame of every authentication screen (Phase E, rebuilt).
 *
 * Phase D put the form in a 26rem column beside a 21rem navy slab. Phase E's first pass recoloured that slab
 * warm and called it done. Both were the same composition: a coloured panel on the left, chrome on the right.
 *
 * This is a different one. The page is one paper surface divided by a single hairline at roughly 46/54, and the
 * layout itself does the composing: no panel, no card around the form, no illustration. The left side is an
 * editorial column that says what TezFarmo is; the right is a narrow, disciplined form column. A visitor who
 * arrives from the homepage sees the same paper, the same serif and the same restraint, which is the only thing
 * that makes an authentication screen belong to a website.
 *
 * Below `lg` the editorial column collapses to a single line above the form, because on a phone the form is
 * the entire reason the page exists.
 */
export function AuthFrame({
  step,
  actions,
  width = 'form',
  children,
}: {
  /** Shows the numbered journey rail instead of the product statement. */
  step?: JourneyStep;
  /** Signed-in chrome (the account menu on the onboarding steps). */
  actions?: ReactNode;
  /** `wide` is for the one step that is a form rather than a single question (business setup). */
  width?: 'form' | 'wide';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const meta = useMeta();
  return (
    <div className="paper min-h-screen bg-background font-sans text-foreground lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
      {/* Editorial column. Paper, not a panel: the hairline is the only thing dividing the page. */}
      <aside className="hidden lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:gap-12 lg:border-r lg:px-12 lg:py-12 xl:px-16">
        <Link to="/" aria-label={t('common.appName')} className="w-fit rounded-xl">
          <BrandMark />
        </Link>

        <div className="max-w-[26rem]">
          {step ? (
            <JourneyRail current={step} />
          ) : (
            <>
              <p className="font-serif text-section font-semibold leading-[1.12]">{t('auth.aside.statement')}</p>
              <TwoSides />
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 text-caption text-muted-foreground">
          <Link to="/" className="link-grow inline-flex w-fit items-center gap-1.5 font-medium text-foreground/80 hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t('site.backToSite')}
          </Link>
          <SupportLink />
          <p className="font-data">v{meta.data?.version ?? '-'}</p>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3 sm:px-8 lg:justify-end lg:border-b-0 lg:px-10 lg:py-8">
          <Link to="/" aria-label={t('common.appName')} className="rounded-xl lg:hidden">
            <BrandMark />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <LanguageSwitcher />
            {actions}
          </div>
        </div>

        <main className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-8 lg:px-12 lg:py-12 xl:px-20">
          {/* The form column is narrow on purpose; the page, not a card, provides the composition around it. */}
          <div className={cn('w-full', width === 'wide' ? 'max-w-[32rem]' : 'max-w-[23rem]')}>
            {/* The one line of editorial copy the phone layout keeps. */}
            {step ? null : (
              <p className="mb-8 font-serif text-title font-semibold leading-snug lg:hidden">{t('auth.aside.statement')}</p>
            )}
            {step ? <JourneyProgress current={step} className="mb-8" /> : null}
            {children}
          </div>
        </main>

        <footer className="px-5 pb-8 sm:px-8 lg:hidden">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-5 text-caption text-muted-foreground">
            <Link to="/" className="link-grow inline-flex items-center gap-1.5 font-medium text-foreground/80 hover:text-foreground">
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              {t('site.backToSite')}
            </Link>
            <SupportLink />
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * The quietest possible statement of the model, for the editorial column: who the two sides are and the one
 * thing between them. Typography and two hairlines, with teal used once.
 */
function TwoSides() {
  const { t } = useTranslation();
  return (
    <dl className="mt-12 space-y-0 border-t">
      {(['company', 'store'] as const).map((side, index) => (
        <div key={side} className={cn('flex items-baseline justify-between gap-4 border-b py-3.5')}>
          <dt className="text-body font-medium">{t(`site.flow.${side}.title`)}</dt>
          <dd className="text-label text-muted-foreground">{t(`site.flow.${side}.role`)}</dd>
          {index === 0 ? null : null}
        </div>
      ))}
      <div className="flex items-center gap-2.5 pt-3.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
        <p className="text-label text-muted-foreground">{t('auth.aside.bridge')}</p>
      </div>
    </dl>
  );
}
