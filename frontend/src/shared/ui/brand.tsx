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

/**
 * The brand lockup: teal tile with the white mark, then "Tez" + "Farmo" in Montserrat.
 *
 * Phase D removed the `hero` size. It existed so the sign-in screen could print the lockup at 2xl in a
 * 64px tile above a three-line display headline; the authentication screens no longer open with a brand
 * statement, so the only remaining sizes are the ones real chrome uses. `tone="aside"` is for the navy
 * authentication panel, where neither the foreground nor the primary token has contrast.
 */
export function BrandMark({
  className,
  size = 'sm',
  tone = 'default',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'aside';
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'flex shrink-0 items-center justify-center bg-gradient-to-br from-brand-light to-brand',
          size === 'lg' ? 'size-10 rounded-xl lg:size-12 lg:rounded-2xl' : size === 'md' ? 'size-10 rounded-xl' : 'size-9 rounded-xl',
        )}
      >
        <LogoMark inverted className={size === 'lg' ? 'h-5 lg:h-6' : size === 'md' ? 'h-5' : 'h-[1.125rem]'} />
      </span>
      <span
        className={cn(
          'font-display font-extrabold leading-none',
          tone === 'aside' ? 'text-aside-foreground' : 'text-foreground',
          size === 'lg' ? 'text-title sm:text-display-sm' : size === 'md' ? 'text-title' : 'text-title-sm',
        )}
      >
        Tez<span className={tone === 'aside' ? 'text-aside-accent' : 'text-primary'}>Farmo</span>
      </span>
    </span>
  );
}
