import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';

/** Sliding teal plate of the Login | Register switch, shared by every tab bar. */
function Plate({ layoutId }: { layoutId: string }) {
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden="true"
      className="absolute inset-0 rounded-xl bg-primary-strong"
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
    />
  );
}

const frame = 'flex gap-1 overflow-x-auto rounded-2xl border bg-subtle/60 p-1.5 [scrollbar-width:none]';
const tab = 'relative flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-body font-semibold transition-colors';

export type LinkTab = { to: string; label: string; icon?: LucideIcon };

/** Last active tab per tab bar, so a bar that remounts with the next page can slide its plate from the old tab. */
const lastActive = new Map<string, number>();

/**
 * Tabs that are routes (Login | Register, Settings: Profile | Verification): each tab keeps its own URL. Pages
 * remount their tab bar, so the plate starts under the previously active tab and slides to the new one.
 */
export function LinkTabs({
  items,
  label,
  replace = false,
  size = 'md',
  fill = false,
  className,
}: {
  items: LinkTab[];
  label: string;
  replace?: boolean;
  size?: 'md' | 'lg';
  /** Equal-width tabs across the whole bar. */
  fill?: boolean;
  className?: string;
}) {
  const { pathname } = useLocation();
  const active = items.findIndex(({ to }) => pathname === to || pathname.startsWith(`${to}/`));
  const [from] = useState(() => lastActive.get(label));
  useEffect(() => {
    lastActive.set(label, active);
  }, [label, active]);
  const offset = from !== undefined && from !== active && active >= 0 ? `${(from - active) * 100}%` : 0;
  return (
    <nav aria-label={label} className={cn(frame, fill ? 'grid w-full' : 'w-full sm:w-fit', size === 'lg' && '2xl:rounded-[1.25rem]', className)} style={fill ? { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` } : undefined}>
      {items.map(({ to, label: text, icon: Icon }, index) => {
        const isActive = index === active;
        return (
          <NavLink
            key={to}
            to={to}
            replace={replace}
            className={cn(
              tab,
              size === 'lg' ? 'h-11 text-body-lg sm:h-12 sm:text-base 2xl:h-[3.75rem] 2xl:rounded-2xl 2xl:text-title short:h-10 short:sm:h-10 short:2xl:h-12' : '',
              !fill && 'flex-1 sm:flex-none',
              isActive ? 'text-white' : 'text-muted-foreground hover:bg-surface/70 hover:text-foreground',
            )}
          >
            {isActive ? (
              <motion.span
                aria-hidden="true"
                className={cn('absolute inset-0 rounded-xl bg-primary-strong', size === 'lg' && '2xl:rounded-2xl')}
                initial={{ x: offset }}
                animate={{ x: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              />
            ) : null}
            {Icon ? <Icon className="relative size-[1.125rem]" aria-hidden="true" /> : null}
            <span className="relative">{text}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

/** In-page tabs (role="tablist"): arrow keys move between tabs. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const layoutId = useId();
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = items.findIndex((item) => item.value === value);
    const next = items[(index + step + items.length) % items.length];
    if (next) onChange(next.value);
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={move} className={cn(frame, 'w-full sm:w-fit', className)}>
      {items.map(({ value: itemValue, label: text, icon: Icon }) => {
        const active = itemValue === value;
        return (
          <button
            key={itemValue}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(itemValue)}
            className={cn(tab, 'flex-1 sm:flex-none', active ? 'text-white' : 'text-muted-foreground hover:bg-surface/70 hover:text-foreground')}
          >
            {active ? <Plate layoutId={layoutId} /> : null}
            {Icon ? <Icon className="relative size-4" aria-hidden="true" /> : null}
            <span className="relative">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
