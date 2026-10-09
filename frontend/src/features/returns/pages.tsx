import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { catalogKey, useCatalogMutation, useCatalogQuery, type Page } from '@/features/catalog/api';
import { Feedback, Field } from '@/features/catalog/shared';
import type { OrderView } from '@/features/orders/api';
import { formatDateTime } from '@/shared/lib/datetime';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  DialogContent,
  DialogHeader,
  ForbiddenState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
} from '@/shared/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  money,
  previewQuery,
  returnStatuses,
  stepCeiling,
  validStep,
  type CompletionPreview,
  type Return,
  type ReturnDetail,
  type ReturnItem,
  type ReturnStatus,
} from './api';
import { useReturnsAccess } from './access';
import { ReturnsTabs } from './shared';

export function ReturnsPage() {
  const { t } = useTranslation();
  const { orgId, base, has } = useReturnsAccess();
  /*
   * P10 §9 asks for tabs by status, and the endpoint filters on exactly one. Each tab is therefore its own
   * server-side query, so the row count under it is the real count and paging through a busy queue never
   * pages through rows another tab owns.
   */
  const [status, setStatus] = useState<ReturnStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [ordering, setOrdering] = useState('-created_at');
  const params = new URLSearchParams({ limit: '20', offset: String(offset), ordering });
  if (status) params.set('status', status);
  const query = useCatalogQuery<Page<Return>>(`/returns?${params}`, orgId, has('returns.view'), 30_000);
  if (!has('returns.view')) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader title={t('returns.title')} description={t('returns.intro')}>
        <ReturnsTabs />
      </PageHeader>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('returns.status')}>
        {([''] as (ReturnStatus | '')[]).concat(returnStatuses).map((value) => (
          <Button
            key={value || 'all'}
            variant={status === value ? 'primary' : 'outline'}
            onClick={() => {
              setStatus(value);
              setOffset(0);
            }}
          >
            {value ? t(`returns.statuses.${value}`) : t('returns.all')}
          </Button>
        ))}
      </div>
      <Select
        className="max-w-60"
        aria-label={t('returns.ordering')}
        value={ordering}
        onChange={(event) => {
          setOrdering(event.target.value);
          setOffset(0);
        }}
      >
        <option value="-created_at">{t('returns.newest')}</option>
        <option value="created_at">{t('returns.oldest')}</option>
      </Select>
      <Feedback error={query.error} />
      <DataTable
        rows={query.data?.results ?? []}
        rowKey={(row) => row.id}
        loading={query.isLoading}
        density="compact"
        empty={{ title: t('returns.empty'), description: t('returns.emptyHint') }}
        pagination={{ limit: 20, offset, count: query.data?.count ?? 0, onChange: setOffset }}
        columns={[
          {
            key: 'number',
            header: t('returns.number'),
            primary: true,
            cell: (row) => (
              <Link className="font-semibold text-primary" to={`${base}/returns/${row.id}`}>
                {row.return_number}
              </Link>
            ),
          },
          { key: 'status', header: t('returns.status'), cell: (row) => <StatusBadge kind="returnStatus" value={row.status} /> },
          { key: 'reason', header: t('returns.reason'), cell: (row) => t(`returns.reasons.${row.reason_code}`) },
          {
            key: 'source',
            header: t('returns.source'),
            cell: (row) =>
              row.source === 'DISPUTE' && row.dispute_id ? (
                <Link className="underline" to={`${base}/disputes/${row.dispute_id}`}>
                  {t('returns.sources.DISPUTE')}
                </Link>
              ) : (
                t(`returns.sources.${row.source}`)
              ),
          },
          {
            key: 'credit',
            header: t('returns.credit'),
            numeric: true,
            cell: (row) => (row.total_credit ? `${money(row.total_credit)} TJS` : '—'),
          },
          { key: 'created', header: t('returns.created'), cell: (row) => formatDateTime(row.created_at) },
        ]}
      />
    </div>
  );
}

/** The order's own lines, so a return item can be named by the product it came from. */
function useOrderLines(orderId: string | undefined, orgId: string, enabled: boolean) {
  const query = useCatalogQuery<OrderView>(`/orders/${orderId}`, orgId, enabled && !!orderId);
  const byItem = new Map((query.data?.items ?? []).map((item) => [item.id, item]));
  return { order: query.data, byItem, error: query.error };
}

export function ReturnPage() {
  const { t } = useTranslation();
  const { returnId = '' } = useParams();
  const { orgId, company, base, has, membership } = useReturnsAccess();
  const query = useCatalogQuery<ReturnDetail>(`/returns/${returnId}`, orgId, has('returns.view'), 30_000);
  const record = query.data;
  const lines = useOrderLines(record?.order_id, orgId, has('orders.view'));
  const [action, setAction] = useState<'reject' | 'cancel' | null>(null);
  if (!has('returns.view')) return <ForbiddenState />;
  if (query.isLoading) return <Skeleton className="h-40" />;
  if (!record) return <Feedback error={query.error} />;
  const name = (item: ReturnItem) => lines.byItem.get(item.order_item_id)?.product_name_snapshot ?? item.order_item_id;
  const unit = (item: ReturnItem) => lines.byItem.get(item.order_item_id)?.unit_code_snapshot ?? '';
  // A store cancels its own request and says nothing; the company must give a reason (P10 §7).
  const canCancel =
    record.status === 'REQUESTED' && (company ? has('returns.approve') : has('returns.cancel_own') && membership.role === 'OWNER');
  return (
    <div className="space-y-5">
      <PageHeader
        title={record.return_number}
        actions={
          <Button asChild variant="outline">
            <Link to={`${base}/returns`}>{t('returns.title')}</Link>
          </Button>
        }
      />
      <Feedback error={query.error} />
      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="returnStatus" value={record.status} />
          <Badge tone="neutral">{t(`returns.reasons.${record.reason_code}`)}</Badge>
          {record.source === 'DISPUTE' && record.dispute_id && (
            <Link className="underline" to={`${base}/disputes/${record.dispute_id}`}>
              {t('returns.fromDispute')}
            </Link>
          )}
        </div>
        <p>
          {t('returns.order')}:{' '}
          <Link className="underline" to={`${base}/orders/${record.order_id}`}>
            {lines.order?.order_number ?? record.order_id}
          </Link>
        </p>
        {record.note && (
          <p className="break-words">
            {t('returns.note')}: {record.note}
          </p>
        )}
        {record.rejection_reason && (
          <Alert tone="danger">
            {t('returns.rejectionReason')}: {record.rejection_reason}
          </Alert>
        )}
        {record.cancel_reason && (
          <Alert tone="warning">
            {t('returns.cancelReason')}: {record.cancel_reason}
          </Alert>
        )}
        {record.total_credit && (
          <p className="font-semibold">
            {t('returns.credit')}: {money(record.total_credit)} TJS
          </p>
        )}
      </Card>
      <DataTable
        rows={record.items}
        rowKey={(row) => row.id}
        density="compact"
        empty={{ title: t('returns.noLines') }}
        columns={[
          {
            key: 'product',
            header: t('returns.product'),
            primary: true,
            cell: (row) => [name(row), unit(row)].filter(Boolean).join(' · '),
          },
          { key: 'requested', header: t('returns.requested'), numeric: true, cell: (row) => row.requested_quantity },
          { key: 'approved', header: t('returns.approved'), numeric: true, cell: (row) => row.approved_quantity ?? '—' },
          { key: 'received', header: t('returns.received'), numeric: true, cell: (row) => row.received_quantity ?? '—' },
          { key: 'accepted', header: t('returns.accepted'), numeric: true, cell: (row) => row.accepted_quantity ?? '—' },
          { key: 'restock', header: t('returns.restock'), numeric: true, cell: (row) => row.restock_quantity ?? '—' },
          {
            key: 'lineCredit',
            header: t('returns.lineCredit'),
            numeric: true,
            cell: (row) => (row.line_credit ? money(row.line_credit) : '—'),
          },
        ]}
      />
      {company && has('returns.approve') && record.status === 'REQUESTED' && (
        <StepPanel key={`approve:${record.version}`} record={record} step="approved" name={name} />
      )}
      {company && has('returns.receive') && record.status === 'APPROVED' && (
        <StepPanel key={`receive:${record.version}`} record={record} step="received" name={name} />
      )}
      {company && has('returns.complete') && record.status === 'RECEIVED' && (
        <CompletionPanel key={`complete:${record.version}`} record={record} name={name} />
      )}
      <div className="flex flex-wrap gap-2">
        {company && has('returns.approve') && record.status === 'REQUESTED' && (
          <Button variant="danger" onClick={() => setAction('reject')}>
            {t('returns.reject')}
          </Button>
        )}
        {canCancel && (
          <Button variant="outline" onClick={() => setAction('cancel')}>
            {t('returns.cancel')}
          </Button>
        )}
      </div>
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t('returns.timeline')}</h2>
        <ol className="space-y-3">
          {record.history.map((row) => (
            <li key={row.id}>
              <span>{t(`returns.statuses.${row.to_status}`)}</span> · <time>{formatDateTime(row.created_at)}</time>
              {row.actor_type === 'SYSTEM' && <Badge className="ml-2">{t('returns.system')}</Badge>}
              {row.reason && <p className="break-words text-muted-foreground">{row.reason}</p>}
            </li>
          ))}
        </ol>
      </Card>
      {action && <ReasonDialog key={action} record={record} action={action} close={() => setAction(null)} />}
    </div>
  );
}

/**
 * Approve and receive are the same form at two points of the RET-003 ladder: every line starts at the
 * ceiling the previous step left it, and lowering one to zero drops it from the return.
 */
function StepPanel({ record, step, name }: { record: ReturnDetail; step: 'approved' | 'received'; name: (item: ReturnItem) => string }) {
  const { t } = useTranslation();
  const { orgId } = useReturnsAccess();
  const cache = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(record.items.map((item) => [item.id, stepCeiling(item, step)])),
  );
  const endpoint = step === 'approved' ? 'approve' : 'receive';
  const mutation = useCatalogMutation<ReturnDetail>(`/returns/${record.id}/${endpoint}`, orgId, 'POST', true);
  const field = step === 'approved' ? 'approved_quantity' : 'received_quantity';
  const invalid = record.items.some((item) => !validStep(values[item.id] ?? '', stepCeiling(item, step)));
  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-semibold">{t(`returns.${endpoint}`)}</h2>
      <p className="text-muted-foreground">{t(`returns.${endpoint}Hint`)}</p>
      <div className="space-y-3">
        {record.items.map((item) => (
          <Field key={item.id} label={`${name(item)} (${t('returns.max')} ${stepCeiling(item, step)})`}>
            <Input
              inputMode="decimal"
              value={values[item.id] ?? ''}
              invalid={!validStep(values[item.id] ?? '', stepCeiling(item, step))}
              onChange={(event) => setValues((current) => ({ ...current, [item.id]: event.target.value }))}
            />
          </Field>
        ))}
      </div>
      <Feedback error={mutation.error} />
      <Button
        disabled={invalid || mutation.isPending}
        onClick={() =>
          mutation.mutate(
            {
              version: record.version,
              items: record.items.map((item) => ({ id: item.id, [field]: values[item.id] })),
            },
            { onSuccess: (data) => cache.setQueryData(catalogKey(orgId, `/returns/${record.id}`), data) },
          )
        }
      >
        {t('common.confirm')}
      </Button>
    </Card>
  );
}

/**
 * RET-010/012 completion. Accepted drives the credit and restock drives the warehouse, and they are not the
 * same number: an accepted line with zero restock is damaged goods that never reach the shelf. The preview is
 * the server's own calculation, so the person approving the credit sees the figure that will be posted.
 */
function CompletionPanel({ record, name }: { record: ReturnDetail; name: (item: ReturnItem) => string }) {
  const { t } = useTranslation();
  const { orgId } = useReturnsAccess();
  const cache = useQueryClient();
  const [accepted, setAccepted] = useState<Record<string, string>>(
    Object.fromEntries(record.items.map((item) => [item.id, stepCeiling(item, 'accepted')])),
  );
  const [restock, setRestock] = useState<Record<string, string>>(
    Object.fromEntries(record.items.map((item) => [item.id, stepCeiling(item, 'accepted')])),
  );
  const mutation = useCatalogMutation<ReturnDetail>(`/returns/${record.id}/complete`, orgId, 'POST', true);
  const invalid = record.items.some(
    (item) =>
      !validStep(accepted[item.id] ?? '', stepCeiling(item, 'accepted')) || !validStep(restock[item.id] ?? '', accepted[item.id] ?? '0'),
  );
  const lines = record.items.map((item) => ({ id: item.id, accepted: accepted[item.id] ?? '0', restock: restock[item.id] ?? '0' }));
  const preview = useCatalogQuery<CompletionPreview>(`/returns/${record.id}/completion-preview?${previewQuery(lines)}`, orgId, !invalid);
  const credit = new Map((preview.data?.lines ?? []).map((line) => [line.return_item_id, line.line_credit]));
  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-semibold">{t('returns.complete')}</h2>
      <p className="text-muted-foreground">{t('returns.completeHint')}</p>
      <div className="space-y-4">
        {record.items.map((item) => (
          <div key={item.id} className="grid gap-3 sm:grid-cols-3">
            <Field label={`${name(item)} · ${t('returns.accepted')}`}>
              <Input
                inputMode="decimal"
                value={accepted[item.id] ?? ''}
                invalid={!validStep(accepted[item.id] ?? '', stepCeiling(item, 'accepted'))}
                onChange={(event) => setAccepted((current) => ({ ...current, [item.id]: event.target.value }))}
              />
            </Field>
            <Field label={t('returns.restock')}>
              <Input
                inputMode="decimal"
                value={restock[item.id] ?? ''}
                invalid={!validStep(restock[item.id] ?? '', accepted[item.id] ?? '0')}
                onChange={(event) => setRestock((current) => ({ ...current, [item.id]: event.target.value }))}
              />
            </Field>
            <Field label={t('returns.lineCredit')}>
              <output className="text-body">{credit.has(item.id) ? `${money(credit.get(item.id))} TJS` : '—'}</output>
            </Field>
          </div>
        ))}
      </div>
      <Feedback error={mutation.error || preview.error} />
      {preview.data && (
        <Alert tone="info">
          {t('returns.previewTotal')}: {money(preview.data.total_credit)} TJS — {t('returns.previewEffect')}
        </Alert>
      )}
      <Button
        disabled={invalid || mutation.isPending}
        onClick={() =>
          mutation.mutate(
            {
              version: record.version,
              items: lines.map((line) => ({ id: line.id, accepted_quantity: line.accepted, restock_quantity: line.restock })),
            },
            { onSuccess: (data) => cache.setQueryData(catalogKey(orgId, `/returns/${record.id}`), data) },
          )
        }
      >
        {t('returns.confirmCredit')}
      </Button>
    </Card>
  );
}

function ReasonDialog({ record, action, close }: { record: ReturnDetail; action: 'reject' | 'cancel'; close: () => void }) {
  const { t } = useTranslation();
  const { orgId, company } = useReturnsAccess();
  const cache = useQueryClient();
  const [reason, setReason] = useState('');
  const mutation = useCatalogMutation<ReturnDetail>(`/returns/${record.id}/${action}`, orgId, 'POST', true);
  // Only the store's cancellation of its own request needs no explanation.
  const needsReason = action === 'reject' || company;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogHeader title={t(`returns.${action}`)} />
        <p className="my-3">{record.return_number}</p>
        {needsReason && (
          <Field label={t('returns.reasonLabel')}>
            <Textarea value={reason} maxLength={5000} onChange={(event) => setReason(event.target.value)} />
          </Field>
        )}
        <Feedback error={mutation.error} />
        <Button
          className="mt-4"
          variant={action === 'reject' ? 'danger' : 'primary'}
          disabled={mutation.isPending || (needsReason && reason.trim().length < 3)}
          onClick={() =>
            mutation.mutate(
              { version: record.version, ...(needsReason ? { reason } : {}) },
              {
                onSuccess: (data) => {
                  cache.setQueryData(catalogKey(orgId, `/returns/${record.id}`), data);
                  close();
                },
              },
            )
          }
        >
          {t('common.confirm')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
