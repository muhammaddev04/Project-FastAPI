import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Entity page building blocks (ProfileHeader, StatCard, SectionHeader, InfoRow) shared by the User, Company and
 * Store pages and the area homes: same structure, the entity shows through its Avatar kind, chips and fields.
 */

/**
 * Entity header: a plain raised panel with identity on the left
 * (mark, eyebrow chips, name, subtitle, meta chips), actions on the right, stat cards beneath and an
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
    <section className="workspace-hero chrome relative overflow-hidden rounded-2xl border p-5 shadow-card sm:p-6 lg:p-7">
      <div className="relative flex flex-col gap-5 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex w-full min-w-0 flex-col items-start gap-4 sm:flex-row">
              {mark}
              <div className="w-full min-w-0 sm:flex-1">
                {eyebrow ? <div className="mb-2 flex flex-wrap items-center gap-2">{eyebrow}</div> : null}
                <h1 className="break-words font-display text-title-lg font-semibold leading-tight text-foreground sm:text-[2rem]">
                  {title}
                </h1>
                {subtitle ? <p className="mt-1 text-body text-muted-foreground">{subtitle}</p> : null}
                {chips ? <div className="workspace-meta mt-3 flex flex-wrap gap-x-4 gap-y-2">{chips}</div> : null}
              </div>
            </div>
            {actions ? <div className="workspace-actions flex shrink-0 flex-col gap-2 sm:items-stretch">{actions}</div> : null}
          </div>
          {stats ? (
            <div className="workspace-stats grid grid-cols-[repeat(auto-fit,minmax(min(100%,11.5rem),1fr))] gap-3">{stats}</div>
          ) : null}
        </div>
        {aside ? <div className="xl:w-72 xl:shrink-0">{aside}</div> : null}
      </div>
    </section>
  );
}

/** Meta chip under an entity name: icon + text (city, phone, email…). */
export function MetaChip({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-label text-muted-foreground">
      <Icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** Statistic tile: icon, readable caption, value and optional hint. */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  className,
}: {
  icon: LucideIcon;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('workspace-stat flex items-start gap-3 rounded-xl border bg-subtle px-4 py-3.5', className)}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-[1.125rem]" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-caption font-medium text-muted-foreground">{label}</p>
        <p className="truncate font-display text-title-sm font-bold text-foreground">{value}</p>
        {hint ? <p className="truncate text-caption text-muted-foreground">{hint}</p> : null}
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
    <div className="workspace-section-heading flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-[1.125rem]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <Heading className="font-display text-base font-bold text-foreground">{title}</Heading>
          {subtitle ? <p className="text-label text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {chip ? <div className="min-w-0 max-w-full">{chip}</div> : null}
    </div>
  );
}

export function InfoRow({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-1 py-2.5 sm:grid-cols-3', className)}>
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="break-words text-body font-medium sm:col-span-2">{value}</dd>
    </div>
  );
}
