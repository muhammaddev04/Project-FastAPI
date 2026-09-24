import { Headset } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

/** TZ F-SUP-1: every screen offers a way to reach platform support on Telegram. */
export const SUPPORT_TELEGRAM = 'tezfarmo_support';

export function SupportLink({ className, tone = 'default' }: { className?: string; tone?: 'default' | 'inverted' }) {
  const { t } = useTranslation();
  return (
    <a
      href={`https://t.me/${SUPPORT_TELEGRAM}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-1.5 text-[0.8125rem] font-medium transition-colors',
        tone === 'inverted' ? 'text-sidebar-muted hover:text-sidebar-foreground' : 'text-primary hover:text-primary-hover',
        className,
      )}
    >
      <Headset className="size-4" aria-hidden="true" />
      <span>{t('common.support')}</span>
      <span className="font-data text-2xs opacity-80">@{SUPPORT_TELEGRAM}</span>
    </a>
  );
}
