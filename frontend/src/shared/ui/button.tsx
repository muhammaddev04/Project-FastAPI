import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';
import { Spinner } from './spinner';

/**
 * Buttons of the sign-in language (DESIGN.md, CR-002): rounded-xl controls, a solid teal primary with a soft glow,
 * the teal→blue `brand` gradient for hero actions, quiet secondary/outline/ghost styles. Hover lifts, press settles.
 */
const buttonVariants = cva(
  'group inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-[background-color,border-color,color,box-shadow,transform,filter] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground shadow-[0_10px_24px_-14px_hsl(var(--primary)/0.9)] hover:-translate-y-px hover:bg-primary-hover hover:shadow-[0_14px_28px_-14px_hsl(var(--primary)/0.9)]',
        /* The light sweep (::before) crosses once on hover; reduced motion turns it into a plain fade. */
        brand:
          'relative overflow-hidden before:pointer-events-none before:absolute before:inset-0 before:-translate-x-full before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent before:transition-transform before:duration-700 hover:before:translate-x-full bg-gradient-to-r from-brand-deep to-brand-blue font-bold text-white shadow-[0_12px_30px_-12px_rgba(29,78,216,0.6)] hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-12px_rgba(29,78,216,0.7)] hover:brightness-110 active:translate-y-0 active:scale-[0.99] disabled:hover:translate-y-0 disabled:hover:brightness-100 dark:lg:from-brand-sky dark:lg:to-brand-cyan dark:lg:text-brand-navy dark:lg:shadow-[0_12px_30px_-12px_rgba(6,182,212,0.7)] dark:lg:hover:shadow-[0_16px_36px_-12px_rgba(6,182,212,0.8)]',
        accent:
          'bg-primary text-primary-foreground shadow-[0_10px_24px_-14px_hsl(var(--primary)/0.9)] hover:-translate-y-px hover:bg-primary-hover',
        secondary: 'border border-input bg-surface text-foreground hover:border-primary/50 hover:text-primary dark:bg-subtle/60',
        outline: 'border border-primary/40 bg-transparent text-primary hover:border-primary hover:bg-primary/5',
        ghost: 'text-foreground hover:bg-subtle',
        danger: 'bg-danger text-white shadow-[0_10px_24px_-14px_hsl(var(--danger)/0.9)] hover:-translate-y-px hover:bg-danger/90',
        'danger-outline': 'border border-danger/40 bg-transparent text-danger hover:border-danger hover:bg-danger/5',
        /* Third-party sign-in (Google): always a white button with dark text, per the provider's brand rules. */
        social:
          'border border-slate-200 bg-white text-slate-800 shadow-[0_6px_18px_-10px_rgba(15,27,58,0.35)] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_12px_26px_-12px_rgba(15,27,58,0.45)] active:translate-y-0 active:scale-[0.99] dark:border-white/10 dark:shadow-[0_10px_24px_-12px_rgba(0,0,0,0.7)]',
        link: 'h-auto rounded-none px-0 text-primary underline-offset-4 hover:underline active:translate-y-0',
      },
      size: {
        sm: 'h-9 px-3.5 text-[0.8125rem]',
        md: 'h-11 px-4 text-sm',
        lg: 'h-12 px-5 text-[0.9375rem]',
        /* Tall touch target of the sign-in screens (shorter on short viewports so forms fit). */
        xl: 'h-[3.25rem] rounded-2xl px-6 text-base font-bold sm:h-14 sm:text-[1.0625rem] 2xl:h-[4.5rem] 2xl:rounded-[1.125rem] 2xl:text-[1.375rem] 2xl:[&_svg]:size-5 short:h-12 short:sm:h-12 short:2xl:h-14',
        icon: 'h-10 w-10',
      },
      block: { true: 'w-full' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    if (asChild) {
      return (
        <Slot ref={ref} className={cn(buttonVariants({ variant, size, block }), className)} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, block }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Spinner className="size-4" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
