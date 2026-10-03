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
          'h-9 w-full appearance-none rounded-xl border bg-subtle pl-3 pr-9 text-body text-foreground outline-none transition-[border-color,box-shadow] duration-fast focus:border-primary focus:shadow-[0_0_0_2px_hsl(var(--primary)/0.18)] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60',
          invalid ? 'border-danger focus:shadow-[0_0_0_2px_hsl(var(--danger)/0.18)]' : 'border-input hover:border-primary/50',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  ),
);
Select.displayName = 'Select';
