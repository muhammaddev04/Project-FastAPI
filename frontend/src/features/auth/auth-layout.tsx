import { AnimatePresence, MotionConfig, motion, type Variants } from 'framer-motion';
import { BadgeCheck, LogIn, Send, ShieldCheck, Store, UserPlus, Zap } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation, useOutlet } from 'react-router-dom';
import { useMeta } from '@/shared/api/meta';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { ThemeSwitcher } from '@/shared/theme/theme-switcher';
import { LogoMark } from '@/shared/ui';
import { SUPPORT_TELEGRAM } from '@/shared/ui/support-link';

const EASE = [0.2, 0.8, 0.2, 1] as const;

const stagger: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } } };
const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

/** Soft glows and large outlined circles behind the page (screenshots); they drift slowly and stay out of the way. */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_12%_18%,rgba(37,99,235,0.12),transparent_60%),radial-gradient(60%_60%_at_95%_90%,rgba(13,148,136,0.10),transparent_60%)] dark:bg-[radial-gradient(90%_70%_at_12%_18%,rgba(29,78,216,0.42),transparent_60%),radial-gradient(60%_60%_at_95%_90%,rgba(8,145,178,0.2),transparent_60%)]" />
      <motion.div
        className="absolute -left-[14rem] top-16 size-[44rem] rounded-full border border-blue-700/10 bg-blue-700/[0.03] dark:border-white/[0.06] dark:bg-white/[0.025]"
        animate={{ x: [0, 18, 0], y: [0, -12, 0] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-[16rem] -right-[10rem] size-[40rem] rounded-full border border-teal-700/10 dark:border-cyan-300/10"
        animate={{ x: [0, -16, 0], y: [0, 10, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Mobile: the coloured blobs that frame the card in the phone screenshot. */}
      <div className="absolute -left-24 -top-24 size-72 rounded-full bg-blue-500/20 blur-3xl dark:bg-blue-500/30 lg:hidden" />
      <div className="absolute -right-20 top-1/3 size-64 rounded-full bg-cyan-400/15 blur-3xl lg:hidden" />
    </div>
  );
}

/** Teal tile with the TezFarmo mark, "Tez" + gradient "Farmo", and the B2B NETWORK tag. */
function Brand() {
  const { t } = useTranslation();
  return (
    <Link to="/login" aria-label={t('common.appName')} className="group flex min-w-0 items-center gap-2.5 rounded-xl sm:gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2DD4BF] to-[#0D9488] shadow-[0_8px_24px_-8px_rgba(45,212,191,0.65)] transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105 lg:size-12 lg:rounded-2xl">
        <LogoMark inverted className="h-5 lg:h-6" />
      </span>
      <span className="auth-display text-[1.375rem] font-extrabold leading-none lg:text-[1.75rem]">
        Tez<span className="auth-brand-text">Farmo</span>
      </span>
      <span className="hidden rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-[0.625rem] font-bold leading-none tracking-[0.12em] text-primary sm:inline-block">
        {t('auth.shell.network')}
      </span>
    </Link>
  );
}

function Header() {
  const { t } = useTranslation();
  return (
    <header className="relative z-10 border-b border-border/60 bg-surface/50 backdrop-blur-md dark:border-white/[0.06] dark:bg-[#050D22]/60">
      <div className="mx-auto flex h-16 max-w-[90rem] items-center justify-between gap-3 px-4 sm:px-6 lg:h-[4.75rem] lg:px-10">
        <Brand />
        <div className="hidden h-11 items-center gap-4 rounded-full border border-border/80 bg-surface/40 px-5 text-[0.8125rem] font-medium text-foreground/85 xl:flex">
          <span className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
              <span className="relative size-2.5 rounded-full bg-primary" />
            </span>
            {t('auth.shell.pillNetwork')}
          </span>
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            {t('auth.shell.pillVerified')}
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={`https://t.me/${SUPPORT_TELEGRAM}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${t('common.support')} @${SUPPORT_TELEGRAM}`}
            className="group hidden items-center gap-2.5 rounded-full text-[0.875rem] font-medium text-foreground/85 transition-colors hover:text-foreground sm:flex"
          >
            <span className="flex size-9 items-center justify-center rounded-full border border-border bg-surface/50 text-primary transition-[transform,border-color] duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/50 lg:size-10">
              <Send className="size-4" aria-hidden="true" />
            </span>
            <span className="hidden lg:inline">@{SUPPORT_TELEGRAM}</span>
          </a>
          <ThemeSwitcher className="hidden bg-surface/50 sm:inline-flex" />
          <LanguageSwitcher className="bg-surface/50" />
        </div>
      </div>
    </header>
  );
}

/** Desktop-only left column: badge, large headline, two feature cards and the "verified network" line. */
function Hero() {
  const { t } = useTranslation();
  const features = [
    { icon: Zap, title: t('auth.shell.fastTitle'), text: t('auth.shell.fastText') },
    { icon: BadgeCheck, title: t('auth.shell.verifiedTitle'), text: t('auth.shell.verifiedText') },
  ];
  return (
    <motion.section variants={stagger} initial="hidden" animate="shown" className="hidden lg:block" aria-label={t('auth.shell.heroBadge')}>
      <motion.p
        variants={rise}
        className="inline-flex h-10 items-center gap-2.5 rounded-full border border-primary/30 bg-primary/10 px-4 text-[0.875rem] font-semibold text-primary"
      >
        <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
        {t('auth.shell.heroBadge')}
      </motion.p>
      <motion.h2
        variants={rise}
        className="auth-display mt-7 text-[2.5rem] font-black leading-[1.06] xl:text-[3.25rem] 2xl:text-[3.75rem]"
      >
        <span className="block">{t('auth.shell.heroLine1')}</span>
        <span className="block">{t('auth.shell.heroLine2')}</span>
        <span className="auth-brand-text block pb-1">{t('auth.shell.heroAccent')}</span>
      </motion.h2>
      <motion.p variants={rise} className="mt-6 max-w-[36rem] text-[1.0625rem] leading-relaxed text-muted-foreground xl:text-[1.1875rem]">
        {t('auth.shell.heroText')}
      </motion.p>
      <motion.ul variants={rise} className="mt-10 grid max-w-[48rem] grid-cols-2 gap-4 xl:gap-5">
        {features.map(({ icon: Icon, title, text }) => (
          <li
            key={title}
            className="rounded-2xl border border-border bg-surface/60 p-5 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_18px_40px_-20px_rgba(13,148,136,0.45)] xl:p-6"
          >
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-4 text-[1.0625rem] font-bold">{title}</p>
            <p className="mt-1.5 text-[0.875rem] leading-snug text-muted-foreground">{text}</p>
          </li>
        ))}
      </motion.ul>
      <motion.div variants={rise} className="mt-10 flex items-center gap-4">
        <span className="flex -space-x-2.5" aria-hidden="true">
          <span className="flex size-10 items-center justify-center rounded-full border-2 border-background bg-[#0D9488] text-[0.75rem] font-bold text-white">TF</span>
          <span className="flex size-10 items-center justify-center rounded-full border-2 border-background bg-[#1D4ED8] text-[0.6875rem] font-bold text-white">B2B</span>
          <span className="flex size-10 items-center justify-center rounded-full border-2 border-background bg-[#6D28D9] text-white">
            <Store className="size-4" />
          </span>
        </span>
        <p className="max-w-[30rem] text-[0.9375rem] text-muted-foreground">{t('auth.shell.joinText')}</p>
      </motion.div>
    </motion.section>
  );
}

function Footer() {
  const { t } = useTranslation();
  const meta = useMeta();
  return (
    <footer className="relative z-10 border-t border-border/60 bg-surface/40 dark:border-white/[0.06] dark:bg-[#040A1C]/70">
      <div className="mx-auto flex max-w-[90rem] flex-col items-center gap-1.5 px-4 py-4 text-center text-[0.75rem] text-muted-foreground sm:px-6 lg:flex-row lg:justify-between lg:px-10 lg:py-5 lg:text-[0.8125rem]">
        {/* On phones the theme switch lives here so the header keeps logo + language on one row. */}
        <ThemeSwitcher className="mb-1.5 bg-surface/50 sm:hidden" />
        <p className="font-data">TezFarmo · v{meta.data?.version ?? '—'}</p>
        <p>{t('auth.shell.rights', { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}

/**
 * Auth layout route (navy/teal screenshots): header, desktop hero and footer stay mounted while the card
 * content (login, register, verify, forgot/reset, Google) cross-fades inside one persistent card frame.
 */
export function AuthShell() {
  const location = useLocation();
  const outlet = useOutlet();
  return (
    <MotionConfig reducedMotion="user">
      <div className="auth-theme relative flex min-h-screen flex-col overflow-x-hidden bg-background font-sans text-foreground">
        <Backdrop />
        <Header />
        <main className="relative z-10 mx-auto grid w-full max-w-[90rem] flex-1 items-center gap-10 px-4 py-6 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_31rem] lg:gap-12 lg:px-10 lg:py-12 xl:grid-cols-[minmax(0,1fr)_34rem] xl:gap-16">
          <Hero />
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="mx-auto w-full max-w-[31rem] rounded-[2rem] border border-border bg-surface/90 px-5 py-7 shadow-[0_30px_80px_-30px_rgba(15,27,58,0.28)] backdrop-blur-xl dark:border-white/10 dark:bg-surface/80 dark:shadow-[0_40px_100px_-30px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-9 sm:py-9 lg:max-w-none lg:rounded-[1.75rem] xl:px-10 xl:py-11"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: EASE }}
              >
                {outlet}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}

/** Heading copy with the brand word in the teal→blue gradient, e.g. "Welcome to <b>TezFarmo</b>". */
export function BrandTitle({ i18nKey }: { i18nKey: string }) {
  return <Trans i18nKey={i18nKey} components={{ b: <span className="auth-brand-text" /> }} />;
}

/** Remembers the last tab route so the selection plate slides in from the tab the user came from. */
let lastTab: '/login' | '/register' | null = null;

/** Login | Register switch from the screenshots (links, so each form keeps its own URL). */
export function AuthTabs() {
  const { t } = useTranslation();
  const current = useLocation().pathname.startsWith('/register') ? '/register' : '/login';
  const from = useRef(lastTab);
  lastTab = current;
  const tabs = [
    { to: '/login' as const, icon: LogIn, label: t('auth.shell.tabLogin') },
    { to: '/register' as const, icon: UserPlus, label: t('auth.shell.tabRegister') },
  ];
  const slideFrom = from.current && from.current !== current ? (current === '/register' ? '-100%' : '100%') : 0;
  return (
    <nav aria-label={t('auth.shell.tabsLabel')} className="mt-7 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-subtle/60 p-1.5">
      {tabs.map(({ to, icon: Icon, label }) => {
        const active = to === current;
        return (
          <NavLink
            key={to}
            to={to}
            replace
            className={cn(
              'relative flex h-11 items-center justify-center gap-2 rounded-xl text-[0.9375rem] font-semibold transition-colors sm:h-12 sm:text-[1rem]',
              active ? 'text-white' : 'text-muted-foreground hover:bg-surface/60 hover:text-foreground',
            )}
          >
            {active ? (
              <motion.span
                aria-hidden="true"
                className="absolute inset-0 rounded-xl bg-[#0B7D72] shadow-[0_10px_24px_-12px_rgba(20,184,166,0.9)] dark:bg-[#0D8276]"
                initial={{ x: slideFrom }}
                animate={{ x: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              />
            ) : null}
            <Icon className="relative size-[1.125rem]" aria-hidden="true" />
            <span className="relative">{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

/** Card content header: status badge, title, subtitle, optional Login/Register tabs, then the form rows. */
export function AuthCard({
  title,
  subtitle,
  tabs = false,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  tabs?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-4 py-1.5 text-[0.6875rem] font-bold tracking-[0.12em] text-primary sm:text-[0.75rem]">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          {t('auth.shell.cardBadge')}
        </p>
        <h1 className="auth-display mt-5 text-[1.625rem] font-extrabold leading-tight sm:text-[1.875rem] xl:text-[2rem]">{title}</h1>
        {subtitle ? <p className="mx-auto mt-3 max-w-[24rem] text-[0.9375rem] leading-relaxed text-muted-foreground sm:text-[1rem]">{subtitle}</p> : null}
      </div>
      {tabs ? <AuthTabs /> : null}
      <div className="stagger-in mt-6">{children}</div>
    </div>
  );
}

/** Field label inside auth cards. */
export const authLabel = 'text-[0.9375rem] font-medium text-foreground/90';

/**
 * Primary action: teal→blue gradient with white text (mobile screenshot, light mode); on dark desktop the
 * sky→cyan gradient with navy text from the laptop screenshot. Lifts on hover, presses on click.
 */
export const authPrimaryButton =
  'group h-[3.25rem] rounded-2xl bg-gradient-to-r from-[#0B7D72] to-[#1D4ED8] text-[1rem] font-bold text-white shadow-[0_12px_30px_-12px_rgba(29,78,216,0.6)] hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-12px_rgba(29,78,216,0.7)] hover:brightness-110 active:translate-y-0 active:scale-[0.99] disabled:hover:translate-y-0 disabled:hover:brightness-100 disabled:shadow-none sm:h-14 sm:text-[1.0625rem] dark:lg:from-[#0EA5E9] dark:lg:to-[#06B6D4] dark:lg:text-[#06122B] dark:lg:shadow-[0_12px_30px_-12px_rgba(6,182,212,0.7)]';

/** Bottom line of a card: muted question + teal link with a growing underline. */
export function CardSwitch({ question, to, link }: { question: string; to: string; link: string }) {
  return (
    <p className="mt-6 border-t border-border pt-5 text-center text-[0.9375rem] text-muted-foreground">
      {question}{' '}
      <Link to={to} className="link-grow font-semibold text-primary hover:text-primary-hover">
        {link}
      </Link>
    </p>
  );
}
