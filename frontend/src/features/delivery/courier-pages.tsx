import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { catalogKey, useCatalogMutation } from '@/features/catalog/api';
import { Feedback, Field } from '@/features/catalog/shared';
import { apiRequest } from '@/shared/api/client';
import { Alert, Button, Card, ForbiddenState, Input, PageHeader, Select, Skeleton } from '@/shared/ui';
import { failureReasons, mapsUrl, type CourierStop, type CourierToday, type FailureReason, type Run } from './api';
import { validAmount } from '@/features/finance/api';
import { useCourierSync } from './courier-sync';

function useCourierQuery<T>(path: string) {
  const { membership, me } = useAreaContext();
  const orgId = membership.organization_id;
  return useQuery({
    queryKey: catalogKey(orgId, path, me.id),
    queryFn: ({ signal }) => apiRequest<T>(path, { signal, headers: { 'X-Org-Id': orgId, 'X-Courier-Cache-Scope': `${me.id}:${orgId}` } }),
    enabled: membership.permissions.includes('delivery.act_own'),
    refetchInterval: 30_000,
  });
}

function Connection({ sync }: { sync: ReturnType<typeof useCourierSync> }) {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  const base = membership.role === 'COURIER' ? '/courier' : '/company/delivery';
  return (
    <div className="space-y-2">
      <p role="status">
        {t(sync.online ? 'delivery.online' : 'delivery.offline')} ·{' '}
        {t('delivery.queued', { count: sync.rows.filter((row) => row.status === 'PENDING').length })}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => void sync.sync()} disabled={!sync.online}>
          {t('delivery.syncNow')}
        </Button>
        <Link className="underline" to={`${base}/issues`}>
          {t('delivery.issues')}
        </Link>
      </div>
      <Feedback error={sync.error} />
    </div>
  );
}

export function CourierPage() {
  const { t } = useTranslation();
  const { membership, me } = useAreaContext();
  const query = useCourierQuery<CourierToday>('/courier/today');
  const sync = useCourierSync(me.id, membership.organization_id);
  const data = query.data;
  if (!membership.permissions.includes('delivery.act_own')) return <ForbiddenState />;
  return (
    <div className="space-y-4">
      <PageHeader title={t('delivery.today')} />
      <Connection sync={sync} />
      <Feedback error={query.error} />
      {query.isPending && <Skeleton className="h-24" />}
      {data?.runs?.map((run) => (
        <RunControl
          key={run.id}
          run={run}
          orgId={membership.organization_id}
          online={sync.online}
          stops={data.stops.filter((stop) => stop.run_id === run.id)}
        />
      ))}
      {data && !data.stops.length && <p>{t('delivery.empty')}</p>}
      <ol className="space-y-3">
        {data?.stops.map((stop) => (
          <li key={stop.id}>
            <Card className="space-y-2 p-4">
              <Link className="font-semibold underline" to={`/courier/stops/${stop.id}`}>
                {stop.stop_sequence ? `${stop.stop_sequence}. ` : ''}
                {stop.store_name}
              </Link>
              <p>{stop.address}</p>
              <p>{t(`delivery.statuses.${stop.status}`)}</p>
              <p>{stop.order_number}</p>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RunControl({ run, orgId, online, stops }: { run: Run; orgId: string; online: boolean; stops: CourierStop[] }) {
  const { t } = useTranslation();
  const action = useCatalogMutation(`/courier/runs/${run.id}/${run.status === 'DRAFT' ? 'start' : 'finish'}`, orgId, 'POST', true);
  return (
    <Card className="space-y-3 p-4">
      <p>
        {run.run_date} · {t(`delivery.runStatuses.${run.status}`)}
      </p>
      {['DRAFT', 'STARTED'].includes(run.status) && (
        <Button
          disabled={
            !online ||
            action.isPending ||
            (run.status === 'STARTED' && stops.some((stop) => ['ASSIGNED', 'IN_TRANSIT', 'ARRIVED'].includes(stop.status)))
          }
          onClick={() => action.mutate(undefined)}
        >
          {t(run.status === 'DRAFT' ? 'delivery.actions.start' : 'delivery.actions.finish')}
        </Button>
      )}
      <Feedback error={action.error} />
    </Card>
  );
}

export function CourierStopPage() {
  const { deliveryId = '' } = useParams();
  const { t } = useTranslation();
  const { membership, me } = useAreaContext();
  const query = useCourierQuery<CourierStop>(`/courier/deliveries/${deliveryId}`);
  const sync = useCourierSync(me.id, membership.organization_id);
  const dispatch = useCatalogMutation(`/courier/deliveries/${deliveryId}/dispatch`, membership.organization_id, 'POST', true);
  const [cash, setCash] = useState('');
  const [cashSaved, setCashSaved] = useState(false);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState<FailureReason>('STORE_CLOSED');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  if (!membership.permissions.includes('delivery.act_own')) return <ForbiddenState />;
  const stop = query.data;
  const pending = sync.rows.filter((row) => row.entity_id === deliveryId && row.status === 'PENDING');
  const pendingClose = pending.some((row) => ['DELIVERY_CONFIRM', 'DELIVERY_FAIL'].includes(row.operation_type));
  const canAct = sync.online || membership.role === 'COURIER';
  const arrived = pending.some((row) => row.operation_type === 'DELIVERY_ARRIVE') || stop?.status === 'ARRIVED';
  const act = async (type: 'DELIVERY_ARRIVE' | 'DELIVERY_CONFIRM' | 'DELIVERY_FAIL', payload?: Record<string, unknown>) => {
    if (!stop || !canAct) return;
    setBusy(true);
    try {
      await sync.act(type, stop.id, arrived ? 'ARRIVED' : stop.status, payload);
      setCode('');
      setError(undefined);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader title={t('delivery.stop')} />
      <Connection sync={sync} />
      <Feedback error={error ?? query.error ?? dispatch.error} />
      {!stop ? (
        <Skeleton className="h-32" />
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <h2 className="text-xl font-semibold">{stop.store_name}</h2>
            <p>{stop.address}</p>
            <p>{stop.order_number}</p>
            <p>{t(`delivery.statuses.${stop.status}`)}</p>
            <div className="flex flex-wrap gap-4">
              <a className="underline" href={mapsUrl(stop)} target="_blank" rel="noreferrer">
                {t('delivery.openMap')}
              </a>
              <a className="underline" href={`tel:${stop.store_phone}`}>
                {t('delivery.call')}
              </a>
            </div>
            <ul>
              {stop.items.map((item, index) => (
                <li key={index}>
                  {item.product_name} · {item.quantity} {item.unit_code}
                </li>
              ))}
            </ul>
            <p>
              {t('delivery.orderTotal')}: {stop.order_total} TJS
            </p>
          </Card>
          {membership.role === 'COURIER' &&
            membership.permissions.includes('payments.record') &&
            !['CANCELLED', 'FAILED', 'PLANNED'].includes(stop.status) && (
              <Card className="space-y-3 p-4">
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!validAmount(cash) || busy) return;
                    setBusy(true);
                    void sync
                      .act('PAYMENT_RECORD', stop.id, stop.status, { amount: cash })
                      .then(() => {
                        setCash('');
                        setCashSaved(true);
                        setError(undefined);
                      })
                      .catch(setError)
                      .finally(() => setBusy(false));
                  }}
                >
                  <Field label={t('finance.amount')}>
                    <Input
                      inputMode="decimal"
                      value={cash}
                      onChange={(event) => {
                        setCash(event.target.value);
                        setCashSaved(false);
                      }}
                    />
                  </Field>
                  <Button type="submit" disabled={!validAmount(cash) || busy}>
                    {t('finance.cash')}
                  </Button>
                </form>
                {cashSaved && <p role="status">{t('finance.cashSaved')}</p>}
              </Card>
            )}
          {stop.status === 'ASSIGNED' && (
            <Button disabled={!sync.online || busy || dispatch.isPending} onClick={() => dispatch.mutate(undefined)}>
              {t('delivery.actions.dispatch')}
            </Button>
          )}
          {['IN_TRANSIT', 'ARRIVED'].includes(stop.status) && (
            <Card className="space-y-4 p-4">
              {!arrived && (
                <Button disabled={!canAct || busy || pendingClose} onClick={() => void act('DELIVERY_ARRIVE')}>
                  {t('delivery.actions.arrive')}
                </Button>
              )}
              {stop.code_locked && <Alert tone="danger">{t('delivery.codeLocked')}</Alert>}
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act('DELIVERY_CONFIRM', { code });
                }}
              >
                <Field label={t('delivery.enterCode')}>
                  <Input
                    inputMode="numeric"
                    autoComplete="off"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </Field>
                <Button type="submit" disabled={!canAct || busy || pendingClose || stop.code_locked || !/^\d{6}$/.test(code)}>
                  {t('delivery.actions.confirm')}
                </Button>
              </form>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act('DELIVERY_FAIL', { reason_code: reason, note: note || null });
                }}
              >
                <Field label={t('delivery.reportFailure')}>
                  <Select value={reason} onChange={(event) => setReason(event.target.value as FailureReason)}>
                    {failureReasons.map((value) => (
                      <option key={value} value={value}>
                        {t(`delivery.reasons.${value}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('orders.reason')}>
                  <Input required={reason === 'OTHER'} value={note} onChange={(event) => setNote(event.target.value)} />
                </Field>
                <Button variant="danger" type="submit" disabled={!canAct || busy || pendingClose || (reason === 'OTHER' && !note.trim())}>
                  {t('delivery.actions.fail')}
                </Button>
              </form>
            </Card>
          )}
          {pendingClose && <Alert>{t('delivery.queued', { count: pending.length })}</Alert>}
        </>
      )}
    </div>
  );
}

export function CourierIssuesPage() {
  const { membership, me } = useAreaContext();
  const { t } = useTranslation();
  const sync = useCourierSync(me.id, membership.organization_id);
  const issues = sync.rows.filter((row) => row.status !== 'PENDING');
  const base = membership.role === 'COURIER' ? '/courier' : '/company/delivery';
  return (
    <div className="space-y-4">
      <PageHeader title={t('delivery.issues')} />
      <Connection sync={sync} />
      {!issues.length && <p>{t('delivery.noIssues')}</p>}
      {issues.map((row) => (
        <Card className="space-y-3 p-4" key={row.operation_id}>
          <p>{t(`delivery.results.${row.status}`)}</p>
          <Link className="underline" to={`${base}/stops/${row.entity_id}`}>
            {t('delivery.stop')}
          </Link>
          <p>{t(`errors.${row.error ?? 'sync_conflict'}`)}</p>
          {row.server_status && <p>{t('delivery.serverState', { status: t(`delivery.statuses.${row.server_status}`) })}</p>}
        </Card>
      ))}
    </div>
  );
}
