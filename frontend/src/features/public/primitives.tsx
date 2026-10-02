import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

/**
 * Composition primitives of the public site (Phase E, rebuilt).
 *
 * The first version of these pages had one shape repeated five times: eyebrow, display heading, lead paragraph,
 * then a grid. Recolouring that is not a redesign, so the primitives changed to make the alternative cheap.
 * What is here now is a `Statement` that lives on bare canvas, a `Split` that is deliberately lopsided, and a
 * `Band` whose only job is vertical space. There is still no card primitive, and that is the point: marketing
 * copy sits on the paper, and a boundary is drawn only where the content is an interface.
 */

/** Outer frame: 80rem with the page gutter. */
export function Frame({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-frame px-5 sm:px-8 lg:px-12', className)}>{children}</div>;
}

/**
 * A band of vertical space. `air` is for the typographic moments, where the space is the composition; `tight`
 * is for a band that continues the thought above it rather than starting a new one.
 */
export function Band({
  id,
  tone = 'default',
  space = 'default',
  hairline = false,
  className,
  children,
}: {
  id?: string;
  /** `sunk` is one step off the paper; `ink` inverts, and is used at most once per page. */
  tone?: 'default' | 'sunk' | 'ink';
  space?: 'air' | 'default' | 'tight';
  hairline?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        space === 'air' ? 'py-28 sm:py-36 lg:py-48' : space === 'tight' ? 'py-14 sm:py-16 lg:py-20' : 'py-20 sm:py-24 lg:py-32',
        tone === 'sunk' && 'bg-subtle/50',
        tone === 'ink' && 'bg-foreground text-background',
        hairline && 'border-t',
        className,
      )}
    >
      <Frame>{children}</Frame>
    </section>
  );
}

/** Small uppercase label. The only place this system uses positive tracking. */
export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground', className)}>{children}</p>;
}

/** Display heading, the only serif on the page. `as` sets the level, `size` sets the size; separate questions. */
export function Display({
  as: Tag = 'h2',
  size = 'section',
  className,
  children,
}: {
  as?: 'h1' | 'h2' | 'h3' | 'p';
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

/** Lead paragraph: sans, clamped to a reading measure, deliberately much smaller than the heading above it. */
export function Lead({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('max-w-measure text-lead text-muted-foreground', className)}>{children}</p>;
}

/**
 * A typographic moment: one statement, on the canvas, with nothing else in the band.
 *
 * This is the rhythm change the page needs between product sections. It is not a heading for the section that
 * follows, which is why it takes no eyebrow and no lead: the moment it shares a band with supporting copy it
 * becomes another section header and stops doing this job.
 */
export function Statement({
  answer,
  align = 'left',
  children,
}: {
  /** The second half of the thought, set quieter, when the statement is a problem and an answer. */
  answer?: ReactNode;
  align?: 'left' | 'center';
  children: ReactNode;
}) {
  return (
    <div className={cn('max-w-[48rem]', align === 'center' && 'mx-auto text-center')}>
      <Display as="p" size="hero" className="text-[length:clamp(1.875rem,1.1rem+3vw,3.5rem)] leading-[1.12]">
        {children}
      </Display>
      {answer ? <p className="mt-10 max-w-measure text-lead text-muted-foreground">{answer}</p> : null}
    </div>
  );
}

/**
 * Two columns of deliberately different weight, alternating side.
 *
 * The ratios are lopsided on purpose: a 50/50 split of text and a visual reads as two things of equal
 * importance, which is almost never true. `text` gets the minority share when the visual carries the argument,
 * and `reverse` puts the visual first so two consecutive stories do not have the same silhouette.
 */
export function Split({
  reverse = false,
  weight = 'text-minor',
  aside,
  className,
  children,
}: {
  reverse?: boolean;
  /** Which column is the smaller one. */
  weight?: 'text-minor' | 'text-major';
  /** The visual, or whatever the text is about. */
  aside: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const columns = weight === 'text-minor' ? 'lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]' : 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]';
  return (
    <div className={cn('grid items-start gap-12 lg:gap-16', columns, className)}>
      <div className={cn('min-w-0', reverse && 'lg:order-2')}>{children}</div>
      <div className={cn('min-w-0', reverse && 'lg:order-1')}>{aside}</div>
    </div>
  );
}

/**
 * Scroll reveal on the reference's single easing curve: one transform, once, 12px. Enough to tell the eye a
 * band has arrived; not enough to make the page feel like it is assembling itself. `MotionConfig
 * reducedMotion="user"` in the shell turns it into a plain fade for anyone who asked for less motion.
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
 * Availability marker. Most of what the specification describes is not built, and a public page that leaves
 * that out is lying. Said inline and quietly, in words, with no phase code in the marketing copy: the TZ phase
 * is an internal scheduling detail and a visitor has no use for "P07".
 */
export function Availability({ state, className }: { state: 'live' | 'planned'; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.06em]',
        state === 'live' ? 'text-primary-ink' : 'text-muted-foreground',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full', state === 'live' ? 'bg-primary' : 'border border-muted-foreground/60')}
      />
      {t(`site.availability.${state}`)}
    </span>
  );
}

/** Index numeral used as structure in editorial lists: large, quiet, monospaced figures. */
export function Index({ n, className }: { n: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('font-data text-caption tabular-nums text-muted-foreground', className)}>
      {String(n).padStart(2, '0')}
    </span>
  );
}
