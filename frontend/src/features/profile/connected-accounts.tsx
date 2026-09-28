import { Link2 } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useMeta } from '@/shared/api/meta';
import { errorMessage } from '@/shared/api/errors';
import { clearGoogleIntent } from '@/shared/auth/google-intent';
import { formatDate } from '@/shared/lib/datetime';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Skeleton } from '@/shared/ui';
import { GoogleMark } from '@/features/auth/google-button';
import { useGoogleLinkState, useStartGoogleLink } from './google-link-api';

/** What the Google callback page hands back to /profile. */
export type GoogleLinkResult = { googleLink?: 'linked' | 'already_linked' | 'cancelled' };

/**
 * Connected accounts: link a Google account to this signed-in user so "Continue with Google" opens the same
 * account. Disconnecting is not offered: an account created with Google has no password it knows, so removing the
 * link could lock its owner out (it needs a password-reset/recovery step first).
 */
export function ConnectedAccounts() {
  const { t } = useTranslation();
  const result = (useLocation().state ?? {}) as GoogleLinkResult;
  const meta = useMeta();
  const state = useGoogleLinkState();
  const connect = useStartGoogleLink();
  const googleEnabled = meta.data?.auth.google === true;
  // Arrived back from the Google callback: the link flow is over.
  useEffect(() => {
    if (result.googleLink) clearGoogleIntent();
  }, [result.googleLink]);

  return (
    <Card>
      <CardHeader icon={<Link2 />} title={t('profile.connected.title')} description={t('profile.connected.description')} />
      <CardBody className="space-y-3">
        {result.googleLink === 'linked' || result.googleLink === 'already_linked' ? (
          <Alert tone="success">{t(`profile.connected.result.${result.googleLink}`)}</Alert>
        ) : null}
        {result.googleLink === 'cancelled' ? <Alert tone="info">{t('profile.connected.result.cancelled')}</Alert> : null}

        {state.isPending ? (
          <Skeleton className="h-12" />
        ) : state.isError ? (
          <Alert tone="danger">{errorMessage(state.error, t)}</Alert>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-subtle/40 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-white shadow-raised dark:border-white/10 [&_svg]:size-5">
                <GoogleMark />
              </span>
              <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                Google
                <Badge tone={state.data.connected ? 'success' : 'neutral'}>
                  {state.data.connected ? t('profile.connected.connected') : t('profile.connected.notConnected')}
                </Badge>
              </p>
              {state.data.connected ? (
                <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
                  {state.data.email ?? '—'}
                  {state.data.linked_at ? ` · ${t('profile.connected.since', { date: formatDate(state.data.linked_at) })}` : null}
                </p>
              ) : (
                <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{t('profile.connected.hint')}</p>
              )}
              </div>
            </div>
            {state.data.connected ? null : (
              <Button variant="outline" size="sm" disabled={!googleEnabled} loading={connect.isPending || meta.isPending} onClick={() => connect.mutate()}>
                <Link2 /> {t('profile.connected.connect')}
              </Button>
            )}
          </div>
        )}
        {connect.isError ? <Alert tone="danger">{errorMessage(connect.error, t)}</Alert> : null}
        {state.data?.connected ? <p className="text-[0.75rem] text-muted-foreground">{t('profile.connected.noDisconnect')}</p> : null}
      </CardBody>
    </Card>
  );
}