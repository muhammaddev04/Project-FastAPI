import type { ReactNode } from 'react';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { ThemeSwitcher } from '@/shared/theme/theme-switcher';
import { SupportButton } from '@/shared/ui';

/**
 * The chrome top bar of pages outside an organization area (account, status pages): brand on the left,
 * optional center content, then support, theme and language on the right.
 *
 * Phase D removed `tone="clear"` and `wide`. Both existed for the old sign-in chrome: `clear` made the bar
 * translucent so the page-sized gradient could show through it, and `wide` stretched it full-width and grew
 * every control one step at 2xl to match a screenshot. The authentication screens have their own frame now,
 * and nothing else ever asked for either, so the bar has one appearance.
 */
export function TopBar({
  start,
  center,
  end,
  className,
}: {
  start: ReactNode;
  center?: ReactNode;
  end?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('chrome sticky top-0 z-20 border-x-0 border-t-0 border-b', className)}>
      <div className="mx-auto flex h-16 max-w-[90rem] items-center justify-between gap-3 px-4 sm:px-6 lg:h-[4.5rem] lg:px-10">
        <div className="flex min-w-0 items-center">{start}</div>
        {center}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <SupportButton className="hidden sm:flex" />
          <ThemeSwitcher className="hidden bg-surface/50 sm:inline-flex" />
          <LanguageSwitcher className="bg-surface/50" />
          {end}
        </div>
      </div>
    </header>
  );
}
