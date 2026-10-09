import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { formatDate, formatDateTime } from '@/shared/lib/datetime';
import { formatMoney } from '@/shared/lib/money';
import { Button } from '@/shared/ui';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Notification } from './api';

export function NotificationItem({
  notification,
  onRead,
  disabled = false,
  compact = false,
  onNavigate,
}: {
  notification: Notification;
  onRead: (id: string) => void;
  disabled?: boolean;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const number = notification.params.order_number;
  const amount = notification.params.amount ?? notification.params.total;
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${notification.read_at ? 'bg-surface/30' : 'border-primary/25 bg-primary/5'}`}>
      <Link
        className="block rounded-md focus-visible:ring-2 focus-visible:ring-ring"
        to={notification.link ?? '/notifications'}
        onClick={() => {
          onNavigate?.();
          if (
            (notification.organization_id && notification.link?.startsWith('/company/')) ||
            (notification.organization_id && notification.link?.startsWith('/store/'))
          ) {
            useSessionStore.getState().setActiveOrg(notification.organization_id);
          }
          if (!notification.read_at) onRead(notification.id);
        }}
      >
        <p className="break-words text-sm font-medium">{t(notification.title_key)}</p>
        <p className="mt-1 break-words text-label text-muted-foreground">
          {typeof number === 'string' ? number : null}
          {typeof amount === 'string' ? `${number ? ' · ' : ''}${formatMoney(amount)}` : null}
        </p>
        {typeof notification.params.due_date === 'string' ? (
          <p className="mt-1 text-label text-muted-foreground">{formatDate(notification.params.due_date)}</p>
        ) : null}
        {typeof notification.params.status === 'string' ? (
          <p className="mt-1 text-label text-muted-foreground">
            {notification.event_type === 'SUBSCRIPTION_STATUS_CHANGED'
              ? t(`billing.status.${notification.params.status}`)
              : notification.params.status}
          </p>
        ) : null}
        {notification.event_type === 'DELIVERY_DISPATCHED' ? (
          <p className="mt-1 text-label text-muted-foreground">{t('notifications.codeLabel')}</p>
        ) : null}
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <time className="text-caption text-muted-foreground" dateTime={notification.created_at}>
          {formatDateTime(notification.created_at)}
        </time>
        {!notification.read_at && !compact ? (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onRead(notification.id)}>
            {t('notifications.read')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
