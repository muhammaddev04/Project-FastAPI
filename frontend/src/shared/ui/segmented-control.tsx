import { motion } from 'framer-motion';
import { useId, type KeyboardEvent } from 'react';
import { cn } from '@/shared/lib/cn';

type Option<T extends string> = { value: T; label: string; title?: string };

/** Compact pill switch (radiogroup) with an animated selection plate; arrow keys move between options. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'sm',
  className,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const layoutId = useId();
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((option) => option.value === value);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={move} className={cn('inline-flex rounded-full border bg-subtle p-0.5', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative rounded-full font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              size === 'sm' ? 'h-7 px-2.5 text-2xs' : 'h-8 px-3.5 text-[0.8125rem]',
              active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
