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
  /** `tinted` (app default), `outline` (white field with a border) or `auth` (tall rounded field of the sign-in screens). */
  variant?: 'tinted' | 'outline' | 'auth';
};

/** Tinted, borderless field (#EFF4FF) that gains a teal edge on focus. */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, leading, trailing, addon, data = false, variant = 'tinted', ...props }, ref) => (
    <div
      className={cn(
        'flex w-full items-stretch overflow-hidden border transition-[border-color,box-shadow,background-color] duration-150',
        variant === 'outline' ? 'h-11 rounded-md bg-surface' : variant === 'auth' ? 'h-[3.25rem] rounded-2xl bg-subtle sm:h-14 short:h-12 short:sm:h-12' : 'h-12 rounded bg-subtle',
        invalid
          ? 'border-danger focus-within:shadow-[0_0_0_3px_hsl(var(--danger)/0.12)]'
          : variant === 'outline' || variant === 'auth'
            ? 'border-input hover:border-primary/50 focus-within:border-primary/70 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.14)]'
            : 'border-transparent hover:border-input focus-within:border-primary focus-within:bg-surface focus-within:shadow-[inset_0_0_0_1px_hsl(var(--primary))]',
        props.disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      {addon ? (
        <span
          className={cn(
            'flex shrink-0 items-center gap-2 px-3.5 font-data text-[0.9375rem] text-foreground [&_svg]:size-4 [&_svg]:text-primary',
            variant === 'outline' ? 'border-r border-input bg-subtle text-[0.875rem]' : 'bg-muted/70',
          )}
        >
          {addon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-center gap-3 px-4">
        {leading ? <span className="flex shrink-0 text-muted-foreground [&_svg]:size-[18px]">{leading}</span> : null}
        <input
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-full w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed',
            variant === 'outline' ? 'text-[0.875rem]' : variant === 'auth' ? 'text-[1rem]' : 'text-[0.9375rem]',
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
