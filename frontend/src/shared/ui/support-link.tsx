import { Headset, Send } from 'lucide-react';
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
        'inline-flex flex-wrap items-center gap-1.5 rounded-xl border px-3 py-2 text-label font-semibold shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        tone === 'inverted'
          ? 'border-white/25 bg-white/10 text-sidebar-foreground hover:bg-white/20'
          : 'border-primary/30 bg-surface text-primary hover:border-primary/60 hover:bg-primary/10 hover:text-primary-hover',
        className,
      )}
    >
      <Headset className="size-4" aria-hidden="true" />
      <span>{t('common.support')}</span>
      <span className="font-data text-xs">@{SUPPORT_TELEGRAM}</span>
    </a>
  );
}

/** Header form of the support link: round icon button with the handle on wide screens. */
export function SupportButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={`https://t.me/${SUPPORT_TELEGRAM}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${t('common.support')} @${SUPPORT_TELEGRAM}`}
      className={cn('group items-center gap-2.5 rounded-full text-body font-medium text-foreground/85 transition-colors hover:text-foreground', className)}
    >
      <span className="flex size-10 items-center justify-center rounded-full border bg-surface/50 text-primary transition-colors duration-base group-hover:border-primary/50">
        <Send className="size-4" aria-hidden="true" />
      </span>
      <span className="hidden lg:inline">@{SUPPORT_TELEGRAM}</span>
    </a>
  );
}
