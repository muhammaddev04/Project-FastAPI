import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { useCatalogMutation, useCatalogQuery, type Page } from '@/features/catalog/api';
import { Feedback, Field } from '@/features/catalog/shared';
import { useBillingQuery, type Access } from '@/features/subscriptions/api';
import type { Partnership } from '@/features/partnerships/api';
import { apiRequest } from '@/shared/api/client';
import { formatDateTime } from '@/shared/lib/datetime';
import {
  Alert,
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
} from '@/shared/ui';
import { early, money, reserved, statuses, totals, type Cart, type Order, type OrderView, type Preview, type Status } from './api';

function useAccess() {
  const { membership, me } = useAreaContext();
  const company = membership.org_type === 'COMPANY';
  const orgId = membership.organization_id;
  const billing = useBillingQuery<Access>('/subscription/access', company ? orgId : null);
  return {
    membership,
    userId: me.id,
    orgId,
    company,
    warehouse: membership.role === 'WAREHOUSE',
    base: company ? '/company/orders' : '/store/orders',
    has: (permission: string) => membership.permissions.includes(permission),
    fulfillment: !!billing.data?.allowed_actions.includes('ORDER_FULFILLMENT'),
    newOrder: !company || !!billing.data?.allowed_actions.includes('NEW_ORDER'),
  };
}

const companyTabs: { key: string; statuses: Status[] }[] = [
  { key: 'new', statuses: ['NEW', 'VIEWED'] },
  { key: 'confirmed', statuses: ['CONFIRMED', 'PARTIALLY_CONFIRMED'] },
  { key: 'warehouse', statuses: ['ASSEMBLING', 'READY_FOR_DELIVERY'] },
  { key: 'transit', statuses: ['IN_TRANSIT', 'DELIVERY_FAILED'] },
  { key: 'delivered', statuses: ['DELIVERED', 'DISPUTED'] },
  { key: 'completed', statuses: ['COMPLETED'] },
  { key: 'cancelled', statuses: ['CANCELLED', 'REJECTED'] },
];

export function OrdersPage({ warehouse = false }: { warehouse?: boolean }) {
  const { t } = useTranslation();
  const { orgId, company, has, base, newOrder } = useAccess();
  const [tab, setTab] = useState(warehouse ? 'confirmed' : 'all');
  const [search, setSearch] = useState('');
  const [partner, setPartner] = useState('');
  const [source, setSource] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [ordering, setOrdering] = useState('-created_at');
  const tabs = company
    ? companyTabs
    : [
        { key: 'active', statuses: statuses.filter((status) => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(status)) },
        { key: 'completed', statuses: ['COMPLETED'] },
        { key: 'cancelled', statuses: ['CANCELLED', 'REJECTED'] },
      ];
  const params = new URLSearchParams({ limit: '20', offset: String(offset), search, ordering });
  const selectedStatuses = tabs.find((row) => row.key === tab)?.statuses ?? [];
  selectedStatuses.forEach((status) => params.append('status', status));
  if (partner) params.set('partnership_id', partner);
  if (source) params.set('source', source);
  if (dateFrom) params.set('date_from', new Date(`${dateFrom}T00:00:00`).toISOString());
  if (dateTo) params.set('date_to', new Date(`${dateTo}T23:59:59.999`).toISOString());
  const query = useCatalogQuery<Page<OrderView>>(`/orders?${params}`, orgId, has('orders.view'), 30_000);
  const partners = useCatalogQuery<Page<Partnership>>('/partnerships?limit=100', orgId, has('partners.view'));
  const pending = useCatalogQuery<Page<OrderView>>(
    '/orders?status=NEW&status=VIEWED&limit=1',
    orgId,
    company && has('orders.confirm'),
    30_000,
  );
  if (!has('orders.view')) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t(warehouse ? 'orders.warehouseOrders' : 'orders.title')}
        actions={
          company && has('orders.create') && newOrder ? (
            <Button asChild>
              <Link to="/company/orders/new">{t('orders.onBehalf')}</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('orders.status')}>
        <Button
          variant={tab === 'all' ? 'primary' : 'outline'}
          onClick={() => {
            setTab('all');
            setOffset(0);
          }}
        >
          {t('orders.all')}
        </Button>
        {tabs.map((row) => (
          <Button
            key={row.key}
            variant={tab === row.key ? 'primary' : 'outline'}
            onClick={() => {
              setTab(row.key);
              setOffset(0);
            }}
          >
            {t(`orders.tabs.${row.key}`)}
            {row.key === 'new' && pending.data?.count ? ` (${pending.data.count})` : ''}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input
          aria-label={t('orders.searchOrders')}
          placeholder={t('orders.searchOrders')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        {has('partners.view') && (
          <Select
            aria-label={t('orders.partnerFilter')}
            value={partner}
            onChange={(e) => {
              setPartner(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">{t('orders.allPartners')}</option>
            {partners.data?.results.map((row) => (
              <option key={row.id} value={row.id}>
                {row.partner?.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label={t('orders.source')}
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('orders.allSources')}</option>
          <option value="STORE">{t('orders.sources.STORE')}</option>
          <option value="COMPANY_ON_BEHALF">{t('orders.sources.COMPANY_ON_BEHALF')}</option>
        </Select>
        <Field label={t('orders.dateFrom')}>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
        <Field label={t('orders.dateTo')}>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
        <Select
          aria-label={t('orders.ordering')}
          value={ordering}
          onChange={(e) => {
            setOrdering(e.target.value);
            setOffset(0);
          }}
        >
          <option value="-created_at">{t('orders.newest')}</option>
          <option value="created_at">{t('orders.oldest')}</option>
          {!warehouse && (
            <>
              <option value="-total">{t('orders.highestTotal')}</option>
              <option value="total">{t('orders.lowestTotal')}</option>
            </>
          )}
        </Select>
      </div>
      <Feedback error={query.error} />
      <DataTable
        rows={query.data?.results ?? []}
        rowKey={(row) => row.id}
        loading={query.isLoading}
        empty={{ title: t('orders.emptyOrders') }}
        pagination={{ limit: 20, offset, count: query.data?.count ?? 0, onChange: setOffset }}
        columns={[
          {
            key: 'number',
            header: t('orders.number'),
            primary: true,
            cell: (row) => (
              <Link className="font-semibold text-primary" to={`${base}/${row.id}`}>
                {row.order_number}
              </Link>
            ),
          },
          { key: 'partner', header: t('orders.partner'), cell: (row) => row.partner_name },
          { key: 'status', header: t('orders.status'), cell: (row) => t(`orders.statuses.${row.status}`) },
          { key: 'created', header: t('orders.created'), cell: (row) => formatDateTime(row.created_at) },
          ...(!warehouse
            ? [
                {
                  key: 'total',
                  header: t('orders.total'),
                  cell: (row: OrderView) => ('total' in row ? `${money(row.total ?? row.requested_subtotal)} TJS` : '—'),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

export function OrderPage() {
  const { t } = useTranslation();
  const { orderId = '' } = useParams();
  const access = useAccess();
  const { orgId, company, has, base, fulfillment, warehouse, membership } = access;
  const query = useCatalogQuery<OrderView>(`/orders/${orderId}`, orgId, has('orders.view'), 30_000);
  const viewed = useCatalogMutation<OrderView>(`/orders/${orderId}/mark-viewed`, orgId);
  const marked = useRef('');
  useEffect(() => {
    if (company && query.data?.status === 'NEW' && marked.current !== `${orgId}:${orderId}`) {
      marked.current = `${orgId}:${orderId}`;
      viewed.mutate(undefined);
    }
  }, [company, orgId, orderId, query.data?.status, viewed]);
  const [action, setAction] = useState<string | null>(null);
  const [printError, setPrintError] = useState<unknown>();
  const repeat = useCatalogMutation<Cart>(`/store/orders/${orderId}/repeat`, orgId);
  const [repeated, setRepeated] = useState<Cart | null>(null);
  if (!has('orders.view')) return <ForbiddenState />;
  if (query.isLoading) return <Skeleton className="h-40" />;
  const order = query.data;
  if (!order) return <Feedback error={query.error} />;
  const priced = 'total' in order;
  const cancelAllowed =
    has('orders.cancel') &&
    (company
      ? [...early, ...reserved].includes(order.status)
      : early.includes(order.status) && (membership.role === 'OWNER' || order.created_by === access.userId));
  return (
    <div className="space-y-5">
      <PageHeader
        title={order.order_number}
        actions={
          <Button asChild variant="outline">
            <Link to={base}>{t('orders.title')}</Link>
          </Button>
        }
      />
      <Feedback error={query.error || viewed.error || printError} />
      <Card className="space-y-2 p-4">
        <h2 className="font-semibold">{order.partner_name}</h2>
        <p>
          {t('orders.status')}: {t(`orders.statuses.${order.status}`)}
        </p>
        <p>
          {t('orders.address')}: {order.delivery_address}
        </p>
        {order.store_note && (
          <p>
            {t('orders.note')}: {order.store_note}
          </p>
        )}
        {order.company_note && (
          <p>
            {t('orders.companyNote')}: {order.company_note}
          </p>
        )}
      </Card>
      <DataTable
        rows={order.items}
        rowKey={(row) => row.id}
        empty={{ title: t('orders.noProducts') }}
        columns={[
          {
            key: 'product',
            header: t('orders.product'),
            primary: true,
            cell: (row) => `${row.product_name_snapshot} · ${row.sku_snapshot}`,
          },
          { key: 'unit', header: t('orders.unit'), cell: (row) => row.unit_code_snapshot },
          { key: 'requested', header: t('orders.requested'), cell: (row) => row.requested_quantity },
          {
            key: 'confirmed',
            header: t('orders.confirmed'),
            cell: (row) => <span className="text-success">{row.confirmed_quantity ?? '—'}</span>,
          },
          { key: 'rejected', header: t('orders.rejected'), cell: (row) => <span className="text-danger">{row.rejected_quantity}</span> },
          ...(priced && !warehouse
            ? [
                {
                  key: 'price',
                  header: t('orders.price'),
                  cell: (row: OrderView['items'][number]) => ('unit_price' in row ? money(row.unit_price) : '—'),
                },
                {
                  key: 'total',
                  header: t('orders.total'),
                  cell: (row: OrderView['items'][number]) => ('line_total' in row ? money(row.line_total) : '—'),
                },
              ]
            : []),
        ]}
      />
      {priced && (
        <Card className="space-y-2 p-4">
          <p>
            {t('orders.subtotal')}: {money(order.subtotal ?? order.requested_subtotal)} TJS
          </p>
          <p>
            {t('orders.discount')}: {money(order.discount)} TJS
          </p>
          <p>
            {t('orders.deliveryFee')}: {money(order.delivery_fee)} TJS
          </p>
          <p className="font-semibold">
            {t('orders.total')}: {money(order.total ?? order.requested_subtotal)} TJS
          </p>
          {company && order.terms_snapshot && (
            <details>
              <summary>{t('orders.termsSnapshot')}</summary>
              <dl className="grid gap-2 sm:grid-cols-2">
                {[
                  'credit_limit',
                  'credit_days',
                  'minimum_order_amount',
                  'delivery_fee',
                  'free_delivery_threshold',
                  'return_days',
                  'dispute_window_hours',
                  'effective_from',
                ].map((key) => (
                  <div key={key}>
                    <dt>{t(`partnerships.fields.${key}`)}</dt>
                    <dd>{String(order.terms_snapshot?.[key] ?? '—')}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </Card>
      )}
      {company && priced && has('orders.confirm') && early.includes(order.status) && (
        <ConfirmationPanel
          key={`${order.id}:${order.version}`}
          order={order}
          orgId={orgId}
          fulfillment={fulfillment}
          canDiscount={has('orders.discount')}
          canOverride={has('orders.override')}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {company && has('orders.reject') && early.includes(order.status) && (
          <Button variant="danger" onClick={() => setAction('reject')}>
            {t('orders.reject')}
          </Button>
        )}
        {cancelAllowed && (
          <Button variant="outline" onClick={() => setAction('cancel')}>
            {t('orders.cancel')}
          </Button>
        )}
        {company && has('orders.assemble') && fulfillment && ['CONFIRMED', 'PARTIALLY_CONFIRMED'].includes(order.status) && (
          <Button onClick={() => setAction('start-assembling')}>{t('orders.assemble')}</Button>
        )}
        {company && has('orders.assemble') && fulfillment && order.status === 'ASSEMBLING' && (
          <Button onClick={() => setAction('mark-ready')}>{t('orders.ready')}</Button>
        )}
        {company && has('orders.reattempt') && fulfillment && order.status === 'DELIVERY_FAILED' && (
          <Button onClick={() => setAction('reattempt')}>{t('orders.reattempt')}</Button>
        )}
        {company && has('orders.assemble') && !early.includes(order.status) && !['CANCELLED', 'REJECTED'].includes(order.status) && (
          <Button
            variant="outline"
            onClick={() => {
              const tab = window.open('', '_blank');
              if (!tab) return;
              void apiRequest<string>(`/orders/${order.id}/pick-list`, { headers: { 'X-Org-Id': orgId }, responseType: 'text' })
                .then((html) => {
                  tab.document.open();
                  tab.document.write(html);
                  tab.document.close();
                })
                .catch((error) => {
                  tab.close();
                  setPrintError(error);
                });
            }}
          >
            {t('orders.print')}
          </Button>
        )}
        {!company && has('cart.manage') && (
          <Button variant="outline" disabled={repeat.isPending} onClick={() => repeat.mutate(undefined, { onSuccess: setRepeated })}>
            {t('orders.repeat')}
          </Button>
        )}
      </div>
      <Feedback error={repeat.error} />
      {repeated && (
        <Card className="space-y-2 p-4">
          {repeated.warnings.map((warning, index) => (
            <Alert tone="warning" key={index}>
              {t(`errors.${warning.code}`)}
            </Alert>
          ))}
          <Button asChild>
            <Link to={`/store/cart/${order.partnership_id}`}>{t('orders.openCart')}</Link>
          </Button>
        </Card>
      )}
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t('orders.timeline')}</h2>
        <ol className="space-y-3">
          {order.history.map((row) => (
            <li key={row.id}>
              <span>{t(`orders.statuses.${row.to_status}`)}</span> · <time>{formatDateTime(row.created_at)}</time>
              {row.reason && <p className="break-words text-muted-foreground">{row.reason}</p>}
            </li>
          ))}
        </ol>
      </Card>
      {action && <ActionDialog key={action} order={order} action={action} orgId={orgId} close={() => setAction(null)} />}
    </div>
  );
}

function ActionDialog({ order, action, orgId, close }: { order: OrderView; action: string; orgId: string; close: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const mutation = useCatalogMutation<OrderView>(`/orders/${order.id}/${action}`, orgId, 'POST', true);
  const needsReason = ['cancel', 'reject'].includes(action);
  const label = { 'start-assembling': 'assemble', 'mark-ready': 'ready' }[action] ?? action;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogHeader title={t(`orders.${label}`)} />
        <p className="my-3">{order.order_number}</p>
        {needsReason && (
          <Field label={t('orders.reason')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={5000} />
          </Field>
        )}
        <Feedback error={mutation.error} />
        <Button
          className="mt-4"
          disabled={mutation.isPending || (needsReason && !reason.trim())}
          onClick={() => mutation.mutate({ version: order.version, ...(needsReason ? { reason } : {}) }, { onSuccess: close })}
        >
          {t('common.confirm')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmationPanel({
  order,
  orgId,
  fulfillment,
  canDiscount,
  canOverride,
}: {
  order: Order;
  orgId: string;
  fulfillment: boolean;
  canDiscount: boolean;
  canOverride: boolean;
}) {
  const { t } = useTranslation();
  const query = useCatalogQuery<Preview>(`/orders/${order.id}/confirmation-preview`, orgId);
  const [quantities, setQuantities] = useState<Record<string, string> | null>(null);
  const [discount, setDiscount] = useState('0');
  const [discountReason, setDiscountReason] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [minimumReason, setMinimumReason] = useState('');
  const [note, setNote] = useState('');
  const [review, setReview] = useState(false);
  const mutation = useCatalogMutation<Order>(`/orders/${order.id}/confirm`, orgId, 'POST', true);
  const values = quantities ?? Object.fromEntries(query.data?.lines.map((row) => [row.item_id, row.confirmed_quantity]) ?? []);
  const preview = query.data;
  if (!preview) return query.isLoading ? <Skeleton className="h-32" /> : <Feedback error={query.error} />;
  const sum = totals(order, values, preview, discount);
  const valid =
    order.items.every((row) => {
      const qty = Number(values[row.id]);
      return (
        Number.isFinite(qty) && qty >= 0 && qty <= Number(row.requested_quantity) && (row.allow_fraction_snapshot || Number.isInteger(qty))
      );
    }) &&
    order.items.some((row) => Number(values[row.id]) > 0) &&
    Number(discount) >= 0 &&
    Number(discount) <= sum.subtotal &&
    (Number(discount) === 0 || !!discountReason.trim());
  const minimumExceeded = sum.subtotal < sum.minimum;
  const overrideValid =
    (!sum.creditExceeded || (canOverride && !!creditReason.trim())) && (!minimumExceeded || (canOverride && !!minimumReason.trim()));
  const confirmBody = {
    version: order.version,
    lines: order.items.map((row) => ({ item_id: row.id, confirmed_quantity: values[row.id] })),
    discount: discount || '0',
    discount_reason: Number(discount) ? discountReason : null,
    override_credit_reason: sum.creditExceeded && canOverride ? creditReason || null : null,
    override_minimum_reason: minimumExceeded && canOverride ? minimumReason || null : null,
    company_note: note || null,
  };
  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-semibold">{t('orders.confirmation')}</h2>
      <div className="space-y-3">
        {order.items.map((row) => (
          <div key={row.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
            <p>
              {row.product_name_snapshot} · {row.unit_code_snapshot}
              <br />
              {t('orders.available')}: {preview.lines.find((line) => line.item_id === row.id)?.available}
            </p>
            <Field label={`${t('orders.confirmedQuantity')} · ${row.product_name_snapshot}`}>
              <Input
                type="number"
                min="0"
                max={Number(row.requested_quantity)}
                step={row.allow_fraction_snapshot ? '0.001' : '1'}
                value={values[row.id] ?? '0'}
                onChange={(e) => setQuantities({ ...values, [row.id]: e.target.value })}
              />
            </Field>
          </div>
        ))}
      </div>
      <div className={sum.creditExceeded ? 'rounded-lg border border-danger p-3 text-danger' : 'rounded-lg border p-3'}>
        <p>
          {t('orders.creditLimit')}: {money(preview.credit.limit)}
        </p>
        <p>
          {t('orders.outstanding')}: {money(preview.credit.outstanding)}
        </p>
        <p>
          {t('orders.afterOrder')}: {money(Number(preview.credit.outstanding) - Number(preview.credit.unapplied) + sum.total)}
        </p>
      </div>
      {canDiscount && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('orders.discount')}>
            <Input type="number" min="0" max={sum.subtotal} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <Field label={t('orders.discountReason')}>
            <Input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} maxLength={5000} />
          </Field>
        </div>
      )}
      <Field label={t('orders.companyNote')}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
      </Field>
      <div className="grid gap-2 sm:grid-cols-3">
        <p>
          {t('orders.subtotal')}: {money(sum.subtotal)}
        </p>
        <p>
          {t('orders.deliveryFee')}: {money(sum.deliveryFee)}
        </p>
        <p className="font-semibold">
          {t('orders.total')}: {money(sum.total)} TJS
        </p>
      </div>
      <Button disabled={!valid || !fulfillment} onClick={() => setReview(true)}>
        {t('orders.reviewConfirmation')}
      </Button>
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent>
          <DialogHeader title={t('orders.reviewConfirmation')} />
          <div className="my-4 space-y-2">
            {order.items.map((row) => (
              <p key={row.id}>
                {row.product_name_snapshot}: {row.requested_quantity} → <span className="text-success">{values[row.id]}</span>{' '}
                <span className="text-danger">
                  ({t('orders.rejected')}: {Number(row.requested_quantity) - Number(values[row.id])})
                </span>
              </p>
            ))}
            <p>
              {t('orders.total')}: {money(sum.total)} TJS
            </p>
            {minimumExceeded && (
              <>
                <Alert tone="warning">
                  {t('orders.minimumWarning')} {money(sum.minimum)}
                </Alert>
                {canOverride && (
                  <Field label={t('orders.minimumOverride')}>
                    <Input value={minimumReason} onChange={(e) => setMinimumReason(e.target.value)} maxLength={5000} />
                  </Field>
                )}
              </>
            )}
            {sum.creditExceeded && (
              <>
                <Alert tone="danger">{t('orders.creditWarning')}</Alert>
                {canOverride && (
                  <Field label={t('orders.creditOverride')}>
                    <Input value={creditReason} onChange={(e) => setCreditReason(e.target.value)} maxLength={5000} />
                  </Field>
                )}
              </>
            )}
          </div>
          <Feedback error={mutation.error} />
          <Button
            disabled={!valid || !overrideValid || mutation.isPending || !fulfillment}
            onClick={() => mutation.mutate(confirmBody, { onSuccess: () => setReview(false) })}
          >
            {t('orders.confirm')}
          </Button>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
