import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { catalogKey, useCatalogMutation, useCatalogQuery, type Page } from '@/features/catalog/api';
import { Feedback, Field } from '@/features/catalog/shared';
import { adjustmentBalance, validAmount, type Balance, type Payment } from '@/features/finance/api';
import type { Delivery } from '@/features/delivery/api';
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
import {
  disputeStatuses,
  disputeTypes,
  money,
  openDisputeStatuses,
  resolutionTypes,
  slaTone,
  validQuantity,
  type Dispute,
  type DisputeDetail,
  type DisputeMessage,
  type DisputeStatus,
  type ResolutionType,
} from './api';
import { useReturnsAccess } from './access';
import { ReturnsTabs } from './shared';
import { AttachmentsInput, type AttachmentFile } from './attachments';

export function DisputesPage() {
  const { t } = useTranslation();
  const { orgId, base, has } = useReturnsAccess();
  const [status, setStatus] = useState<DisputeStatus | ''>('');
  const [type, setType] = useState('');
  const [offset, setOffset] = useState(0);
  const [ordering, setOrdering] = useState('created_at');
  const params = new URLSearchParams({ limit: '20', offset: String(offset), ordering });
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  const query = useCatalogQuery<Page<Dispute>>(`/disputes?${params}`, orgId, has('disputes.view'), 30_000);
  if (!has('disputes.view')) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader title={t('returns.disputes')} description={t('returns.disputesDescription')}>
        <ReturnsTabs />
      </PageHeader>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('returns.status')}>
        {([''] as (DisputeStatus | '')[]).concat(disputeStatuses).map((value) => (
          <Button
            key={value || 'all'}
            variant={status === value ? 'primary' : 'outline'}
            onClick={() => {
              setStatus(value);
              setOffset(0);
            }}
          >
            {value ? t(`returns.disputeStatuses.${value}`) : t('returns.all')}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <Select
          className="max-w-60"
          aria-label={t('returns.type')}
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('returns.allTypes')}</option>
          {disputeTypes.map((value) => (
            <option key={value} value={value}>
              {t(`returns.types.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          className="max-w-60"
          aria-label={t('returns.ordering')}
          value={ordering}
          onChange={(event) => {
            setOrdering(event.target.value);
            setOffset(0);
          }}
        >
          {/* The queue is worked oldest first: that is the order the SLA clock runs in. */}
          <option value="created_at">{t('returns.oldest')}</option>
          <option value="-created_at">{t('returns.newest')}</option>
        </Select>
      </div>
      <Feedback error={query.error} />
      <DataTable
        rows={query.data?.results ?? []}
        rowKey={(row) => row.id}
        loading={query.isLoading}
        density="compact"
        empty={{ title: t('returns.noDisputes'), description: t('returns.noDisputesHint') }}
        pagination={{ limit: 20, offset, count: query.data?.count ?? 0, onChange: setOffset }}
        columns={[
          {
            key: 'number',
            header: t('returns.number'),
            primary: true,
            cell: (row) => (
              <Link className="font-semibold text-primary" to={`${base}/disputes/${row.id}`}>
                {row.dispute_number}
              </Link>
            ),
          },
          {
            key: 'status',
            header: t('returns.status'),
            cell: (row) => (
              <span className="flex flex-wrap items-center gap-1">
                <StatusBadge kind="disputeStatus" value={row.status} />
                <SlaBadge dispute={row} />
              </span>
            ),
          },
          { key: 'type', header: t('returns.type'), cell: (row) => t(`returns.types.${row.type}`) },
          { key: 'target', header: t('returns.target'), cell: (row) => t(`returns.targets.${row.target_type}`) },
          { key: 'created', header: t('returns.opened'), cell: (row) => formatDateTime(row.created_at) },
        ]}
      />
    </div>
  );
}

/** DSP-024: the same 48h/24h clock the warning job runs on, so the queue shows what the SLA counts. */
function SlaBadge({ dispute }: { dispute: Pick<Dispute, 'status' | 'created_at'> }) {
  const { t } = useTranslation();
  const tone = slaTone(dispute);
  if (!tone) return null;
  return <Badge tone={tone}>{t(tone === 'danger' ? 'returns.slaBreached' : 'returns.slaSoon')}</Badge>;
}

export function DisputePage() {
  const { t } = useTranslation();
  const { disputeId = '' } = useParams();
  const { orgId, company, base, has, membership } = useReturnsAccess();
  const query = useCatalogQuery<DisputeDetail>(`/disputes/${disputeId}`, orgId, has('disputes.view'), 15_000);
  const record = query.data;
  const order = useCatalogQuery<OrderView>(`/orders/${record?.order_id}`, orgId, has('orders.view') && !!record?.order_id);
  const payment = useCatalogQuery<Payment>(`/payments/${record?.payment_id}`, orgId, has('finance.view') && !!record?.payment_id);
  const [action, setAction] = useState<'resolve' | 'reject' | 'withdraw' | null>(null);
  if (!has('disputes.view')) return <ForbiddenState />;
  if (query.isLoading) return <Skeleton className="h-40" />;
  if (!record) return <Feedback error={query.error} />;
  const open = openDisputeStatuses.includes(record.status);
  return (
    <div className="space-y-5">
      <PageHeader
        title={record.dispute_number}
        actions={
          <Button asChild variant="outline">
            <Link to={`${base}/disputes`}>{t('returns.disputes')}</Link>
          </Button>
        }
      />
      <Feedback error={query.error} />
      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="disputeStatus" value={record.status} />
          <SlaBadge dispute={record} />
          <Badge tone="neutral">{t(`returns.types.${record.type}`)}</Badge>
        </div>
        <p className="whitespace-pre-line break-words">{record.description}</p>
        {record.order_id && (
          <p>
            {t('returns.order')}:{' '}
            <Link className="underline" to={`${base}/orders/${record.order_id}`}>
              {order.data?.order_number ?? record.order_id}
            </Link>
          </p>
        )}
        {record.payment_id && payment.data && (
          <p>
            {t('returns.payment')}: {money(payment.data.amount)} TJS · {payment.data.method} · {payment.data.status}
          </p>
        )}
        {record.resolution_type && (
          <Alert tone={record.status === 'REJECTED' ? 'danger' : 'success'}>
            {t(`returns.resolutions.${record.resolution_type}`)}
            {record.resolution_note && ` — ${record.resolution_note}`}
          </Alert>
        )}
        {record.pending_adjustment_id && <Alert tone="warning">{t('returns.pendingAdjustment')}</Alert>}
        {record.return_id && (
          <Link className="underline" to={`${base}/returns/${record.return_id}`}>
            {t('returns.convertedReturn')}
          </Link>
        )}
      </Card>
      {order.data && <OrderContext order={order.data} />}
      {company && record.order_id && <DeliveryContext orderId={record.order_id} />}
      <Chat record={record} />
      <div className="flex flex-wrap gap-2">
        {company && has('disputes.review') && record.status === 'OPEN' && <StartReview record={record} />}
        {company && has('disputes.resolve') && open && <Button onClick={() => setAction('resolve')}>{t('returns.resolve')}</Button>}
        {company && has('disputes.resolve') && open && (
          <Button variant="danger" onClick={() => setAction('reject')}>
            {t('returns.rejectDispute')}
          </Button>
        )}
        {!company && has('disputes.withdraw') && membership.role === 'OWNER' && open && (
          <Button variant="outline" onClick={() => setAction('withdraw')}>
            {t('returns.withdraw')}
          </Button>
        )}
      </div>
      {action === 'resolve' && <ResolveDialog record={record} order={order.data} close={() => setAction(null)} />}
      {action === 'reject' && <RejectDialog record={record} close={() => setAction(null)} />}
      {action === 'withdraw' && <WithdrawDialog record={record} close={() => setAction(null)} />}
    </div>
  );
}

function OrderContext({ order }: { order: OrderView }) {
  const { t } = useTranslation();
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">{t('returns.orderContext')}</h2>
      <DataTable
        rows={order.items}
        rowKey={(row) => row.id}
        density="compact"
        empty={{ title: t('returns.noLines') }}
        columns={[
          { key: 'product', header: t('returns.product'), primary: true, cell: (row) => row.product_name_snapshot },
          { key: 'unit', header: t('returns.unit'), cell: (row) => row.unit_code_snapshot },
          { key: 'confirmed', header: t('returns.confirmedQuantity'), numeric: true, cell: (row) => row.confirmed_quantity ?? '—' },
          {
            key: 'total',
            header: t('returns.lineTotal'),
            numeric: true,
            cell: (row) => ('line_total' in row && typeof row.line_total === 'string' ? money(row.line_total) : '—'),
          },
        ]}
      />
    </Card>
  );
}

/**
 * DSP: how the delivery was confirmed decides most quantity disputes. A manual override with its reason is
 * the single most useful fact on this page, so it is shown rather than left in the delivery module.
 */
function DeliveryContext({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const { orgId, has } = useReturnsAccess();
  const query = useCatalogQuery<Page<Delivery>>(
    `/deliveries?order_id=${orderId}&limit=5&ordering=-created_at`,
    orgId,
    has('delivery.view_all'),
  );
  const rows = query.data?.results ?? [];
  if (!has('delivery.view_all') || rows.length === 0) return null;
  return (
    <Card className="space-y-2 p-4">
      <h2 className="font-semibold">{t('delivery.title')}</h2>
      {rows.map((row) => (
        <div key={row.id} className="space-y-1">
          <p>
            {t('returns.attempt')} {row.attempt_no} · {t(`delivery.statuses.${row.status}`)}
            {row.courier_name && ` · ${row.courier_name}`}
          </p>
          {row.confirmation_method && (
            <p>
              {t('returns.confirmation')}: {t(`returns.confirmations.${row.confirmation_method}`)}
              {row.manual_reason && ` — ${row.manual_reason}`}
            </p>
          )}
          {row.failure_reason_code && (
            <p className="text-danger">
              {t(`delivery.reasons.${row.failure_reason_code}`)}
              {row.failure_note && ` — ${row.failure_note}`}
            </p>
          )}
        </div>
      ))}
    </Card>
  );
}

/** DSP-010: both sides write, messages are immutable, and a system note records what the workflow did. */
function Chat({ record }: { record: DisputeDetail }) {
  const { t } = useTranslation();
  const { orgId, company, has } = useReturnsAccess();
  const cache = useQueryClient();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<AttachmentFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const mutation = useCatalogMutation<DisputeMessage>(`/disputes/${record.id}/messages`, orgId, 'POST', true);
  const mine = company ? 'COMPANY' : 'STORE';
  const writable = has('disputes.message') && openDisputeStatuses.includes(record.status);
  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-semibold">{t('returns.chat')}</h2>
      <ol className="space-y-3">
        {record.messages.map((message) => (
          <li
            key={message.id}
            className={
              message.author_side === 'SYSTEM'
                ? 'rounded-xl bg-subtle p-3'
                : message.author_side === mine
                  ? 'rounded-xl bg-primary/10 p-3 sm:ml-12'
                  : 'rounded-xl bg-subtle p-3 sm:mr-12'
            }
          >
            <p className="text-micro text-muted-foreground">
              {t(`returns.sides.${message.author_side}`)} · <time>{formatDateTime(message.created_at)}</time>
            </p>
            <p className="whitespace-pre-line break-words">{message.body}</p>
            {message.file_id && <Attachment fileId={message.file_id} />}
          </li>
        ))}
        {record.messages.length === 0 && <li className="text-muted-foreground">{t('returns.noMessages')}</li>}
      </ol>
      {writable && (
        <div className="space-y-3">
          <Field label={t('returns.message')}>
            <Textarea value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} />
          </Field>
          <AttachmentsInput files={files} onChange={setFiles} onBusyChange={setUploading} limit={1} />
          <Feedback error={mutation.error} />
          <Button
            disabled={mutation.isPending || uploading || body.trim().length === 0 || files.length > 1}
            onClick={() =>
              mutation.mutate(
                { body, ...(files[0] ? { file_id: files[0].id } : {}) },
                {
                  onSuccess: (data) => {
                    cache.setQueryData<DisputeDetail>(catalogKey(orgId, `/disputes/${record.id}`), (current) =>
                      current ? { ...current, messages: [...current.messages.filter((message) => message.id !== data.id), data] } : current,
                    );
                    setBody('');
                    setFiles([]);
                  },
                },
              )
            }
          >
            {t('returns.send')}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** A dispute photo lives in the private bucket; the signed URL is fetched on demand, never embedded. */
function Attachment({ fileId }: { fileId: string }) {
  const { t } = useTranslation();
  const { orgId } = useReturnsAccess();
  const [open, setOpen] = useState(false);
  const query = useCatalogQuery<{ url: string; expires_at: string }>(`/files/${fileId}/url`, orgId, open);
  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('returns.openAttachment')}
      </Button>
    );
  if (!query.data) return <Skeleton className="h-10" />;
  return (
    <a className="underline" href={query.data.url} target="_blank" rel="noreferrer">
      {t('returns.attachment')}
    </a>
  );
}

function StartReview({ record }: { record: DisputeDetail }) {
  const { t } = useTranslation();
  const { orgId } = useReturnsAccess();
  const cache = useQueryClient();
  const mutation = useCatalogMutation<DisputeDetail>(`/disputes/${record.id}/start-review`, orgId);
  return (
    <>
      <Button
        disabled={mutation.isPending}
        onClick={() =>
          mutation.mutate(undefined, {
            onSuccess: (data) => cache.setQueryData(catalogKey(orgId, `/disputes/${record.id}`), data),
          })
        }
      >
        {t('returns.startReview')}
      </Button>
      <Feedback error={mutation.error} />
    </>
  );
}

/**
 * DSP-021/022 resolution. The three outcomes are one dialog because the choice between them is the decision
 * being made: no action, a credit bounded by the order total, or a return that skips the RET-002 window
 * because the dispute was opened inside it.
 */
function ResolveDialog({ record, order, close }: { record: DisputeDetail; order: OrderView | undefined; close: () => void }) {
  const { t } = useTranslation();
  const { orgId, has } = useReturnsAccess();
  const cache = useQueryClient();
  const [type, setType] = useState<ResolutionType>('NO_ACTION');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [lines, setLines] = useState<Record<string, string>>({});
  const mutation = useCatalogMutation<DisputeDetail>(`/disputes/${record.id}/resolve`, orgId, 'POST', true);
  const balance = useCatalogQuery<Balance>(
    `/finance/partnerships/${record.partnership_id}`,
    orgId,
    has('finance.view') && type === 'ADJUSTMENT_CREDIT',
  );
  const orderTotal = order && 'total' in order ? (order.total ?? '0') : null;
  const items = order?.items ?? [];
  const chosen = items.filter((item) => lines[item.id] && lines[item.id] !== '0');
  const amountValid =
    validAmount(amount) && (record.target_type === 'PAYMENT' || (orderTotal !== null && Number(amount) <= Number(orderTotal)));
  const linesValid =
    chosen.length > 0 &&
    chosen.every((item) => validQuantity(lines[item.id] ?? '', String(item.confirmed_quantity ?? item.requested_quantity)));
  const ready =
    note.trim().length >= 10 &&
    (type === 'NO_ACTION' || (type === 'ADJUSTMENT_CREDIT' && amountValid) || (type === 'CONVERTED_TO_RETURN' && linesValid));
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent>
        <DialogHeader title={t('returns.resolve')} />
        <div className="space-y-3">
          <Field label={t('returns.resolution')}>
            <Select value={type} onChange={(event) => setType(event.target.value as ResolutionType)}>
              {resolutionTypes
                .filter((value) => value !== 'CONVERTED_TO_RETURN' || record.target_type === 'ORDER')
                .map((value) => (
                  <option key={value} value={value}>
                    {t(`returns.resolutions.${value}`)}
                  </option>
                ))}
            </Select>
          </Field>
          {type === 'ADJUSTMENT_CREDIT' && (
            <>
              <Field
                label={orderTotal === null ? t('returns.amount') : `${t('returns.amount')} (${t('returns.max')} ${money(orderTotal)} TJS)`}
              >
                <Input
                  inputMode="decimal"
                  value={amount}
                  invalid={!!amount && !amountValid}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
              {balance.data && amountValid && (
                <Alert tone="info">
                  {t('returns.balanceAfter')}: {adjustmentBalance(balance.data.balance, amount, 'CREDIT')} TJS
                </Alert>
              )}
              <p className="text-muted-foreground">{t('returns.approvalHint')}</p>
            </>
          )}
          {type === 'CONVERTED_TO_RETURN' && (
            <div className="space-y-3">
              <p className="text-muted-foreground">{t('returns.convertHint')}</p>
              {items.map((item) => (
                <Field
                  key={item.id}
                  label={`${item.product_name_snapshot} (${t('returns.max')} ${item.confirmed_quantity ?? item.requested_quantity})`}
                >
                  <Input
                    inputMode="decimal"
                    value={lines[item.id] ?? ''}
                    onChange={(event) => setLines((current) => ({ ...current, [item.id]: event.target.value }))}
                  />
                </Field>
              ))}
            </div>
          )}
          <Field label={t('returns.resolutionNote')}>
            <Textarea value={note} maxLength={5000} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
        <Feedback error={mutation.error} />
        <Button
          className="mt-4"
          disabled={!ready || mutation.isPending}
          onClick={() =>
            mutation.mutate(
              {
                version: record.version,
                resolution_type: type,
                resolution_note: note,
                ...(type === 'ADJUSTMENT_CREDIT' ? { amount } : {}),
                ...(type === 'CONVERTED_TO_RETURN'
                  ? { return_items: chosen.map((item) => ({ order_item_id: item.id, quantity: lines[item.id] })) }
                  : {}),
              },
              {
                onSuccess: (data) => {
                  cache.setQueryData(catalogKey(orgId, `/disputes/${record.id}`), data);
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

function RejectDialog({ record, close }: { record: DisputeDetail; close: () => void }) {
  const { t } = useTranslation();
  const { orgId } = useReturnsAccess();
  const cache = useQueryClient();
  const [note, setNote] = useState('');
  const mutation = useCatalogMutation<DisputeDetail>(`/disputes/${record.id}/reject`, orgId, 'POST', true);
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent>
        <DialogHeader title={t('returns.rejectDispute')} />
        <Field label={t('returns.resolutionNote')}>
          <Textarea value={note} maxLength={5000} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Feedback error={mutation.error} />
        <Button
          className="mt-4"
          variant="danger"
          disabled={mutation.isPending || note.trim().length < 10}
          onClick={() =>
            mutation.mutate(
              { version: record.version, resolution_note: note },
              {
                onSuccess: (data) => {
                  cache.setQueryData(catalogKey(orgId, `/disputes/${record.id}`), data);
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

function WithdrawDialog({ record, close }: { record: DisputeDetail; close: () => void }) {
  const { t } = useTranslation();
  const { orgId } = useReturnsAccess();
  const cache = useQueryClient();
  const mutation = useCatalogMutation<DisputeDetail>(`/disputes/${record.id}/withdraw`, orgId, 'POST', true);
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent>
        <DialogHeader title={t('returns.withdraw')} />
        <p className="my-3">{t('returns.withdrawHint')}</p>
        <Feedback error={mutation.error} />
        <Button
          className="mt-4"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate(
              { version: record.version },
              {
                onSuccess: (data) => {
                  cache.setQueryData(catalogKey(orgId, `/disputes/${record.id}`), data);
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
