import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMeta } from '@/shared/api/meta';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { ThemeSwitcher } from '@/shared/theme/theme-switcher';
import { cn } from '@/shared/lib/cn';
import { BrandMark, SupportLink } from '@/shared/ui';
import { JourneyProgress, JourneyRail } from './journey';
import type { JourneyStep } from './journey-steps';
import '@/features/public/daylight.css';

/** Shared frame for account access and the registration journey. */
export function AuthFrame({
  step,
  actions,
  width = 'form',
  accountForm = false,
  children,
}: {
  /** Shows the numbered journey rail instead of the product statement. */
  step?: JourneyStep;
  accountForm?: boolean;
  /** Signed-in chrome (the account menu on the onboarding steps). */
  actions?: ReactNode;
  /** `wide` is for the one step that is a form rather than a single question (business setup). */
  width?: 'form' | 'wide';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const meta = useMeta();
  if (accountForm) {
    return (
      <div className="paper daylight-auth auth-access min-h-screen font-sans text-foreground">
        <header className="auth-access-header">
          <Link to="/" aria-label={t('common.appName')} className="w-fit rounded-xl"><BrandMark /></Link>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Link to="/" className="auth-back-link">
              <ArrowLeft className="size-4" aria-hidden="true" />{t('site.backToSite')}
            </Link>
            <LanguageSwitcher /><ThemeSwitcher />{actions}
          </div>
        </header>
        <div className="auth-access-content">
          <aside className="auth-editorial-copy">
            <p className="auth-statement font-serif">{t('auth.aside.statement')}</p>
            <TwoSides />
          </aside>
          <main><div className="auth-access-column">{children}</div></main>
        </div>
        <footer className="auth-access-footer"><SupportLink className="auth-support-link" /><span className="font-data">v{meta.data?.version ?? '-'}</span></footer>
      </div>
    );
  }
  return (
    <div className={cn(accountForm && 'auth-access', "paper daylight-auth min-h-screen bg-background font-sans text-foreground lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]")}>
      <aside className="hidden lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:gap-12 lg:border-r lg:px-12 lg:py-12 xl:px-16">
        <Link to="/" aria-label={t('common.appName')} className="w-fit rounded-xl">
          <BrandMark />
        </Link>

        <div className={cn('max-w-[26rem]', accountForm && 'auth-editorial-copy')}>
          {step && !accountForm ? (
            <JourneyRail current={step} />
          ) : (
            <>
              <p className="auth-statement font-serif text-section font-semibold leading-[1.12]">{t('auth.aside.statement')}</p>
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 sm:px-8 lg:justify-end lg:border-b-0 lg:px-10 lg:py-8">
          <Link to="/" aria-label={t('common.appName')} className="rounded-xl lg:hidden">
            <BrandMark />
          </Link>
          {accountForm ? (
            <Link to="/" className="auth-back-link">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('site.backToSite')}
            </Link>
          ) : null}
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeSwitcher />
            {actions}
          </div>
        </div>

        <main className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-8 lg:px-12 lg:py-12 xl:px-20">
          <div className={cn('w-full', width === 'wide' ? 'max-w-[32rem]' : accountForm ? 'auth-access-column max-w-[30rem]' : 'max-w-[26rem]')}>
            {/* The one line of editorial copy the phone layout keeps. */}
            {step && !accountForm ? null : (
              <p className="auth-mobile-statement mb-8 font-serif text-title font-semibold leading-snug lg:hidden">{t('auth.aside.statement')}</p>
            )}
            {step && !accountForm ? <JourneyProgress current={step} className="mb-8" /> : null}
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
