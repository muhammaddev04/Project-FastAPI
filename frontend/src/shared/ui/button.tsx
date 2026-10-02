import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';
import { Spinner } from './spinner';

/**
 * Button hierarchy (Phase C3).
 *
 * Six variants, each answering a different question about the action:
 *   primary    the one thing this screen is for. At most one per view.
 *   secondary  a real alternative, equal in weight but not the default.
 *   outline    an action on a surface that already has a primary elsewhere.
 *   ghost      navigation and toolbar actions that must not compete with content.
 *   danger     destructive and irreversible. Named for the `danger` semantic token it uses, so the
 *              style and the token cannot drift apart.
 *   link       inline in a sentence, where a button-shaped control would break the text.
 * `social` is kept separately because Google's brand terms dictate its appearance; it is a provider
 * requirement, not a design choice.
 *
 * Removed here: `brand` (teal-to-blue gradient with a white light sweep crossing on hover) and `accent`
 * (a byte-identical duplicate of `primary`). Hover no longer translates the button upward: a control that
 * moves away from the cursor is harder to hit, and in a toolbar the row visibly reflowed. Hover now shifts
 * colour only, and the press state stays, because that is the feedback that confirms the click landed.
 */
const buttonVariants = cva(
  'group inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-[background-color,border-color,color] duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'border border-input bg-surface text-foreground hover:border-primary/50 hover:bg-subtle dark:bg-subtle/60',
        outline: 'border border-primary/40 bg-transparent text-primary hover:border-primary hover:bg-primary/5',
        ghost: 'text-foreground hover:bg-subtle',
        danger: 'bg-danger text-white hover:bg-danger/90',
        'danger-outline': 'border border-danger/40 bg-transparent text-danger hover:border-danger hover:bg-danger/5',
        /* Third-party sign-in (Google): white button, dark text, per the provider's brand rules. */
        social: 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-white/10',
        link: 'h-auto rounded-none px-0 text-primary underline-offset-4 hover:underline active:translate-y-0',
      },
      /*
       * Operational density: `md` is the workspace default at 36px, which keeps toolbars and table row
       * actions compact. `lg` and `xl` are for the one primary action on a page and for the auth screens,
       * where a 44px target matters more than density.
       */
      size: {
        sm: 'h-8 px-3 text-label',
        md: 'h-9 px-3.5 text-body',
        lg: 'h-10 px-4 text-body',
        xl: 'h-11 px-5 text-body-lg',
        icon: 'size-9',
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
