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
  /** `tinted` (app default), `outline` (surface field) or `auth` (tall field of the sign-in screens). */
  variant?: 'tinted' | 'outline' | 'auth';
  /** Confirmed-valid value (e.g. a checked code): success edge. */
  valid?: boolean;
};

/**
 * One field family (DESIGN.md, CR-002): tinted rounded-xl field with a hairline border that turns teal with a soft
 * 3px ring on focus; error and success edges; the `auth` size is the tall field of the sign-in screens.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, valid, leading, trailing, addon, data = false, variant = 'tinted', ...props }, ref) => (
    <div
      className={cn(
        'group/field flex w-full items-stretch overflow-hidden border transition-[border-color,box-shadow,background-color] duration-200',
        variant === 'auth'
          ? 'h-[3.25rem] rounded-2xl bg-subtle sm:h-14 short:h-12 short:sm:h-12'
          : cn('h-11 rounded-xl', variant === 'outline' ? 'bg-surface' : 'bg-subtle'),
        invalid
          ? 'border-danger focus-within:shadow-[0_0_0_3px_hsl(var(--danger)/0.12)]'
          : valid
            ? 'border-success/70 focus-within:shadow-[0_0_0_3px_hsl(var(--success)/0.14)]'
            : 'border-input hover:border-primary/50 focus-within:border-primary/70 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.14)]',
        props.disabled && 'cursor-not-allowed opacity-60 hover:border-input',
        props.readOnly && variant !== 'auth' && 'bg-subtle/50 hover:border-input',
        className,
      )}
    >
      {addon ? (
        <span
          className={cn(
            'flex shrink-0 items-center gap-2 border-r border-input px-3.5 font-data text-foreground [&_svg]:size-4 [&_svg]:text-primary',
            variant === 'auth' ? 'bg-muted/70 text-body-lg' : 'bg-muted/50 text-body',
          )}
        >
          {addon}
        </span>
      ) : null}
      <span className={cn('flex min-w-0 flex-1 items-center gap-3 px-3.5', variant === 'auth' && 'px-4')}>
        {leading ? <span className="flex shrink-0 text-muted-foreground transition-colors duration-200 group-focus-within/field:text-primary [&_svg]:size-[18px]">{leading}</span> : null}
        <input
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-full w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed',
            variant === 'auth' ? 'text-base' : 'text-body',
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
