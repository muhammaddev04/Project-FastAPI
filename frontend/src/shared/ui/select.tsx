import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

/** Native select styled like inputs: accessible and dependable on mobile. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  ({ className, invalid, children, ...props }, ref) => (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-10 w-full appearance-none rounded-md border bg-surface pl-3 pr-9 text-sm shadow-card outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20',
          invalid ? 'border-danger' : 'border-input',
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
