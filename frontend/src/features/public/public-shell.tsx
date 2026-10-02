import { MotionConfig } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMeta } from '@/shared/api/meta';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { ThemeSwitcher } from '@/shared/theme/theme-switcher';
import { BrandMark, Button, SupportLink } from '@/shared/ui';
import { Frame } from './primitives';

/** The three public pages, in the order the argument is made. */
export const PUBLIC_NAV = [
  { to: '/', key: 'home' },
  { to: '/how-it-works', key: 'howItWorks' },
  { to: '/product', key: 'product' },
] as const;

/**
 * Public header (Phase E).
 *
 * Thin, like the reference's 44px bar: a marketing header that is as tall as an application toolbar reads as
 * chrome, and chrome is not what the first screen is for. It is sticky but not blurred, because a translucent
 * bar over a warm ground turns the paper grey as the page scrolls under it.
 */
function Header() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // A route change closes the sheet, including a hash link to a section of the page already shown.
  useEffect(() => setOpen(false), [pathname]);
  // The sheet covers the page, so the page must not scroll behind it, and Escape must close it.
  useEffect(() => {
    if (!open) return undefined;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-lg px-1 py-1 text-body font-medium transition-colors duration-fast',
      isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
    );

  return (
    <header className="sticky top-0 z-30 border-b bg-background">
      <Frame>
        <div className="flex h-14 items-center justify-between gap-4 lg:h-16">
          <Link to="/" aria-label={t('common.appName')} className="rounded-xl">
            <BrandMark />
          </Link>

          <nav aria-label={t('site.nav.label')} className="hidden items-center gap-7 lg:flex">
            {PUBLIC_NAV.map(({ to, key }) => (
              <NavLink key={to} to={to} end={to === '/'} className={link}>
                {t(`site.nav.${key}`)}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher className="hidden sm:inline-flex" />
            <ThemeSwitcher className="hidden sm:inline-flex" />
            <Button asChild variant="ghost" size="md" className="hidden sm:inline-flex">
              <Link to="/login">{t('site.nav.signIn')}</Link>
            </Button>
            <Button asChild size="md" className="hidden sm:inline-flex">
              <Link to="/register">{t('site.nav.createAccount')}</Link>
            </Button>
            <button
              type="button"
              aria-expanded={open}
              aria-controls="public-menu"
              aria-label={open ? t('common.close') : t('site.nav.menu')}
              onClick={() => setOpen((value) => !value)}
              className="flex size-10 items-center justify-center rounded-xl border text-foreground transition-colors duration-fast hover:bg-subtle lg:hidden"
            >
              {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </Frame>

      {/*
       * A full sheet rather than a dropdown. On a phone the three destinations and the two actions are the
       * whole header, and a 280px panel hanging off the right edge makes the primary action the smallest
       * target on screen.
       */}
      {open ? (
        <div id="public-menu" className="fixed inset-x-0 bottom-0 top-14 z-30 overflow-y-auto border-t bg-background lg:hidden">
          <Frame className="flex min-h-full flex-col gap-8 py-8">
            <nav aria-label={t('site.nav.label')} className="flex flex-col">
              {PUBLIC_NAV.map(({ to, key }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'border-b py-4 font-serif text-section-sm font-semibold transition-colors',
                      isActive ? 'text-primary' : 'text-foreground',
                    )
                  }
                >
                  {t(`site.nav.${key}`)}
                </NavLink>
              ))}
            </nav>
            <div className="flex flex-col gap-2.5">
              <Button asChild size="xl" block>
                <Link to="/register">{t('site.nav.createAccount')}</Link>
              </Button>
              <Button asChild variant="secondary" size="xl" block>
                <Link to="/login">{t('site.nav.signIn')}</Link>
              </Button>
            </div>
            <div className="mt-auto flex items-center justify-between gap-3 border-t pt-6">
              <LanguageSwitcher />
              <ThemeSwitcher />
            </div>
          </Frame>
        </div>
      ) : null}
    </header>
  );
}

function Footer() {
  const { t } = useTranslation();
  const meta = useMeta();
  return (
    <footer className="border-t bg-subtle/50">
      <Frame className="py-12 lg:py-16">
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
          <div className="max-w-sm">
            <BrandMark />
            <p className="mt-4 text-label leading-relaxed text-muted-foreground">{t('site.footer.about')}</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:gap-16">
            <div>
              <h2 className="text-label font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('site.footer.siteTitle')}</h2>
              <ul className="mt-3 space-y-2">
                {PUBLIC_NAV.map(({ to, key }) => (
                  <li key={to}>
                    <Link to={to} className="link-grow text-body text-foreground/90 hover:text-foreground">
                      {t(`site.nav.${key}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-label font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('site.footer.accountTitle')}</h2>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link to="/login" className="link-grow text-body text-foreground/90 hover:text-foreground">
                    {t('site.nav.signIn')}
                  </Link>
                </li>
                <li>
                  <Link to="/register" className="link-grow text-body text-foreground/90 hover:text-foreground">
                    {t('site.nav.createAccount')}
                  </Link>
                </li>
                <li className="pt-1">
                  <SupportLink />
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t pt-6 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{t('site.footer.rights', { year: new Date().getFullYear() })}</p>
          <p className="font-data">v{meta.data?.version ?? '-'}</p>
        </div>
      </Frame>
    </footer>
  );
}

/**
 * Layout route for the public site.
 *
 * `paper` is what switches the semantic tokens to the warm ground, so every shared component inside renders in
 * the public palette without knowing it. The authenticated application does not carry this class and keeps the
 * Phase C system unchanged.
 */
export function PublicShell({ children }: { children?: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="paper flex min-h-screen flex-col bg-background font-sans text-foreground">
        <Header />
        {/* `/` is not a child route: it decides between the homepage and a signed-in user's destination first. */}
        <main className="flex-1">{children ?? <Outlet />}</main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
