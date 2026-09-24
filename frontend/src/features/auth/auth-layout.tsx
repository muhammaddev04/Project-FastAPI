import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMeta } from '@/shared/api/meta';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { LogoMark, SupportLink } from '@/shared/ui';

/** "TezFarmo." wordmark with the blue full stop from the reference. */
function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark inverted className="h-6" />
      <span className="text-[1.25rem] font-extrabold italic tracking-[0.06em] text-white">
        TezFarmo<span className="text-[hsl(212_100%_58%)]">.</span>
      </span>
    </span>
  );
}

/**
 * Split auth frame (reference design): deep-navy brand panel with a blue gradient block and an italic headline,
 * and a white work area holding a compact form card. Scoped `.auth-theme` switches actions to bright blue.
 */
export function AuthSplit({
  headline,
  tagline,
  children,
}: {
  headline: ReactNode;
  tagline: [ReactNode, ReactNode];
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const meta = useMeta();
  return (
    <div className="auth-theme min-h-screen bg-white text-foreground lg:grid lg:grid-cols-2">
      <aside className="relative overflow-hidden bg-[#030A24] text-white lg:sticky lg:top-0 lg:h-screen">
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 right-0 top-0 bg-gradient-to-br from-[#0A1647] via-[#0D1B5E] to-[#1B2E8C] sm:left-[8%] lg:bottom-[11%] lg:left-[13%] lg:top-[11%]"
        >
          <div className="absolute inset-0 opacity-[0.05] [background-image:repeating-linear-gradient(90deg,#fff_0,#fff_1px,transparent_1px,transparent_42px)]" />
          <div className="absolute -right-24 -top-24 size-80 rounded-full bg-[#2B4BD6]/25 blur-3xl" />
        </div>

        <div className="relative flex min-h-[15rem] flex-col justify-between gap-8 px-6 py-7 sm:px-12 lg:h-full lg:justify-center lg:gap-0 lg:pl-[max(4rem,19%)] lg:pr-10 lg:py-0">
          <Link to="/" aria-label={t('common.appName')} className="w-fit rounded lg:absolute lg:top-[19%]">
            <Wordmark />
          </Link>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}>
            <p className="text-[2.25rem] font-bold italic leading-[1.1] tracking-[-0.01em] sm:text-[3rem] lg:text-[3.75rem] xl:text-[4.25rem]">
              {headline}
            </p>
            <p className="mt-3 text-[1.25rem] font-normal italic leading-snug sm:text-[1.5rem] lg:mt-6 lg:text-[1.75rem] xl:text-[2rem]">
              <span className="block text-white/95">{tagline[0]}</span>
              <span className="block text-white/65">{tagline[1]}</span>
            </p>
          </motion.div>
        </div>
      </aside>

      <section className="relative flex min-h-[calc(100vh-15rem)] flex-col bg-white lg:min-h-screen">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-[11%] left-0 right-[8%] hidden bg-white shadow-[0_30px_90px_-20px_rgba(15,23,42,0.18)] lg:block"
        />
        <div className="relative flex justify-end px-5 pt-5 sm:px-8">
          <LanguageSwitcher />
        </div>
        <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-8 lg:pr-[12%]">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08, ease: [0.2, 0.8, 0.2, 1] }}
            className="w-full max-w-[25rem]"
          >
            {children}
          </motion.div>
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

/** Compact white form card: square-ish corners, soft shadow, 18-20px title. */
export function AuthCard({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[3px] bg-white px-5 py-6 shadow-[0_10px_40px_-12px_rgba(15,23,42,0.22)] ring-1 ring-black/[0.03] sm:px-7 sm:py-7', className)}>
      <h1 className="text-[1.375rem] font-semibold leading-tight text-foreground">{title}</h1>
      <div className="mt-5">{children}</div>
    </div>
  );
}

/** Small uppercase-free field label used inside auth cards (reference: 12-13px, dark gray). */
export const authLabel = 'text-[0.8125rem] font-medium text-[#2d3440]';

/** Bottom line of a card: muted question + blue link. */
export function CardSwitch({ question, to, link }: { question: string; to: string; link: string }) {
  return (
    <p className="mt-5 text-center text-[0.8125rem] text-muted-foreground">
      {question}{' '}
      <Link to={to} className="font-medium text-primary hover:underline">
        {link}
      </Link>
    </p>
  );
}
