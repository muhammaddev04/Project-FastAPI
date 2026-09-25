import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import type { PointerEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useOutlet } from 'react-router-dom';
import { useMeta } from '@/shared/api/meta';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { ThemeSwitcher } from '@/shared/theme/theme-switcher';
import { LogoMark, SupportLink } from '@/shared/ui';

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Which left-panel copy each auth route shows. */
function headlineKey(pathname: string): 'login' | 'register' | 'reset' | 'verify' {
  if (pathname.startsWith('/register')) return 'register';
  if (pathname.startsWith('/verify-email')) return 'verify';
  if (pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password')) return 'reset';
  return 'login';
}

/** "TezFarmo." wordmark with the blue full stop from the reference. */
function Wordmark() {
  return (
    <span className="group inline-flex items-center gap-2.5">
      <LogoMark inverted className="h-6 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105" />
      <span className="text-[1.25rem] font-extrabold italic tracking-[0.06em] text-white">
        TezFarmo<span className="text-[hsl(212_100%_58%)]">.</span>
      </span>
    </span>
  );
}

/** Deep-navy brand panel: gradient block, drifting glow, cross-fading headline per route. */
function BrandPanel() {
  const { t } = useTranslation();
  const key = headlineKey(useLocation().pathname);
  // Subtle pointer parallax for the glows (desktop pointers only; off with reduced motion).
  const reduced = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });
  const farX = useTransform(sx, (v) => v * -18);
  const farY = useTransform(sy, (v) => v * -14);
  const nearX = useTransform(sx, (v) => v * 10);
  const nearY = useTransform(sy, (v) => v * 8);
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (reduced || event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width - 0.5);
    py.set((event.clientY - rect.top) / rect.height - 0.5);
  };
  const onPointerLeave = () => {
    px.set(0);
    py.set(0);
  };
  return (
    <aside
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="relative overflow-hidden bg-[#030A24] text-white dark:bg-[#01040F] lg:sticky lg:top-0 lg:h-screen"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-br from-[#0A1647] via-[#0D1B5E] to-[#1B2E8C] dark:from-[#07102F] dark:via-[#0A1648] dark:to-[#15247A] sm:left-[8%] lg:bottom-[11%] lg:left-[13%] lg:top-[11%]"
      >
        <div className="absolute inset-0 opacity-[0.05] [background-image:repeating-linear-gradient(90deg,#fff_0,#fff_1px,transparent_1px,transparent_42px)]" />
        <motion.div className="absolute -right-24 -top-24" style={{ x: farX, y: farY }}>
          <motion.div
            className="size-80 rounded-full bg-[#2B4BD6]/25 blur-3xl"
            animate={{ x: [0, -28, 0], y: [0, 22, 0], scale: [1, 1.08, 1] }}
            transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>
        <motion.div className="absolute -bottom-32 left-10" style={{ x: nearX, y: nearY }}>
          <motion.div
            className="size-72 rounded-full bg-[#1E3FB8]/20 blur-3xl"
            animate={{ x: [0, 24, 0], y: [0, -18, 0] }}
            transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>
      </div>

      <div className="relative flex min-h-[15rem] flex-col justify-between gap-8 px-6 py-7 sm:px-12 lg:h-full lg:justify-center lg:gap-0 lg:py-0 lg:pl-[max(4rem,19%)] lg:pr-10">
        <Link to="/" aria-label={t('common.appName')} className="w-fit rounded lg:absolute lg:top-[19%]">
          <Wordmark />
        </Link>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <p className="text-[2.25rem] font-bold italic leading-[1.1] tracking-[-0.01em] sm:text-[3rem] lg:text-[3.75rem] xl:text-[4.25rem]">
              {t(`auth.split.${key}.headline`)}
            </p>
            <p className="mt-3 text-[1.25rem] font-normal italic leading-snug sm:text-[1.5rem] lg:mt-6 lg:text-[1.75rem] xl:text-[2rem]">
              <span className="block text-white/95">{t(`auth.split.${key}.line1`)}</span>
              <span className="block text-white/65">{t(`auth.split.${key}.line2`)}</span>
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </aside>
  );
}

/**
 * Auth layout route (reference design): the navy brand panel and the white/dark work area stay mounted while
 * the child card (login, register, reset, Google) animates in and out, so switching pages feels continuous.
 */
export function AuthShell() {
  const { t } = useTranslation();
  const meta = useMeta();
  const location = useLocation();
  const outlet = useOutlet();
  return (
    <div className="auth-theme min-h-screen bg-background text-foreground lg:grid lg:grid-cols-2">
      <BrandPanel />
      <section className="relative flex min-h-[calc(100vh-15rem)] flex-col bg-background lg:min-h-screen">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-[11%] left-0 right-[8%] hidden bg-background shadow-[0_30px_90px_-20px_rgba(15,23,42,0.18)] dark:shadow-[0_30px_90px_-20px_rgba(0,0,0,0.65)] lg:block"
        />
        <div className="relative flex items-center justify-end gap-2 px-5 pt-5 sm:px-8">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
        <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-8 lg:pr-[12%]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 16, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.985 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="w-full max-w-[25rem]"
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
          <div className="mt-8 flex flex-col items-center gap-2 text-center">
            <SupportLink />
            <p className="max-w-sm text-[0.75rem] text-muted-foreground">{t('auth.frame.terms')}</p>
            <p className="font-data text-[0.6875rem] text-muted-foreground/80">TezFarmo · v{meta.data?.version ?? '—'}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Compact form card: square-ish corners, soft shadow that deepens on hover, staggered rows. */
export function AuthCard({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[3px] bg-surface px-5 py-6 shadow-[0_10px_40px_-12px_rgba(15,23,42,0.22)] ring-1 ring-black/[0.03] transition-shadow duration-300 hover:shadow-[0_18px_50px_-14px_rgba(15,23,42,0.28)] dark:shadow-[0_18px_50px_-16px_rgba(0,0,0,0.7)] dark:ring-white/[0.06] sm:px-7 sm:py-7',
        className,
      )}
    >
      <h1 className="text-[1.375rem] font-semibold leading-tight text-foreground">{title}</h1>
      <div className="stagger-in mt-5">{children}</div>
    </div>
  );
}

/** Field label inside auth cards (reference: 12-13px, dark gray). */
export const authLabel = 'text-[0.8125rem] font-medium text-foreground/80';

/** Primary action on auth cards: bright blue, lifts on hover, presses on click. */
export const authPrimaryButton =
  'h-11 rounded-md text-[0.8125rem] shadow-[0_6px_16px_-8px_hsl(var(--primary)/0.8)] hover:-translate-y-px hover:shadow-[0_10px_22px_-8px_hsl(var(--primary)/0.85)] active:translate-y-0 active:scale-[0.99] disabled:shadow-none';

/** Bottom line of a card: muted question + blue link with a growing underline. */
export function CardSwitch({ question, to, link }: { question: string; to: string; link: string }) {
  return (
    <p className="mt-5 text-center text-[0.8125rem] text-muted-foreground">
      {question}{' '}
      <Link to={to} className="link-grow font-medium text-primary hover:text-primary-hover">
        {link}
      </Link>
    </p>
  );
}
