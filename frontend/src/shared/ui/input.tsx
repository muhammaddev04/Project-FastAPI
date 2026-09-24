import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & {
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** A fixed, non-editable segment before the field (e.g. the +992 country code). */
  addon?: ReactNode;
  /** Monospaced digits for phone numbers and codes. */
  data?: boolean;
};

/** Tinted, borderless field (#EFF4FF) that gains a teal edge on focus. */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, leading, trailing, addon, data = false, ...props }, ref) => (
    <div
      className={cn(
        'flex h-12 w-full items-stretch overflow-hidden rounded border bg-subtle transition-[border-color,box-shadow,background-color] duration-150',
        invalid
          ? 'border-danger bg-danger-soft/40 focus-within:shadow-[inset_0_0_0_1px_hsl(var(--danger))]'
          : 'border-transparent hover:border-input focus-within:border-primary focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_hsl(var(--primary))]',
        props.disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      {addon ? (
        <span className="flex shrink-0 items-center gap-2 bg-muted/70 px-3.5 font-data text-[0.9375rem] text-foreground [&_svg]:size-4 [&_svg]:text-primary">
          {addon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-3 px-4">
        {leading ? <span className="flex shrink-0 text-muted-foreground [&_svg]:size-[18px]">{leading}</span> : null}
        <input
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-full w-full min-w-0 bg-transparent text-[0.9375rem] text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed',
            data && 'font-data tracking-[0.02em]',
          )}
          {...props}
        />
        {trailing ? <span className="flex shrink-0 items-center text-muted-foreground">{trailing}</span> : null}
      </span>
    </div>
  ),
);
Input.displayName = 'Input';
