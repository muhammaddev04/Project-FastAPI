import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

/** Native select styled like the inputs (same field family): accessible and dependable on mobile. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  ({ className, invalid, children, ...props }, ref) => (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-11 w-full appearance-none rounded-xl border bg-subtle pl-3.5 pr-10 text-[0.875rem] text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary/70 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.14)] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60',
          invalid ? 'border-danger focus:shadow-[0_0_0_3px_hsl(var(--danger)/0.12)]' : 'border-input hover:border-primary/50',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </div>
  ),
);
Select.displayName = 'Select';
