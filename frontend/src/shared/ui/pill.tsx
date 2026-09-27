import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Brand pill (eyebrows, the sign-in card badge, hero tags): teal outline chip with a beacon dot; `live` makes the
 * dot ping (disabled by reduced motion).
 */
export function Pill({ children, size = 'sm', live = false, className }: { children: ReactNode; size?: 'sm' | 'md' | 'card' | 'hero'; live?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 font-bold text-primary-ink',
        size === 'md' || size === 'hero'
          ? cn('h-10 px-4 text-[0.875rem] font-semibold', size === 'hero' && '2xl:h-[2.625rem] 2xl:px-5 2xl:text-[1.0625rem] 2xl:font-bold')
          : cn('px-3 py-1 text-[0.625rem] uppercase tracking-[0.12em] sm:text-[0.6875rem]', size === 'card' && '2xl:h-[2.625rem] 2xl:px-6 2xl:py-0 2xl:text-[1.0625rem] 2xl:tracking-[0.06em]'),
        className,
      )}
    >
      <span className="relative flex size-1.5 shrink-0" aria-hidden="true">
        {live ? <span className="absolute inset-0 animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" /> : null}
        <span className="relative size-1.5 rounded-full bg-primary" />
      </span>
      {children}
    </span>
  );
}
