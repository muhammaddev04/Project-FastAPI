import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMeta } from '@/shared/api/meta';
import { SUPPORTED_LANGUAGES, currentLanguage, setLanguage, type Language } from '@/shared/i18n';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { FadeIn, LogoMark, SegmentedControl, SupportLink } from '@/shared/ui';

/** Square brand tile: logo on white inside a tinted frame, optionally with a live status dot. */
export function LogoTile({ size = 'sm', live = false }: { size?: 'sm' | 'lg'; live?: boolean }) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        size === 'lg' ? 'size-[7.5rem] rounded-2xl bg-muted/60 p-2.5' : 'size-12 rounded-md bg-subtle p-1',
      )}
    >
      <span className={cn('flex size-full items-center justify-center bg-surface', size === 'lg' ? 'rounded-xl' : 'rounded')}>
        <LogoMark className={size === 'lg' ? 'h-12' : 'h-6'} />
      </span>
      {live ? (
        <span aria-hidden="true" className="absolute -bottom-1 -right-1 size-5 rounded-full border-[3px] border-background bg-primary" />
      ) : null}
    </span>
  );
}

/** Page frame for every auth screen: brand bar, centered content, support/terms footer. */
export function AuthFrame({ children, width = 'wide' }: { children: ReactNode; width?: 'wide' | 'narrow' }) {
  const { t } = useTranslation();
  const meta = useMeta();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/" className="flex items-center gap-3 rounded-md" aria-label={t('common.appName')}>
          <LogoTile />
          <span className="text-[1.375rem] font-semibold tracking-tight text-primary">TezFarmo</span>
        </Link>
        <LanguageSwitcher />
      </header>

      <main className={cn('mx-auto w-full flex-1 px-4 pb-10 sm:px-6', width === 'narrow' ? 'max-w-[34rem]' : 'max-w-[117rem]')}>
        <FadeIn>{children}</FadeIn>
      </main>

      <footer className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 pb-8 text-center">
        <SupportLink />
        <p className="text-[0.8125rem] text-muted-foreground">{t('auth.frame.terms')}</p>
        <p className="font-data text-[0.75rem] text-muted-foreground">
          TezFarmo · v{meta.data?.version ?? '—'}
        </p>
      </footer>
    </div>
  );
}

/** Centered hero used by sign-in style screens (logo tile, API status chip, serif title, language pills). */
export function AuthHero({ title, subtitle }: { title: ReactNode; subtitle: ReactNode }) {
  const { t } = useTranslation();
  const meta = useMeta();
  return (
    <div className="flex flex-col items-center pb-6 pt-6 text-center sm:pt-10">
      <LogoTile size="lg" live={meta.isSuccess} />
      <span className="mt-4 inline-flex items-center gap-2 rounded-full border bg-subtle px-3 py-1 text-[0.8125rem] font-medium text-muted-foreground">
        <span
          aria-hidden="true"
          className={cn('size-2 rounded-full', meta.isSuccess ? 'bg-primary/60' : meta.isError ? 'bg-danger' : 'bg-muted-foreground/40')}
        />
        {meta.isSuccess
          ? t('auth.frame.apiOnline', { version: meta.data.version })
          : meta.isError
            ? t('auth.frame.apiOffline')
            : t('common.loading')}
      </span>
      <h1 className="mt-3 font-display text-[1.75rem] font-bold leading-tight text-foreground sm:text-[2rem]">{title}</h1>
      <p className="mt-2 max-w-md text-[1.0625rem] leading-7 text-muted-foreground">{subtitle}</p>
      <SegmentedControl<Language>
        className="mt-4"
        size="md"
        label={t('common.language')}
        value={currentLanguage()}
        onChange={setLanguage}
        options={SUPPORTED_LANGUAGES.map((language) => ({ value: language, label: t(`languages.${language}`) }))}
      />
    </div>
  );
}

/** White form surface of the sign-in screen. */
export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border bg-surface p-4 shadow-raised sm:p-6', className)}>{children}</div>;
}

/** Tinted inline notice row (e.g. "Professional access"). */
export function NoticeRow({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex gap-3 rounded bg-subtle px-4 py-3 sm:px-6">
      {icon ? <span className="mt-0.5 shrink-0 text-primary [&_svg]:size-5">{icon}</span> : null}
      <div>
        <p className="text-[0.9375rem] font-semibold text-primary">{title}</p>
        {children ? <p className="text-[0.875rem] text-muted-foreground">{children}</p> : null}
      </div>
    </div>
  );
}
