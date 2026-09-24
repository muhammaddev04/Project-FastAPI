import { cn } from '@/shared/lib/cn';

/**
 * TezFarmo mark: a "T" whose bar becomes a forward arrow into a parcel — trade that moves.
 * Drawn as simple vector geometry in the brand teal; replace with the official SVG when available.
 */
export function LogoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  const base = inverted ? '#ffffff' : '#0F766E';
  const light = inverted ? '#99F6E4' : '#5EEAD4';
  return (
    <svg viewBox="0 0 48 40" className={cn('h-7 w-auto shrink-0', className)} aria-hidden="true">
      <rect x="2" y="7" width="20" height="7" rx="3.5" fill={base} />
      <rect x="8.5" y="7" width="7" height="27" rx="3.5" fill={base} />
      <path d="M20 2.5 30.5 10.5 20 18.5Z" fill={light} />
      <path d="M26 13 36 8.5 46 13 36 17.5Z" fill={light} />
      <path d="M26 15.5 35 19.6V35L26 30.9Z" fill={base} />
      <path d="M37 19.6 46 15.5V30.9L37 35Z" fill={base} opacity="0.82" />
    </svg>
  );
}

export function BrandMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark inverted={inverted} />
      <span className={cn('font-display text-[1.0625rem] font-semibold', inverted ? 'text-white' : 'text-primary')}>TezFarmo</span>
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
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-xs font-semibold text-primary',
        className,
      )}
    >
      {initials || '?'}
    </span>
  );
}
