import { motion } from 'framer-motion';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useId, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { useThemeStore, type ThemeMode } from './theme';

const OPTIONS: { mode: ThemeMode; icon: LucideIcon }[] = [
  { mode: 'light', icon: Sun },
  { mode: 'dark', icon: Moon },
  { mode: 'system', icon: Monitor },
];

/** Compact Sun / Moon / Monitor switch (radiogroup, arrow keys) with an animated selection plate. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);
  const layoutId = useId();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = OPTIONS.findIndex((option) => option.mode === mode);
    const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
    if (next) setMode(next.mode);
  };

  return (
    <div
      role="radiogroup"
      aria-label={t('theme.label')}
      onKeyDown={onKeyDown}
      className={cn('inline-flex rounded-full border bg-subtle p-0.5', className)}
    >
      {OPTIONS.map(({ mode: option, icon: Icon }) => {
        const active = option === mode;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t(`theme.${option}`)}
            title={t(`theme.${option}`)}
            tabIndex={active ? 0 : -1}
            onClick={() => setMode(option)}
            className={cn(
              'group relative flex size-7 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
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
            <Icon
              className="relative size-3.5 transition-transform duration-300 group-hover:rotate-12 group-active:scale-90"
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
