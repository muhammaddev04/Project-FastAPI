import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Checkbox and radio (Phase C4). Native inputs with `accent-color`, not a Radix overlay with a hand-drawn
 * tick: the native control already reports its state to assistive technology, follows the platform's own
 * focus ring and works before JavaScript has hydrated. The only styling is size, radius and accent.
 *
 * Both were previously written inline per call site, which is how the registration form ended up with
 * `accent-[hsl(var(--primary))]` spelled out in the middle of a page component.
 */
const control = 'size-4 shrink-0 cursor-pointer border-input accent-primary disabled:cursor-not-allowed disabled:opacity-60';

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, ...props }, ref) => <input ref={ref} type="checkbox" className={cn(control, 'rounded', className)} {...props} />,
);
Checkbox.displayName = 'Checkbox';

export const Radio = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, ...props }, ref) => <input ref={ref} type="radio" className={cn(control, 'rounded-full', className)} {...props} />,
);
Radio.displayName = 'Radio';

/**
 * A checkbox or radio with its label, which is the only correct way to ship one: the whole row is the hit
 * target, so the label is not a separate 4px-tall thing to aim at.
 */
export function CheckboxField({
  control: node,
  children,
  error,
  className,
}: {
  control: ReactNode;
  children: ReactNode;
  error?: string;
  className?: string;
}) {
  return (
    <div className="space-y-1">
      <label className={cn('flex cursor-pointer items-start gap-2.5 text-label leading-5 text-muted-foreground', className)}>
        <span className="flex h-5 items-center">{node}</span>
        <span className="min-w-0">{children}</span>
      </label>
      {error ? (
        <p role="alert" className="pl-[1.625rem] text-label text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
