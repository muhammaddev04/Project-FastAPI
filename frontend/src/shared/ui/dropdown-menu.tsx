import * as Menu from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/shared/lib/cn';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export const DropdownMenuContent = forwardRef<ElementRef<typeof Menu.Content>, ComponentPropsWithoutRef<typeof Menu.Content>>(
  ({ className, sideOffset = 6, ...props }, ref) => (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('z-50 min-w-56 animate-fade-in overflow-hidden rounded-lg border bg-surface p-1 text-foreground shadow-pop', className)}
        {...props}
      />
    </Menu.Portal>
  ),
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = forwardRef<ElementRef<typeof Menu.Item>, ComponentPropsWithoutRef<typeof Menu.Item>>(
  ({ className, ...props }, ref) => (
    <Menu.Item
      ref={ref}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-[0.8125rem] outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

export function DropdownMenuLabel({ className, ...props }: ComponentPropsWithoutRef<typeof Menu.Label>) {
  return <Menu.Label className={cn('px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentPropsWithoutRef<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
