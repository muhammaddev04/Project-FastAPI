import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Entity page building blocks (ProfileHeader, StatCard, SectionHeader, InfoRow) shared by the User, Company and
 * Store pages and the area homes: same structure, the entity shows through its Avatar kind, chips and fields.
 */

/**
 * Hero of entity pages: the sign-in card's rounded glass panel with the brand glow; identity on the left
 * (mark, eyebrow chips, Montserrat name, subtitle, meta chips), actions on the right, stat cards beneath and an
 * optional side panel (e.g. the responsible person).
 */
export function ProfileHeader({
  mark,
  eyebrow,
  title,
  subtitle,
  chips,
  actions,
  stats,
  aside,
}: {
  mark: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  stats?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="glass relative overflow-hidden rounded-[1.75rem] border p-5 shadow-panel sm:p-6 lg:p-7">
      <div className="brand-glow pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full border border-primary/15 bg-primary/[0.04]"
        aria-hidden="true"
      />
      <div className="relative flex flex-col gap-5 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              {mark}
              <div className="min-w-0">
                {eyebrow ? <div className="mb-2 flex flex-wrap items-center gap-2">{eyebrow}</div> : null}
                <h1 className="break-words font-display text-[1.5rem] font-extrabold leading-tight text-foreground sm:text-[2rem]">{title}</h1>
                {subtitle ? <p className="mt-1 text-[0.875rem] text-muted-foreground">{subtitle}</p> : null}
                {chips ? <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">{chips}</div> : null}
              </div>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">{actions}</div> : null}
          </div>
          {stats ? <div className="grid grid-cols-[repeat(auto-fit,minmax(11.5rem,1fr))] gap-3">{stats}</div> : null}
        </div>
        {aside ? <div className="xl:w-72 xl:shrink-0">{aside}</div> : null}
      </div>
    </section>
  );
}

/** Meta chip under an entity name: icon + text (city, phone, email…). */
export function MetaChip({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
      <Icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** Statistic tile: icon tile, caption, Montserrat value, optional hint (the feature tiles of the sign-in hero). */
export function StatCard({ icon: Icon, label, value, hint, className }: { icon: LucideIcon; label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-2xl border bg-surface/70 px-4 py-3.5 dark:bg-subtle/40', className)}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-[1.125rem]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
        <p className="truncate font-display text-[1.0625rem] font-bold text-foreground">{value}</p>
        {hint ? <p className="truncate text-[0.75rem] text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Card title row: icon tile, title, subtitle and an optional chip or action on the right. */
export function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  chip,
  as: Heading = 'h2',
}: {
  icon: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  chip?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-[1.125rem]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <Heading className="font-display text-base font-bold text-foreground">{title}</Heading>
          {subtitle ? <p className="text-[0.8125rem] text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {chip ? <div className="shrink-0">{chip}</div> : null}
    </div>
  );
}

export function InfoRow({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-1 py-2.5 sm:grid-cols-3', className)}>
      <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd className="break-words text-[0.875rem] font-medium sm:col-span-2">{value}</dd>
    </div>
  );
}
