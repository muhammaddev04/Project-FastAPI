import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { SUPPORTED_LANGUAGES, isLanguage, setLanguage } from './index';

/** FND-033: language switcher; the choice is stored in localStorage. */
export function LanguageSwitcher({ className, tone = 'default' }: { className?: string; tone?: 'default' | 'inverted' }) {
  const { t, i18n } = useTranslation();
  return (
    <label
      className={cn(
        'relative inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[0.8125rem] transition-colors focus-within:ring-2 focus-within:ring-ring/30',
        tone === 'inverted'
          ? 'border-sidebar-border text-sidebar-muted hover:text-sidebar-foreground'
          : 'border-border bg-surface text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <Globe className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{t('common.language')}</span>
      <select
        className="cursor-pointer appearance-none bg-transparent pr-1 font-medium uppercase outline-none"
        value={i18n.resolvedLanguage}
        onChange={(event) => {
          if (isLanguage(event.target.value)) setLanguage(event.target.value);
        }}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {t(`languages.${language}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
