import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> & {
  invalid?: boolean;
  /**
   * Only where the icon says something the label cannot: a magnifier marks a field as search, a currency
   * mark states the unit. An envelope next to a label reading "Email" is decoration, so it is not used.
   */
  leading?: ReactNode;
  trailing?: ReactNode;
  /** A fixed, non-editable segment before the field (e.g. the +992 country code). */
  addon?: ReactNode;
  /** Monospaced digits for identifiers: codes, phone numbers. Never for translated text. */
  data?: boolean;
  /** `tinted` recedes into a form; `outline` sits on an already-tinted surface. */
  variant?: 'tinted' | 'outline';
  /** `md` (36px) is the workspace field. `lg` (44px) is for auth and onboarding, where the target matters. */
  size?: 'md' | 'lg';
  /** Confirmed-valid value (e.g. a checked code): success edge. */
  valid?: boolean;
};

/**
 * One field family (Phase C4). Size is a `size` prop rather than a third `variant`, because the tall field
 * was never a different kind of input, only a bigger one. The focus treatment is a 2px ring in the primary
 * colour; error and success states change the border so the state survives a greyscale print and does not
 * rely on colour alone.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, valid, leading, trailing, addon, data = false, variant = 'tinted', size = 'md', ...props }, ref) => (
    <div
      className={cn(
        'group/field flex w-full items-stretch overflow-hidden rounded-xl border transition-[border-color,box-shadow,background-color] duration-fast',
        size === 'lg' ? 'h-11' : 'h-9',
        variant === 'outline' ? 'bg-surface' : 'bg-subtle',
        invalid
          ? 'border-danger focus-within:shadow-[0_0_0_2px_hsl(var(--danger)/0.18)]'
          : valid
            ? 'border-success/70 focus-within:shadow-[0_0_0_2px_hsl(var(--success)/0.2)]'
            : 'border-input hover:border-primary/50 focus-within:border-primary focus-within:shadow-[0_0_0_2px_hsl(var(--primary)/0.18)]',
        props.disabled && 'cursor-not-allowed opacity-60 hover:border-input',
        props.readOnly && 'bg-subtle/50 hover:border-input',
        className,
      )}
    >
      {addon ? (
        <span className="flex shrink-0 items-center gap-2 border-r border-input bg-muted/50 px-3 font-data text-body text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {addon}
        </span>
      ) : null}
      <span className={cn('flex min-w-0 flex-1 items-center gap-2.5', size === 'lg' ? 'px-3.5' : 'px-3')}>
        {leading ? <span className="flex shrink-0 text-muted-foreground [&_svg]:size-4">{leading}</span> : null}
        <input
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-full w-full min-w-0 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed',
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
