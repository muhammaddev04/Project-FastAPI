import { Building2, ShieldCheck, Store, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { BrandMark } from '@/shared/ui';

const POINTS = [
  { icon: Building2, key: 'companies' },
  { icon: Store, key: 'stores' },
  { icon: Truck, key: 'delivery' },
  { icon: ShieldCheck, key: 'trust' },
] as const;

/** Split auth frame: product context on the left (desktop), focused form on the right. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar px-10 py-9 text-sidebar-foreground lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(hsl(var(--sidebar-foreground))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--sidebar-foreground))_1px,transparent_1px)] [background-size:32px_32px]"
        />
        <Link to="/" className="relative w-fit" aria-label={t('common.appName')}>
          <BrandMark inverted />
        </Link>
        <div className="relative max-w-md">
          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-sidebar-muted">{t('auth.layout.eyebrow')}</p>
          <h2 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-tight">{t('auth.layout.headline')}</h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map(({ icon: Icon, key }) => (
              <li key={key} className="flex gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-active">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{t(`auth.layout.points.${key}.title`)}</span>
                  <span className="block text-[0.8125rem] text-sidebar-muted">{t(`auth.layout.points.${key}.text`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-2xs text-sidebar-muted">{t('auth.layout.footnote')}</p>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" className="lg:invisible" aria-label={t('common.appName')}>
            <BrandMark />
          </Link>
          <LanguageSwitcher />
        </header>
        <main className="flex flex-1 items-start justify-center px-5 pb-12 pt-4 sm:items-center sm:px-8">
          <div className="w-full max-w-[26rem] animate-fade-in">
            <h1 className="text-[1.5rem] font-semibold tracking-tight">{title}</h1>
            {subtitle ? <p className="mt-1.5 text-[0.875rem] text-muted-foreground">{subtitle}</p> : null}
            <div className="mt-7">{children}</div>
            {footer ? <div className="mt-8 border-t pt-5 text-center text-[0.8125rem] text-muted-foreground">{footer}</div> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
