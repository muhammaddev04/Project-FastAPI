import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { useCatalogQuery, useCatalogMutation, type Page } from '@/features/catalog/api';
import { Feedback, Field } from '@/features/catalog/shared';
import { useMembers } from '@/shared/auth/api';
import { formatDateTime } from '@/shared/lib/datetime';
import { Alert, Button, Card, Dialog, DialogContent, DialogHeader, ForbiddenState, Input, PageHeader, Select, Skeleton } from '@/shared/ui';
import { isOpen, today, type Delivery, type DeliveryDetail, type Run, type RunDetail, type StoreDelivery } from './api';

function useAccess() {
  const { membership } = useAreaContext();
  return { orgId: membership.organization_id, has: (permission: string) => membership.permissions.includes(permission) };
}

function CourierSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const { orgId, has } = useAccess();
  const members = useMembers(has('members.view') ? orgId : null, { status: 'ACTIVE', limit: 100 });
  return (
    <Field label={t('delivery.courier')}>
      <Select aria-label={t('delivery.courier')} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('delivery.chooseCourier')}</option>
        {members.data?.results
          .filter((row) => ['COURIER', 'OWNER', 'MANAGER'].includes(row.role))
          .map((row) => (
            <option key={row.user_id} value={row.user_id}>
              {row.full_name}
            </option>
          ))}
      </Select>
      <Feedback error={members.error} />
    </Field>
  );
}

function Action({
  path,
  label,
  body,
  disabled = false,
  method = 'POST',
  idempotent = true,
}: {
  path: string;
  label: string;
  body?: unknown;
  disabled?: boolean;
  method?: 'POST' | 'PATCH';
  idempotent?: boolean;
}) {
  const { orgId } = useAccess();
  const mutation = useCatalogMutation(path, orgId, method, idempotent);
  return (
    <div>
      <Button variant="outline" disabled={disabled || mutation.isPending} onClick={() => mutation.mutate(body)}>
        {label}
      </Button>
      <Feedback error={mutation.error} success={mutation.isSuccess} />
    </div>
  );
}

function StopList({ stops }: { stops: Delivery[] }) {
  const { t } = useTranslation();
  return (
    <ol className="space-y-3">
      {stops.map((row) => (
        <li key={row.id}>
          <Card className="space-y-2 p-4">
            <Link className="font-semibold underline" to={`/company/delivery/${row.id}`}>
              {row.stop_sequence ? `${row.stop_sequence}. ` : ''}
              {row.store_name ?? row.order_number ?? row.order_id}
            </Link>
            <p>{row.address}</p>
            <p>{t(`delivery.statuses.${row.status}`)}</p>
            {row.dispatched_at && <p>{formatDateTime(row.dispatched_at)}</p>}
            {row.delivered_at && <p>{formatDateTime(row.delivered_at)}</p>}
          </Card>
        </li>
      ))}
    </ol>
  );
}

function OrderedStops({ ids, rows, onChange }: { ids: string[]; rows: Delivery[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation();
  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id!);
    onChange(next);
  };
  return (
    <ol className="space-y-2" aria-label={t('delivery.stops')}>
      {ids.map((id, index) => (
        <li
          key={id}
          draggable
          onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const from = Number(event.dataTransfer.getData('text/plain'));
            if (Number.isInteger(from)) move(from, index);
          }}
          className="flex flex-wrap items-center gap-2 rounded border p-2"
        >
          <span className="min-w-0 flex-1 break-words">
            {index + 1}. {rows.find((row) => row.id === id)?.store_name ?? id}
          </span>
          <Button variant="outline" aria-label={t('delivery.moveUp')} disabled={index === 0} onClick={() => move(index, index - 1)}>
            ↑
          </Button>
          <Button
            variant="outline"
            aria-label={t('delivery.moveDown')}
            disabled={index === ids.length - 1}
            onClick={() => move(index, index + 1)}
          >
            ↓
          </Button>
          <Button variant="ghost" aria-label={t('delivery.removeStop')} onClick={() => onChange(ids.filter((value) => value !== id))}>
            ×
          </Button>
        </li>
      ))}
    </ol>
  );
}

export function DeliveryBoard() {
  const { t } = useTranslation();
  const { orgId, has } = useAccess();
  const [date, setDate] = useState(today);
  const [courier, setCourier] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const deliveries = useCatalogQuery<Page<Delivery>>(
    '/deliveries?status=PLANNED&status=ASSIGNED&limit=100',
    orgId,
    has('delivery.view_all'),
    30_000,
  );
  const runs = useCatalogQuery<Page<Run>>(`/delivery-runs?run_date=${date}&limit=100`, orgId, has('delivery.view_all'), 30_000);
  const create = useCatalogMutation<RunDetail>('/delivery-runs', orgId, 'POST', true);
  if (!has('delivery.view_all')) return <ForbiddenState />;
  const available = deliveries.data?.results.filter((row) => !row.run_id && (row.status === 'PLANNED' || row.courier_id === courier)) ?? [];
  return (
    <div className="space-y-5">
      <PageHeader title={t('delivery.board')} />
      <Field label={t('delivery.runDate')}>
        <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </Field>
      <Feedback error={deliveries.error ?? runs.error} />
      {(deliveries.isPending || runs.isPending) && <Skeleton className="h-24" />}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-4 p-4">
          <h2>{t('delivery.unassigned')}</h2>
          {!available.length && !deliveries.isPending && <p>{t('delivery.empty')}</p>}
          {has('delivery.plan') && (
            <CourierSelect
              value={courier}
              onChange={(value) => {
                setCourier(value);
                setSelected([]);
              }}
            />
          )}
          {available.map((row) => (
            <label key={row.id} className="flex gap-3 rounded border p-3">
              {has('delivery.plan') && (
                <input
                  type="checkbox"
                  checked={selected.includes(row.id)}
                  onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))}
                />
              )}
              <span>
                <Link className="underline" to={`/company/delivery/${row.id}`}>
                  {row.store_name ?? row.order_number}
                </Link>
                <span className="block">{row.address}</span>
                <span className="block">{row.order_total} TJS</span>
              </span>
            </label>
          ))}
          {has('delivery.plan') && (
            <>
              <OrderedStops ids={selected} rows={available} onChange={setSelected} />
              <Button
                disabled={!courier || !selected.length || !date || create.isPending}
                onClick={() =>
                  create.mutate({ courier_id: courier, run_date: date, delivery_ids: selected }, { onSuccess: () => setSelected([]) })
                }
              >
                {t('delivery.newRun')}
              </Button>
              <Feedback error={create.error} success={create.isSuccess} />
            </>
          )}
        </Card>
        <div className="space-y-4">
          <h2>{t('delivery.runs')}</h2>
          {!runs.data?.results.length && !runs.isPending && <p>{t('delivery.emptyRuns')}</p>}
          {runs.data?.results.map((run) => (
            <Card key={run.id} className="space-y-2 p-4">
              <Link className="underline" to={`/company/delivery/runs/${run.id}`}>
                {run.courier_name} · {run.run_date}
              </Link>
              <p>
                {t(`delivery.runStatuses.${run.status}`)} · {run.stop_count} {t('delivery.stops')}
              </p>
              {has('delivery.plan') && run.status === 'DRAFT' && (
                <Action path={`/delivery-runs/${run.id}/start`} label={t('delivery.actions.start')} />
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RunPage() {
  const { runId = '' } = useParams();
  const { orgId, has } = useAccess();
  const { t } = useTranslation();
  const query = useCatalogQuery<RunDetail>(`/delivery-runs/${runId}`, orgId, has('delivery.view_all'), 30_000);
  const pool = useCatalogQuery<Page<Delivery>>('/deliveries?status=PLANNED&status=ASSIGNED&limit=100', orgId, has('delivery.plan'));
  if (!has('delivery.view_all')) return <ForbiddenState />;
  const run = query.data;
  return (
    <div className="space-y-4">
      <PageHeader title={t('delivery.run')} />
      <Feedback error={query.error} />
      {!run ? (
        <Skeleton className="h-32" />
      ) : (
        <>
          <p>
            {run.courier_name} · {run.run_date} · {t(`delivery.runStatuses.${run.status}`)}
          </p>
          <StopList stops={run.stops} />
          {has('delivery.plan') && (
            <div className="flex flex-wrap gap-3">
              {run.status === 'DRAFT' && (
                <>
                  <Action path={`/delivery-runs/${run.id}/start`} label={t('delivery.actions.start')} />
                  <Action path={`/delivery-runs/${run.id}/cancel`} label={t('delivery.actions.cancelRun')} />
                </>
              )}
              {run.status === 'STARTED' && (
                <Action
                  path={`/delivery-runs/${run.id}/finish`}
                  disabled={run.stops.some((row) => isOpen(row.status))}
                  label={t('delivery.actions.finish')}
                />
              )}
            </div>
          )}
          {has('delivery.plan') && run.status === 'DRAFT' && (
            <RunEditor key={`${run.id}:${run.version}`} run={run} pool={pool.data?.results ?? []} />
          )}
        </>
      )}
    </div>
  );
}

function RunEditor({ run, pool }: { run: RunDetail; pool: Delivery[] }) {
  const { t } = useTranslation();
  const [ids, setIds] = useState(run.stops.map((row) => row.id));
  const rows = [...run.stops, ...pool.filter((row) => !row.run_id && (row.status === 'PLANNED' || row.courier_id === run.courier_id))];
  return (
    <Card className="space-y-3 p-4">
      <OrderedStops ids={ids} rows={rows} onChange={setIds} />
      <Select
        aria-label={t('delivery.stops')}
        value=""
        onChange={(event) => {
          if (event.target.value) setIds([...ids, event.target.value]);
        }}
      >
        <option value="">{t('delivery.emptyStops')}</option>
        {rows
          .filter((row) => !ids.includes(row.id))
          .map((row) => (
            <option key={row.id} value={row.id}>
              {row.store_name ?? row.order_number}
            </option>
          ))}
      </Select>
      <Action
        path={`/delivery-runs/${run.id}`}
        method="PATCH"
        idempotent={false}
        label={t('common.save')}
        disabled={!ids.length}
        body={{ delivery_ids: ids, version: run.version }}
      />
    </Card>
  );
}

export function DeliveryPage() {
  const { deliveryId = '' } = useParams();
  const { orgId, has } = useAccess();
  const { t } = useTranslation();
  const query = useCatalogQuery<DeliveryDetail>(`/deliveries/${deliveryId}`, orgId, has('delivery.view_all'), 30_000);
  const [courier, setCourier] = useState('');
  const [reason, setReason] = useState('');
  const [manual, setManual] = useState(false);
  if (!has('delivery.view_all')) return <ForbiddenState />;
  const row = query.data;
  return (
    <div className="space-y-4">
      <PageHeader title={t('delivery.title')} />
      <Feedback error={query.error} />
      {!row ? (
        <Skeleton className="h-32" />
      ) : (
        <>
          <Card className="space-y-2 p-4">
            <p>
              {row.store_name} · {row.order_number}
            </p>
            <p>{row.address}</p>
            <p>{t(`delivery.statuses.${row.status}`)}</p>
            <p>
              {t('delivery.attempt', { number: row.attempt_no })} · {row.courier_name}
            </p>
            <p>{t('delivery.codeAttempts', { count: row.code_attempts })}</p>
            {row.code_locked && <Alert tone="danger">{t('delivery.codeLocked')}</Alert>}
            <Link className="underline" to={`/company/orders/${row.order_id}`}>
              {t('orders.title')}
            </Link>
          </Card>
          {has('delivery.plan') && row.status === 'PLANNED' && (
            <>
              <CourierSelect value={courier} onChange={setCourier} />
              <Action
                path={`/deliveries/${row.id}/assign`}
                label={t('delivery.actions.assign')}
                disabled={!courier}
                idempotent={false}
                body={{ courier_id: courier, version: row.version }}
              />
            </>
          )}
          {has('delivery.plan') && row.status === 'ASSIGNED' && (
            <Action
              path={`/deliveries/${row.id}/unassign`}
              label={t('delivery.actions.unassign')}
              idempotent={false}
              body={{ version: row.version }}
            />
          )}
          {has('delivery.act_any') && row.status === 'ASSIGNED' && (
            <Action path={`/courier/deliveries/${row.id}/dispatch`} label={t('delivery.actions.dispatch')} />
          )}
          {has('delivery.act_any') && ['IN_TRANSIT', 'ARRIVED'].includes(row.status) && (
            <Link className="underline" to={`/company/delivery/stops/${row.id}`}>
              {t('delivery.stop')}
            </Link>
          )}
          {has('delivery.plan') && ['PLANNED', 'ASSIGNED'].includes(row.status) && (
            <>
              <Field label={t('orders.reason')}>
                <Input value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
              <Action
                path={`/deliveries/${row.id}/cancel`}
                label={t('delivery.actions.cancel')}
                disabled={!reason.trim()}
                idempotent={false}
                body={{ reason, version: row.version }}
              />
            </>
          )}
          {['IN_TRANSIT', 'ARRIVED'].includes(row.status) && (
            <div className="flex flex-wrap gap-3">
              {has('delivery.regenerate_code') && (
                <Action path={`/deliveries/${row.id}/regenerate-code`} label={t('delivery.actions.regenerate')} />
              )}
              {has('delivery.manual_confirm') && (
                <Button
                  variant="danger"
                  onClick={() => {
                    setReason('');
                    setManual(true);
                  }}
                >
                  {t('delivery.actions.manual')}
                </Button>
              )}
            </div>
          )}
          <ol className="space-y-2">
            {row.history.map((history) => (
              <li key={history.id}>
                {t(`delivery.statuses.${history.to_status}`)} · {formatDateTime(history.created_at)} {history.reason}
              </li>
            ))}
          </ol>
          <Dialog open={manual} onOpenChange={setManual}>
            <DialogContent>
              <DialogHeader title={t('delivery.manual.title')} description={t('delivery.manual.warning')} tone="danger" />
              <Alert tone="danger">{t('delivery.manual.warning')}</Alert>
              <Field label={t('delivery.manual.reason')}>
                <Input value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
              <Action
                path={`/deliveries/${row.id}/manual-confirm`}
                label={t('delivery.actions.manual')}
                disabled={reason.trim().length < 10}
                body={{ reason }}
              />
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

export function StoreDeliveryBlock({ orderId, orgId }: { orderId: string; orgId: string }) {
  const { t } = useTranslation();
  const query = useCatalogQuery<StoreDelivery>(`/orders/${orderId}/delivery`, orgId, true, 30_000);
  if (query.isError) return <Feedback error={query.error} />;
  if (!query.data) return <Skeleton className="h-24" />;
  const row = query.data;
  return (
    <Card className="space-y-3 p-4">
      <h2>{t('delivery.title')}</h2>
      <p>{t(`delivery.statuses.${row.status}`)}</p>
      {row.courier_name && (
        <p>
          {row.courier_name}{' '}
          {row.courier_phone && (
            <a className="underline" href={`tel:${row.courier_phone}`}>
              {row.courier_phone}
            </a>
          )}
        </p>
      )}
      {row.code && (
        <>
          <p className="font-mono text-4xl font-bold tracking-widest" aria-label={t('delivery.code')}>
            {row.code}
          </p>
          <p>{t('delivery.codeHint')}</p>
        </>
      )}
    </Card>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return <Card className="space-y-3 p-4">{children}</Card>;
}
