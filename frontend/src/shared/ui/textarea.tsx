import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

/** Multi-line field of the same family as Input: tinted, rounded-xl, teal focus ring, danger edge on error. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-20 w-full resize-y rounded-xl border bg-subtle px-3 py-2 text-body text-foreground outline-none transition-[border-color,box-shadow] duration-fast placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60',
        invalid
          ? 'border-danger focus:shadow-[0_0_0_2px_hsl(var(--danger)/0.18)]'
          : 'border-input hover:border-primary/50 focus:border-primary focus:shadow-[0_0_0_2px_hsl(var(--primary)/0.18)]',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
