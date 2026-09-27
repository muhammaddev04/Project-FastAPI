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
        'inline-flex items-center gap-1.5 text-[0.8125rem] font-medium transition-colors',
        tone === 'inverted' ? 'text-sidebar-muted hover:text-sidebar-foreground' : 'text-primary hover:text-primary-hover',
        className,
      )}
    >
      <Headset className="size-4" aria-hidden="true" />
      <span>{t('common.support')}</span>
      <span className="font-data text-2xs">@{SUPPORT_TELEGRAM}</span>
    </a>
  );
}

/** Header form of the support link: round icon button (lifts on hover) with the handle on wide screens. */
export function SupportButton({ className, large = false }: { className?: string; large?: boolean }) {
  const { t } = useTranslation();
  return (
    <a
      href={`https://t.me/${SUPPORT_TELEGRAM}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${t('common.support')} @${SUPPORT_TELEGRAM}`}
      className={cn('group items-center gap-2.5 rounded-full text-[0.875rem] font-medium text-foreground/85 transition-colors hover:text-foreground', className)}
    >
      <span className={cn('flex size-10 items-center justify-center rounded-full border bg-surface/50 text-primary transition-[transform,border-color] duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/50', large && '2xl:size-11')}>
        <Send className="size-4" aria-hidden="true" />
      </span>
      <span className={cn('hidden lg:inline', large && '2xl:text-[1.125rem]')}>@{SUPPORT_TELEGRAM}</span>
    </a>
  );
}
