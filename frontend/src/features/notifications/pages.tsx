import { Bell, Link2, LockKeyhole, Settings } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { HeaderTools } from '@/app/shell/app-shell';
import { StandaloneLayout } from '@/app/shell/standalone-layout';
import { errorMessage } from '@/shared/api/errors';
import { homePath } from '@/shared/auth/context';
import type { Me } from '@/shared/auth/types';
import { useSessionStore } from '@/shared/auth/session-store';
import { Alert, Badge, Button, Card, Checkbox, PageHeader, Skeleton } from '@/shared/ui';
import {
  useNotifications,
  usePreferences,
  useReadNotification,
  useSavePreference,
  useTelegramLink,
  useTelegramToken,
  useUnlinkTelegram,
} from './api';
import { NotificationItem } from './notification-item';

function NotificationLayout({ me, children }: { me: Me; children: ReactNode }) {
  const { t } = useTranslation();
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  return (
    <StandaloneLayout back={homePath(me, activeOrgId)} actions={<HeaderTools me={me} />}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <nav className="flex flex-wrap gap-2" aria-label={t('notifications.title')}>
          <Button asChild size="sm" variant="outline">
            <Link to="/notifications">
              <Bell />
              {t('notifications.title')}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/profile/notifications">
              <Settings />
              {t('notifications.settings')}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/profile/telegram">
              <Link2 />
              Telegram
            </Link>
          </Button>
        </nav>
        {children}
      </div>
    </StandaloneLayout>
  );
}

export function NotificationsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [unread, setUnread] = useState(false);
  const [offset, setOffset] = useState(0);
  const list = useNotifications(unread, offset);
  const read = useReadNotification();
  return (
    <NotificationLayout me={me}>
      <PageHeader
        title={t('notifications.title')}
        description={t('notifications.description')}
        actions={
          <Button variant="outline" disabled={read.isPending || !list.data?.count} onClick={() => read.mutate(null)}>
            {t('notifications.readAll')}
          </Button>
        }
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={unread}
          onChange={(event) => {
            setUnread(event.target.checked);
            setOffset(0);
          }}
        />
        {t('notifications.unread')}
      </label>
      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : list.isError ? (
        <Alert tone="danger">{errorMessage(list.error, t)}</Alert>
      ) : (
        <div className="space-y-3">
          {list.data.results.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">{t('notifications.empty')}</Card>
          ) : (
            list.data.results.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onRead={(id) => read.mutate(id)}
                disabled={read.isPending}
              />
            ))
          )}
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>
              {t('notifications.previous')}
            </Button>
            <span className="text-label text-muted-foreground">
              {list.data.count ? `${offset + 1}–${offset + list.data.results.length} / ${list.data.count}` : '0'}
            </span>
            <Button variant="outline" disabled={offset + 20 >= list.data.count} onClick={() => setOffset(offset + 20)}>
              {t('notifications.next')}
            </Button>
          </div>
        </div>
      )}
      {read.isError ? <Alert tone="danger">{errorMessage(read.error, t)}</Alert> : null}
    </NotificationLayout>
  );
}

export function NotificationPreferencesPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const save = useSavePreference();
  const groups = [...new Set(preferences.data?.map((row) => row.event_group))];
  return (
    <NotificationLayout me={me}>
      <PageHeader title={t('notifications.settings')} description={t('notifications.preferencesHint')} />
      {preferences.isPending ? (
        <Skeleton className="h-48" />
      ) : preferences.isError ? (
        <Alert tone="danger">{errorMessage(preferences.error, t)}</Alert>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">{t('notifications.group')}</th>
                <th className="p-3">{t('notifications.inApp')}</th>
                <th className="p-3">Telegram</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const telegram = preferences.data.find((row) => row.event_group === group && row.channel === 'TELEGRAM');
                return (
                  <tr className="border-b last:border-0" key={group}>
                    <th className="p-3 text-left font-medium">{t(`notifications.groups.${group}`)}</th>
                    <td className="p-3">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
                        {t('notifications.locked')}
                      </span>
                    </td>
                    <td className="p-3">
                      <Checkbox
                        aria-label={`Telegram · ${t(`notifications.groups.${group}`)}`}
                        checked={telegram?.enabled ?? false}
                        disabled={save.isPending}
                        onChange={(event) =>
                          save.mutate({
                            event_group: group as Parameters<typeof save.mutate>[0]['event_group'],
                            channel: 'TELEGRAM',
                            enabled: event.target.checked,
                          })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {save.isError ? (
        <Alert tone="danger">{errorMessage(save.error, t)}</Alert>
      ) : save.isSuccess ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('notifications.saved')}
        </p>
      ) : null}
    </NotificationLayout>
  );
}

export function TelegramPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const token = useTelegramToken();
  const [now, setNow] = useState(Date.now);
  const remaining = token.data ? Math.max(0, Math.ceil((Date.parse(token.data.expires_at) - now) / 1000)) : 0;
  const link = useTelegramLink(Boolean(token.data && remaining > 0));
  const unlink = useUnlinkTelegram();
  useEffect(() => {
    if (!token.data || link.data?.linked || remaining === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [token.data, link.data?.linked, remaining]);
  return (
    <NotificationLayout me={me}>
      <PageHeader title="Telegram" description={t('notifications.telegramHint')} />
      {link.isPending ? (
        <Skeleton className="h-40" />
      ) : link.isError ? (
        <Alert tone="danger">{errorMessage(link.error, t)}</Alert>
      ) : (
        <Card className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={link.data.linked ? 'success' : 'neutral'}>
                {t(link.data.linked ? 'notifications.linked' : 'notifications.notLinked')}
              </Badge>
              {link.data.username ? <span>@{link.data.username}</span> : null}
            </div>
            {link.data.linked ? (
              <Button
                variant="outline"
                loading={unlink.isPending}
                onClick={() => {
                  token.reset();
                  unlink.mutate();
                }}
              >
                {t('notifications.disconnect')}
              </Button>
            ) : (
              <Button
                disabled={!link.data.configured}
                loading={token.isPending}
                onClick={() => {
                  setNow(Date.now());
                  token.mutate();
                }}
              >
                {t('notifications.connect')}
              </Button>
            )}
          </div>
          {!link.data.configured ? <Alert tone="info">{t('notifications.unavailable')}</Alert> : null}
          {link.data.blocked ? <Alert tone="warning">{t('notifications.blocked')}</Alert> : null}
          {token.data && !link.data.linked ? (
            remaining > 0 ? (
              <div className="flex flex-col items-start gap-4 sm:flex-row">
                <div className="rounded-xl bg-white p-3">
                  <QRCodeSVG value={token.data.deep_link} size={160} marginSize={1} title={t('notifications.connect')} />
                </div>
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t('notifications.scan')}</p>
                  <p role="timer" className="text-sm">
                    {t('notifications.expires', { time: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` })}
                  </p>
                  <Button asChild>
                    <a href={token.data.deep_link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                      {t('notifications.openTelegram')}
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              <Alert tone="info">{t('notifications.expired')}</Alert>
            )
          ) : null}
        </Card>
      )}
      {token.isError ? <Alert tone="danger">{errorMessage(token.error, t)}</Alert> : null}
      {unlink.isError ? <Alert tone="danger">{errorMessage(unlink.error, t)}</Alert> : null}
    </NotificationLayout>
  );
}
