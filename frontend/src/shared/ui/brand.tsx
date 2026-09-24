import { cn } from '@/shared/lib/cn';

export function BrandMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill={inverted ? '#ffffff' : 'hsl(var(--primary))'} />
        <path
          d="M9 11h14M16 11v12M11 17h7"
          stroke={inverted ? 'hsl(var(--primary))' : '#ffffff'}
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[0.95rem]">TezFarmo</span>
    </span>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent',
        className,
      )}
    >
      {initials || '?'}
    </span>
  );
}
