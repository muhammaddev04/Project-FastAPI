import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

/** Multi-line field of the same family as Input: tinted, rounded-xl, teal focus ring, danger edge on error. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-24 w-full resize-y rounded-xl border bg-subtle px-3.5 py-3 text-[0.875rem] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60',
        invalid
          ? 'border-danger focus:shadow-[0_0_0_3px_hsl(var(--danger)/0.12)]'
          : 'border-input hover:border-primary/50 focus:border-primary/70 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.14)]',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
