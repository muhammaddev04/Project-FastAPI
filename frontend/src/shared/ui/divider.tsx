import { cn } from '@/shared/lib/cn';

/** Hairline rule, optionally with a small caption pill in the middle ("— OR VIA —"). */
export function Divider({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)} role="separator">
      <span className="h-px flex-1 bg-border" />
      {label ? (
        <span className="rounded-full border bg-subtle/70 px-3 py-1 text-micro font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
      ) : null}
      {label ? <span className="h-px flex-1 bg-border" /> : null}
    </div>
  );
}
