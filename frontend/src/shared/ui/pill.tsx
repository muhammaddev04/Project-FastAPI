import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Brand pill: teal outline chip with a beacon dot; `live` makes the dot ping (disabled by reduced motion).
 *
 * Phase D dropped the `card` and `hero` sizes and their 2xl step-ups. They sized the chip for the sign-in
 * card badge ("B2B PLATFORM") and the hero tag ("B2B platform for Tajikistan"), both of which are gone: the
 * first restated the brand lockup beside it, the second was a marketing line on a sign-in screen.
 */
export function Pill({ children, size = 'sm', live = false, className }: { children: ReactNode; size?: 'sm' | 'md'; live?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 font-bold text-primary-ink',
        size === 'md' ? 'h-10 px-4 text-body font-semibold' : 'px-3 py-1 text-micro uppercase tracking-[0.12em]',
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
