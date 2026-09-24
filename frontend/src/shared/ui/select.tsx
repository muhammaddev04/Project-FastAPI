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
          'h-12 w-full appearance-none rounded border bg-subtle pl-4 pr-10 text-[0.9375rem] outline-none transition-[border-color,box-shadow] focus:border-primary focus:bg-surface focus:shadow-[inset_0_0_0_1px_hsl(var(--primary))]',
          invalid ? 'border-danger' : 'border-transparent hover:border-input',
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
