import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { JourneyRail } from '@/features/auth/journey';
import type { JourneyStep } from '@/features/auth/journey-steps';
import { useMeta } from '@/shared/api/meta';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { ThemeSwitcher } from '@/shared/theme/theme-switcher';
import { BrandMark, SupportLink } from '@/shared/ui';

/**
 * The two-plane frame of the authentication and onboarding screens (Phase D).
 *
 * A navy aside flush to the viewport edge, and the work beside it on the plain canvas in one 26rem column.
 * One frame, because the five steps of creating an account span both sides of the sign-in boundary: steps 1
 * and 2 are guest routes and steps 3 and 4 need a session, and a user walking through them should not see the
 * page change shape halfway. Below `lg` the aside is not rendered: it holds no control, so on a phone it would
 * only push the first field below the fold.
 */
export function JourneyShell({
  step,
  actions,
  width = 'form',
  children,
}: {
  /** Shows the journey rail in the aside; without it the aside states what the platform does. */
  step?: JourneyStep;
  /** Signed-in chrome (the account menu on the onboarding steps). */
  actions?: ReactNode;
  /** `wide` is for the one step that is a form rather than a single question (business setup). */
  width?: 'form' | 'wide';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const meta = useMeta();
  const facts = ['verified', 'direct', 'oneAccount'] as const;
  const version = `v${meta.data?.version ?? '-'}`;
  return (
    <div className="min-h-screen bg-background font-sans text-foreground lg:grid lg:grid-cols-[21rem_minmax(0,1fr)] xl:grid-cols-[25rem_minmax(0,1fr)]">
      <aside className="hidden bg-aside lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:gap-10 lg:px-10 lg:py-10 xl:px-12">
        <div>
          <Link to="/" aria-label={t('common.appName')} className="inline-flex rounded-xl focus-visible:ring-offset-aside">
            <BrandMark tone="aside" size="md" />
          </Link>
          <p className="mt-8 max-w-[22rem] text-title-sm leading-relaxed text-aside-foreground">{t('auth.aside.statement')}</p>
        </div>
        <div className="max-w-[22rem]">
          {step ? (
            <JourneyRail current={step} />
          ) : (
            /*
             * Three factual lines about what the platform does. No numbers, no customer logos and no
             * quotations: there is no such evidence to show, and inventing it on a sign-in screen is the
             * thing this redesign exists to remove.
             */
            <dl className="space-y-5">
              {facts.map((fact) => (
                <div key={fact}>
                  <dt className="text-body-lg font-semibold text-aside-foreground">{t(`auth.aside.facts.${fact}.title`)}</dt>
                  <dd className="mt-1 text-label leading-relaxed text-aside-muted">{t(`auth.aside.facts.${fact}.text`)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-aside-border pt-6 text-caption text-aside-muted">
          <SupportLink tone="aside" />
          <p className="font-data">{version}</p>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        {/* The brand appears here only on phones, where the aside does not exist. */}
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3 sm:px-8 lg:justify-end lg:border-b-0 lg:px-10 lg:py-6">
          {/* `hidden`, not `invisible`: an invisible link still takes keyboard focus, and the aside has this one. */}
          <Link to="/" aria-label={t('common.appName')} className="rounded-xl lg:hidden">
            <BrandMark />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <LanguageSwitcher />
            {actions}
          </div>
        </div>
        <main className="flex flex-1 flex-col justify-center px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          <div className={cn('mx-auto w-full', width === 'wide' ? 'max-w-[34rem]' : 'max-w-[26rem]')}>{children}</div>
        </main>
        <footer className="px-5 pb-6 sm:px-8 lg:hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-4 text-caption text-muted-foreground">
            <SupportLink />
            <p className="font-data">{version}</p>
            <p className="basis-full">{t('auth.aside.rights', { year: new Date().getFullYear() })}</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
