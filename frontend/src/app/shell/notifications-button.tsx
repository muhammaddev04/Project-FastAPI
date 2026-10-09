import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useNotifications, useReadNotification, useUnreadCount } from '@/features/notifications/api';
import { NotificationItem } from '@/features/notifications/notification-item';
import { errorMessage } from '@/shared/api/errors';
import {
  Alert,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Skeleton,
} from '@/shared/ui';

export function NotificationsButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const count = useUnreadCount();
  const list = useNotifications(false, 0, 10, open);
  const read = useReadNotification();
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="relative flex size-10 items-center justify-center rounded-full border bg-surface/50 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('notifications.title')}
      >
        <Bell className="size-5" aria-hidden="true" />
        {(count.data?.count ?? 0) > 0 ? (
          <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-2xs font-semibold text-primary-foreground">
            {count.data!.count > 99 ? '99+' : count.data!.count}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>{t('notifications.title')}</DropdownMenuLabel>
        <div className="flex flex-wrap gap-1 px-2 pb-2">
          <Button size="sm" variant="ghost" disabled={read.isPending || !count.data?.count} onClick={() => read.mutate(null)}>
            {t('notifications.readAll')}
          </Button>
          <DropdownMenuItem asChild role="link">
            <Link to="/profile/notifications">{t('notifications.settings')}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild role="link">
            <Link to="/profile/telegram">Telegram</Link>
          </DropdownMenuItem>
        </div>
        <div className="max-h-[min(60vh,32rem)] space-y-2 overflow-y-auto px-2 pb-2">
          {list.isPending ? (
            <Skeleton className="h-20" />
          ) : list.isError ? (
            <Alert tone="danger">{errorMessage(list.error, t)}</Alert>
          ) : list.data.results.length ? (
            list.data.results.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                compact
                onNavigate={() => setOpen(false)}
                disabled={read.isPending}
                onRead={(id) => read.mutate(id)}
              />
            ))
          ) : (
            <p className="py-3 text-label text-muted-foreground">{t('notifications.empty')}</p>
          )}
        </div>
        {read.isError ? <Alert tone="danger">{errorMessage(read.error, t)}</Alert> : null}
        <DropdownMenuItem asChild role="link">
          <Link to="/notifications">{t('notifications.viewAll')}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
