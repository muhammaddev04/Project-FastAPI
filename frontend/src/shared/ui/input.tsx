import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, leading, trailing, ...props }, ref) => (
    <div
      className={cn(
        'flex h-10 w-full items-center gap-2 rounded-md border bg-surface px-3 shadow-card transition-colors',
        'focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20',
        invalid ? 'border-danger focus-within:border-danger focus-within:ring-danger/20' : 'border-input',
        props.disabled && 'cursor-not-allowed bg-subtle opacity-70',
        className,
      )}
    >
      {leading ? <span className="flex shrink-0 text-muted-foreground [&_svg]:size-4">{leading}</span> : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className="h-full w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed"
        {...props}
      />
      {trailing ? <span className="flex shrink-0 items-center text-muted-foreground">{trailing}</span> : null}
    </div>
  ),
);
Input.displayName = 'Input';
