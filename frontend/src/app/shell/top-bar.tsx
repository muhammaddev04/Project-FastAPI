import type { ReactNode } from 'react';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { ThemeSwitcher } from '@/shared/theme/theme-switcher';
import { SupportButton } from '@/shared/ui';

/**
 * The chrome top bar of every page outside an organization area (sign-in screens, account, onboarding, status
 * pages): brand on the left, optional center content, then support, theme and language on the right.
 */
export function TopBar({
  start,
  center,
  end,
  tone = 'chrome',
  wide = false,
  className,
}: {
  start: ReactNode;
  center?: ReactNode;
  end?: ReactNode;
  /** `clear`: translucent bar of the sign-in screens, the page glow shows through. */
  tone?: 'chrome' | 'clear';
  /** Full-width bar with the larger large-screen proportions of the sign-in reference. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'sticky top-0 z-20 border-x-0 border-t-0 border-b',
        tone === 'clear' ? 'border-border/60 bg-surface/50 backdrop-blur-md dark:border-white/[0.06] dark:bg-brand-night/60' : 'chrome',
        className,
      )}
    >
      <div
        className={cn(
          'mx-auto flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-10 short:lg:h-16',
          wide ? 'max-w-none lg:h-[4.75rem] 2xl:h-[7.5rem] 2xl:px-12' : 'max-w-[90rem]',
          tone === 'clear' && !wide ? 'lg:h-[4.75rem]' : !wide && 'lg:h-[4.5rem]',
        )}
      >
        <div className="flex min-w-0 items-center">{start}</div>
        {center}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <SupportButton className="hidden sm:flex" large={wide} />
          <ThemeSwitcher className="hidden bg-surface/50 sm:inline-flex" />
          <LanguageSwitcher className="bg-surface/50 2xl:p-1" size={wide ? 'hero' : 'sm'} />
          {end}
        </div>
      </div>
    </header>
  );
}
