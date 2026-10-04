import { useState } from 'react';
import Decimal from 'decimal.js';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/shared/api/errors';
import { formatDateTime } from '@/shared/lib/datetime';
import {
  Alert,
  Button,
  Card,
  DataTable,
  ErrorState,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
} from '@/shared/ui';
import {
  previewPaymentPeriod,
  statuses,
  useBillingMutation,
  useBillingQuery,
  type Page,
  type Plan,
  type PlanRequest,
  type Subscription,
  type SubscriptionDetail,
} from './api';
import { PaymentHistory, SubscriptionSummary } from './subscription-page';

export function AdminSubscriptionsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams({ limit: '20', offset: String(offset) });
  if (status) params.set('status', status);
  if (plan) params.set('plan', plan);
  if (search) params.set('search', search);
  const query = useBillingQuery<Page<Subscription>>(`/admin/subscriptions?${params}`);
  const plans = useBillingQuery<Page<Plan>>('/admin/plans?limit=100');
  return (
    <div className="space-y-6">
      <PageHeader title={t('billing.adminSubscriptions')} />
      <DataTable<Subscription>
        caption={t('billing.adminSubscriptions')}
        rowKey={(row) => row.id}
        rows={query.data?.results}
        loading={query.isPending}
        error={query.isError ? errorMessage(query.error, t) : undefined}
        onRetry={() => void query.refetch()}
        pagination={query.data ? { count: query.data.count, limit: 20, offset, onChange: setOffset } : undefined}
        toolbar={
          <>
            <Input
              aria-label={t('billing.company')}
              placeholder={t('billing.company')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
            <Select
              aria-label={t('billing.statusLabel')}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">{t('billing.allStatuses')}</option>
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {t(`billing.status.${value}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('billing.plan')}
              value={plan}
              onChange={(event) => {
                setPlan(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">{t('billing.allPlans')}</option>
              {plans.data?.results.map((value) => (
                <option key={value.id} value={value.code}>
                  {value.code}
                </option>
              ))}
            </Select>
          </>
        }
        columns={[
          {
            key: 'company',
            header: t('billing.company'),
            primary: true,
            cell: (row) => (
              <Link className="text-primary underline" to={`/admin/subscriptions/${row.id}`}>
                {row.company_name}
              </Link>
            ),
          },
          { key: 'status', header: t('billing.statusLabel'), cell: (row) => <StatusBadge kind="subscription" value={row.status} /> },
          { key: 'plan', header: t('billing.plan'), cell: (row) => row.plan.code },
          {
            key: 'end',
            header: t('billing.current_period_end'),
            cell: (row) => formatDateTime(row.current_period_end ?? row.trial_ends_at) ?? '—',
          },
        ]}
        empty={{ title: t('billing.noSubscriptions') }}
      />
    </div>
  );
}

function ManualPayment({ subscription }: { subscription: SubscriptionDetail }) {
  const { t } = useTranslation();
  const [months, setMonths] = useState(1);
  const expected = new Decimal(subscription.plan.price_monthly).mul(months || 1).toFixed(2);
  const [amount, setAmount] = useState(expected);
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const payment = useBillingMutation<SubscriptionDetail>(`/admin/subscriptions/${subscription.id}/payments`, undefined, true);
  const { start, end } = previewPaymentPeriod(subscription, months);
  const override = new Decimal(amount || 0).eq(expected) === false;
  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-lg font-semibold">{t('billing.recordPayment')}</h2>
      <form
        className="space-y-4"
        onChange={() => setConfirmed(false)}
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmed) {
            setConfirmed(true);
            return;
          }
          payment.mutate(
            { months, amount, method, reference: reference || null, override_amount_reason: override ? reason : null },
            { onSuccess: () => setConfirmed(false) },
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('billing.months')}>
            <Input
              type="number"
              min={1}
              max={12}
              required
              value={months}
              onChange={(event) => {
                const next = Number(event.target.value);
                setMonths(next);
                setAmount(new Decimal(subscription.plan.price_monthly).mul(next).toFixed(2));
              }}
            />
          </FormField>
          <FormField label={`${t('billing.amount')} (TJS)`}>
            <Input type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} />
          </FormField>
          <FormField label={t('billing.method')}>
            <Select value={method} onChange={(event) => setMethod(event.target.value)}>
              {['CASH', 'BANK_TRANSFER'].map((value) => (
                <option key={value} value={value}>
                  {t(`billing.methods.${value}`)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('billing.reference')}>
            <Input maxLength={100} value={reference} onChange={(event) => setReference(event.target.value)} />
          </FormField>
        </div>
        {override ? (
          <FormField label={t('billing.overrideReason')}>
            <Textarea required minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
          </FormField>
        ) : null}
        <Alert>
          {t('billing.expected')}: {expected} TJS
          <br />
          {t('billing.period')}: {formatDateTime(start.toISOString())} → {formatDateTime(end.toISOString())}
          <br />
          {t('billing.previewNote')}
        </Alert>
        {confirmed ? <Alert tone="warning">{t('billing.confirmPayment', { amount })}</Alert> : null}
        {payment.isError ? <Alert tone="danger">{errorMessage(payment.error, t)}</Alert> : null}
        {payment.isSuccess ? <Alert tone="success">{t('billing.paymentSaved')}</Alert> : null}
        <Button disabled={payment.isPending}>{confirmed ? t('billing.confirm') : t('billing.preview')}</Button>
      </form>
    </Card>
  );
}

export function AdminSubscriptionDetailPage() {
  const { t } = useTranslation();
  const { subscriptionId = '' } = useParams();
  const query = useBillingQuery<SubscriptionDetail>(`/admin/subscriptions/${subscriptionId}`);
  const plans = useBillingQuery<Page<Plan>>('/admin/plans?limit=100');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState(1);
  const change = useBillingMutation(`/admin/subscriptions/${subscriptionId}/change-plan`);
  const extend = useBillingMutation(`/admin/subscriptions/${subscriptionId}/extend-trial`);
  if (query.isPending) return <Skeleton className="h-48" />;
  if (!query.data) return <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />;
  const sub = query.data;
  return (
    <div className="space-y-6">
      <PageHeader title={sub.company_name} />
      <SubscriptionSummary subscription={sub} />
      <ManualPayment subscription={sub} />
      <Card className="space-y-4 p-5">
        <FormField label={t('billing.reason')}>
          <Textarea minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </FormField>
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            change.mutate({ plan_code: code, reason });
          }}
        >
          <Select aria-label={t('billing.plan')} required value={code} onChange={(event) => setCode(event.target.value)}>
            <option value="">{t('billing.choosePlan')}</option>
            {plans.data?.results.map((plan) => (
              <option key={plan.id} value={plan.code}>
                {plan.code}
              </option>
            ))}
          </Select>
          <Button disabled={!code || reason.trim().length < 10 || change.isPending}>{t('billing.changePlan')}</Button>
        </form>
        {sub.status === 'TRIAL' ? (
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              extend.mutate({ days, reason });
            }}
          >
            <Input
              type="number"
              min={1}
              max={30}
              aria-label={t('billing.days')}
              required
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
            <Button disabled={reason.trim().length < 10 || extend.isPending}>{t('billing.extendTrial')}</Button>
          </form>
        ) : null}
        {change.isError || extend.isError ? <Alert tone="danger">{errorMessage(change.error ?? extend.error, t)}</Alert> : null}
        {change.isSuccess || extend.isSuccess ? <Alert tone="success">{t('billing.saved')}</Alert> : null}
      </Card>
      <PaymentHistory rows={sub.payments} />
      <DataTable
        caption={t('billing.history')}
        empty={{ title: t('billing.history') }}
        rowKey={(row) => row.id}
        rows={sub.history}
        columns={[
          {
            key: 'status',
            header: t('billing.statusLabel'),
            primary: true,
            cell: (row) => <StatusBadge kind="subscription" value={row.to_status} />,
          },
          { key: 'date', header: t('billing.date'), cell: (row) => formatDateTime(row.created_at) },
          { key: 'reason', header: t('billing.reason'), cell: (row) => row.reason },
        ]}
      />
    </div>
  );
}

function PlanForm({ seed, onDone }: { seed?: Plan; onDone: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState(seed?.code ?? '');
  const [names, setNames] = useState(seed?.name ?? { tg: '', ru: '', en: '' });
  const [price, setPrice] = useState(String(seed?.price_monthly ?? '0.00'));
  const [limits, setLimits] = useState({
    active_stores: String(seed?.max_active_stores ?? ''),
    users: String(seed?.max_users ?? ''),
    products: String(seed?.max_products ?? ''),
  });
  const [isPublic, setIsPublic] = useState(seed?.is_public ?? true);
  const [sort, setSort] = useState(seed?.sort_order ?? 0);
  const save = useBillingMutation<Plan>(seed ? `/admin/plans/${seed.id}` : '/admin/plans', undefined, false, seed ? 'PATCH' : 'POST');
  return (
    <Card className="space-y-4 p-5">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(
            {
              code,
              name: names,
              price_monthly: price,
              currency: 'TJS',
              is_public: isPublic,
              sort_order: sort,
              max_active_stores: limits.active_stores ? Number(limits.active_stores) : null,
              max_users: limits.users ? Number(limits.users) : null,
              max_products: limits.products ? Number(limits.products) : null,
              ...(seed ? { version: seed.version } : {}),
            },
            { onSuccess: onDone },
          );
        }}
      >
        <FormField label={t('billing.planCode')}>
          <Input
            required
            maxLength={16}
            pattern="[A-Z][A-Z0-9_]{0,15}"
            disabled={!!seed}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          {['tg', 'ru', 'en'].map((language) => (
            <FormField key={language} label={`${t('billing.planName')} (${language})`}>
              <Input
                required
                maxLength={100}
                value={names[language] ?? ''}
                onChange={(event) => setNames({ ...names, [language]: event.target.value })}
              />
            </FormField>
          ))}
        </div>
        <FormField label={`${t('billing.price')} (TJS)`}>
          <Input type="number" min={0} step="0.01" required value={price} onChange={(event) => setPrice(event.target.value)} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          {(['active_stores', 'users', 'products'] as const).map((kind) => (
            <FormField key={kind} label={t(`billing.usage.${kind}`)} hint={t('billing.emptyUnlimited')}>
              <Input
                type="number"
                min={1}
                value={limits[kind]}
                onChange={(event) => setLimits({ ...limits, [kind]: event.target.value })}
              />
            </FormField>
          ))}
        </div>
        <FormField label={t('billing.sortOrder')}>
          <Input type="number" min={-32768} max={32767} value={sort} onChange={(event) => setSort(Number(event.target.value))} />
        </FormField>
        <label className="flex gap-3">
          <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
          {t('billing.publicPlan')}
        </label>
        {save.isError ? <Alert tone="danger">{errorMessage(save.error, t)}</Alert> : null}
        <div className="flex gap-3">
          <Button disabled={save.isPending}>{t('billing.save')}</Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            {t('billing.close')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function AdminPlansPage() {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const query = useBillingQuery<Page<Plan>>(`/admin/plans?limit=20&offset=${offset}`);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader title={t('billing.adminPlans')} actions={<Button onClick={() => setEditing('new')}>{t('billing.addPlan')}</Button>} />
      {editing ? (
        <PlanForm
          key={editing === 'new' ? 'new' : editing.id}
          seed={editing === 'new' ? undefined : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      <DataTable<Plan>
        caption={t('billing.adminPlans')}
        empty={{ title: t('billing.adminPlans') }}
        rowKey={(row) => row.id}
        rows={query.data?.results}
        loading={query.isPending}
        error={query.isError ? errorMessage(query.error, t) : undefined}
        onRetry={() => void query.refetch()}
        pagination={query.data ? { count: query.data.count, limit: 20, offset, onChange: setOffset } : undefined}
        columns={[
          { key: 'code', header: t('billing.planCode'), primary: true, cell: (row) => row.code },
          { key: 'price', header: t('billing.price'), cell: (row) => `${row.price_monthly} TJS` },
          { key: 'public', header: t('billing.publicPlan'), cell: (row) => (row.is_public ? t('billing.yes') : t('billing.no')) },
          {
            key: 'edit',
            header: t('billing.edit'),
            cell: (row) => (
              <Button variant="secondary" onClick={() => setEditing(row)}>
                {t('billing.edit')}
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}

function RequestAction({ request, onDone }: { request: PlanRequest; onDone: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('DONE');
  const mutation = useBillingMutation(`/admin/plan-requests/${request.id}/handle`);
  return (
    <Card className="space-y-4 p-5">
      <h2>
        {request.company_name} → {request.plan_code}
      </h2>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate({ status, reason }, { onSuccess: onDone });
        }}
      >
        <FormField label={t('billing.decision')}>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="DONE">{t('billing.approveRequest')}</option>
            <option value="DISMISSED">{t('billing.dismissRequest')}</option>
          </Select>
        </FormField>
        <FormField label={t('billing.reason')}>
          <Textarea required minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </FormField>
        {mutation.isError ? <Alert tone="danger">{errorMessage(mutation.error, t)}</Alert> : null}
        <Button disabled={mutation.isPending}>{t('billing.confirm')}</Button>
      </form>
    </Card>
  );
}

export function AdminPlanRequestsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('PENDING');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<PlanRequest | null>(null);
  const query = useBillingQuery<Page<PlanRequest>>(`/admin/plan-requests?limit=20&offset=${offset}${status ? `&status=${status}` : ''}`);
  return (
    <div className="space-y-6">
      <PageHeader title={t('billing.adminRequests')} />
      {selected ? <RequestAction key={selected.id} request={selected} onDone={() => setSelected(null)} /> : null}
      <DataTable<PlanRequest>
        caption={t('billing.adminRequests')}
        empty={{ title: t('billing.adminRequests') }}
        rowKey={(row) => row.id}
        rows={query.data?.results}
        loading={query.isPending}
        error={query.isError ? errorMessage(query.error, t) : undefined}
        onRetry={() => void query.refetch()}
        pagination={query.data ? { count: query.data.count, limit: 20, offset, onChange: setOffset } : undefined}
        toolbar={
          <Select
            aria-label={t('billing.statusLabel')}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">{t('billing.allStatuses')}</option>
            {['PENDING', 'DONE', 'DISMISSED'].map((value) => (
              <option key={value} value={value}>
                {t(`billing.requestStatus.${value}`)}
              </option>
            ))}
          </Select>
        }
        columns={[
          { key: 'company', header: t('billing.company'), primary: true, cell: (row) => row.company_name },
          { key: 'plan', header: t('billing.plan'), cell: (row) => row.plan_code },
          { key: 'status', header: t('billing.statusLabel'), cell: (row) => t(`billing.requestStatus.${row.status}`) },
          {
            key: 'action',
            header: t('billing.decision'),
            cell: (row) =>
              row.status === 'PENDING' ? (
                <Button variant="secondary" onClick={() => setSelected(row)}>
                  {t('billing.review')}
                </Button>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </div>
  );
}
