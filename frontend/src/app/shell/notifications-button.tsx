import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger, PhaseBadge } from '@/shared/ui';

/** Header bell. Notifications arrive with P11, so there is no unread dot and the menu says so honestly. */
export function NotificationsButton() {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-10 items-center justify-center rounded-full border bg-surface/50 text-muted-foreground transition-[transform,border-color,color] duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('dashboard.notifications.title')}
      >
        <Bell className="size-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center justify-between">
          {t('dashboard.notifications.title')}
          <PhaseBadge phase="P11" />
        </DropdownMenuLabel>
        <p className="px-2.5 pb-3 text-[0.8125rem] text-muted-foreground">{t('dashboard.notifications.empty')}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
