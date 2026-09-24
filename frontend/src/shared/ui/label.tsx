import * as LabelPrimitive from '@radix-ui/react-label';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/shared/lib/cn';

export const Label = forwardRef<ElementRef<typeof LabelPrimitive.Root>, ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <LabelPrimitive.Root ref={ref} className={cn('text-[0.9375rem] font-semibold text-foreground', className)} {...props} />
  ),
);
Label.displayName = 'Label';
