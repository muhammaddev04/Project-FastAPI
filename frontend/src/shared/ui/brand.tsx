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
 * The brand lockup of the sign-in screens: teal tile with the white mark, "Tez" + gradient "Farmo" in Montserrat.
 * `size="sm"` fits the app header and sidebar.
 */
export function BrandMark({ className, size = 'sm' }: { className?: string; size?: 'sm' | 'md' | 'lg' | 'hero' }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'flex shrink-0 items-center justify-center bg-gradient-to-br from-brand-light to-brand shadow-[0_8px_24px_-8px_rgba(45,212,191,0.65)]',
          size === 'lg' || size === 'hero'
            ? cn(
                'size-10 rounded-xl transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105 lg:size-12 lg:rounded-2xl',
                size === 'hero' && '2xl:size-16 2xl:rounded-[1.125rem]',
              )
            : size === 'md'
              ? 'size-10 rounded-xl'
              : 'size-9 rounded-xl',
        )}
      >
        <LogoMark inverted className={size === 'hero' ? 'h-5 lg:h-6 2xl:h-8' : size === 'lg' ? 'h-5 lg:h-6' : size === 'md' ? 'h-5' : 'h-[1.125rem]'} />
      </span>
      <span
        className={cn(
          'font-display font-extrabold leading-none text-foreground',
          size === 'hero' ? 'text-[1.375rem] lg:text-[1.75rem] 2xl:text-[2.25rem]' : size === 'lg' ? 'text-[1.375rem] lg:text-[1.75rem]' : size === 'md' ? 'text-[1.375rem]' : 'text-[1.1875rem]',
        )}
      >
        Tez<span className="brand-text">Farmo</span>
      </span>
    </span>
  );
}
