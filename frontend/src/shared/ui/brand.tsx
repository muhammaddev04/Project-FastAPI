import { cn } from '@/shared/lib/cn';

/** Supplied logo artwork, framed to its visible bounds without changing its proportions. */
export function LogoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn('inline-block shrink-0', className)}>
      <svg viewBox="57 212 1146 893" className={cn('h-full w-auto', !inverted && 'dark:hidden')} aria-hidden="true">
        <image href={inverted ? '/brand/tezfarmo-reference-dark.png' : '/brand/tezfarmo-reference-light.png'} width="1254" height="1254" />
      </svg>
      {!inverted ? (
        <svg viewBox="52 191 1151 913" className="hidden h-full w-auto dark:block" aria-hidden="true">
          <image href="/brand/tezfarmo-reference-dark.png" width="1254" height="1254" />
        </svg>
      ) : null}
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
