import { cn } from '@/shared/lib/cn';
import { useThemeStore } from '@/shared/theme/theme';

/**
 * Supplied logo artwork, framed to its visible bounds without changing its proportions.
 * Only the artwork for the active theme is in the DOM: a `dark:hidden` twin would still be
 * downloaded, doubling the logo bytes on first paint.
 */
export function LogoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  const resolved = useThemeStore((state) => state.resolved);
  const dark = inverted || resolved === 'dark';
  // Each master is cropped differently, so the frame follows the file rather than the theme.
  const viewBox = dark && !inverted ? '52 191 1151 913' : '57 212 1146 893';
  return (
    <span className={cn('inline-block shrink-0', className)}>
      <svg viewBox={viewBox} className="h-full w-auto" aria-hidden="true">
        <image href={`/brand/tezfarmo-reference-${dark ? 'dark' : 'light'}.webp`} width="1254" height="1254" />
      </svg>
    </span>
  );
}

export function BrandMark({ className, size = 'sm' }: { className?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center', className)}>
      <LogoMark className={size === 'xs' ? 'h-8 sm:h-9' : size === 'lg' ? 'h-20' : size === 'md' ? 'h-16' : 'h-12 sm:h-14'} />
      <span className="sr-only">TezFarmo</span>
    </span>
  );
}
