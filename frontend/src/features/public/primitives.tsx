import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

/**
 * Composition primitives of the public site (Phase E).
 *
 * The reference separates its sections with whitespace and an occasional hairline, never with a card. That is
 * the single decision these primitives encode: a section is a band of space with a measure inside it, so there
 * is no `PublicCard` here and nothing on these pages gets a shadow.
 */

/** Outer frame: 80rem, with the page gutter. Every public section uses this and nothing else. */
export function Frame({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-frame px-5 sm:px-8 lg:px-12', className)}>{children}</div>;
}

/**
 * A vertical band. `tight` is for bands that continue the thought above them rather than starting a new one;
 * `hairline` adds the top rule where two bands would otherwise merge.
 */
export function Section({
  id,
  tone = 'default',
  space = 'default',
  hairline = false,
  className,
  children,
}: {
  id?: string;
  /** `sunk` is one step darker than the paper, for a band that should read as set into the page. */
  tone?: 'default' | 'sunk' | 'ink';
  space?: 'default' | 'tight';
  hairline?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        space === 'tight' ? 'py-14 sm:py-16 lg:py-20' : 'py-20 sm:py-24 lg:py-32',
        tone === 'sunk' && 'bg-subtle/60',
        tone === 'ink' && 'bg-foreground text-background',
        hairline && 'border-t',
        className,
      )}
    >
      <Frame>{children}</Frame>
    </section>
  );
}

/** Small uppercase label above a heading. Positive tracking, which is the only place this system uses it. */
export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={cn('text-caption font-semibold uppercase tracking-[0.08em] text-primary-ink', className)}>{children}</p>
  );
}

/**
 * Display heading, the only serif on the page.
 *
 * `as` sets the level so a section heading is an h2 without having to look like one; the size is chosen by
 * `size`, never by the level, because the two are different questions.
 */
export function Display({
  as: Tag = 'h2',
  size = 'section',
  className,
  children,
}: {
  as?: 'h1' | 'h2' | 'h3';
  size?: 'hero' | 'section' | 'section-sm';
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        'font-serif font-semibold text-balance',
        size === 'hero' ? 'text-hero' : size === 'section' ? 'text-section' : 'text-section-sm',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Lead paragraph under a display heading: sans, clamped to a reading measure. */
export function Lead({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('max-w-measure text-lead text-muted-foreground', className)}>{children}</p>;
}

/**
 * Scroll reveal on the reference's single easing curve.
 *
 * One transform, once, 12px: enough to tell the eye a band has arrived, not enough to make the page feel like
 * it is assembling itself. `MotionConfig reducedMotion="user"` in the shell turns it into a plain fade for
 * anyone who asked for less motion.
 */
export function Reveal({ delay = 0, className, children }: { delay?: number; className?: string; children: ReactNode }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.55, delay, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Availability marker. The product is early: most of what the specification describes is not built yet, and a
 * public page that leaves that out is lying. This is how it gets said, inline and quietly, instead of in a
 * disclaimer nobody reads.
 */
export function Availability({ state, phase }: { state: 'live' | 'planned'; phase?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-micro font-semibold',
        state === 'live' ? 'border-primary/30 bg-primary/10 text-primary-ink' : 'border-border bg-subtle text-muted-foreground',
      )}
    >
      <span className={cn('size-1.5 rounded-full', state === 'live' ? 'bg-primary' : 'bg-muted-foreground/50')} aria-hidden="true" />
      {phase ? <span className="font-data text-[0.625rem] leading-none">{phase}</span> : null}
      <span>{t(`site.availability.${state}`)}</span>
    </span>
  );
}
