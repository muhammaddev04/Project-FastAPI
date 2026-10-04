import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { SettingsTabs } from '@/features/organization/settings-tabs';
import { errorMessage } from '@/shared/api/errors';
import { formatDateTime } from '@/shared/lib/datetime';
import { Alert, Button, Card, DataTable, ErrorState, ForbiddenState, PageHeader, Select, Skeleton, StatusBadge } from '@/shared/ui';
import { useBillingMutation, useBillingQuery, type Access, type Page, type Payment, type Plan, type Subscription } from './api';

export function SubscriptionBanner({ orgId, canView }: { orgId: string; canView: boolean }) {
  const { t } = useTranslation();
  const query = useBillingQuery<Access>('/subscription/access', orgId);
  const status = query.data?.status;
  if (!status || !['GRACE', 'SOFT_BLOCK', 'FULL_BLOCK', 'CANCELLED'].includes(status)) return null;
  return (
    <Alert
      tone={status === 'GRACE' || status === 'SOFT_BLOCK' ? 'warning' : 'danger'}
      className={status === 'SOFT_BLOCK' ? 'border-orange-500/40 bg-orange-500/10' : undefined}
      title={t(`billing.status.${status}`)}
      action={
        canView ? (
          <Button asChild variant="link">
            <Link to="/company/settings/subscription">{t('billing.title')}</Link>
          </Button>
        ) : undefined
      }
    >
      {t(`billing.banner.${status}`)}
    </Alert>
  );
}

export function SubscriptionSummary({ subscription }: { subscription: Subscription }) {
  const { t, i18n } = useTranslation();
  const sub = subscription;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{sub.plan.name[i18n.language] ?? sub.plan.code}</h2>
        <StatusBadge kind="subscription" value={sub.status} />
      </div>
      <p>
        {sub.plan.price_monthly} TJS / {t('billing.month')}
      </p>
      {(['trial_ends_at', 'current_period_end', 'grace_ends_at', 'soft_block_ends_at'] as const).map((field) =>
        sub[field] ? (
          <p key={field}>
            {t(`billing.${field}`)}: {formatDateTime(sub[field])}
          </p>
        ) : null,
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {(['active_stores', 'users', 'products'] as const).map((kind) => {
          const maximum = sub.limits[kind];
          const current = sub.usage[kind] ?? 0;
          return (
            <div key={kind} className="space-y-2">
              <p>
                {t(`billing.usage.${kind}`)}: {current} / {maximum ?? t('billing.unlimited')}
              </p>
              {maximum != null ? (
                <progress
                  className="h-2 w-full accent-primary"
                  aria-label={t(`billing.usage.${kind}`)}
                  max={maximum}
                  value={Math.min(current, maximum)}
                />
              ) : null}
              {maximum != null && current > maximum ? <p className="text-sm text-danger">{t('billing.overLimit')}</p> : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function PaymentHistory({
  rows,
  count,
  offset,
  onPage,
}: {
  rows?: Payment[];
  count?: number;
  offset?: number;
  onPage?: (offset: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <DataTable<Payment>
      caption={t('billing.payments')}
      rowKey={(row) => row.id}
      rows={rows}
      pagination={onPage && count !== undefined ? { count, offset: offset ?? 0, limit: 20, onChange: onPage } : undefined}
      columns={[
        { key: 'amount', header: t('billing.amount'), cell: (row) => `${row.amount} ${row.currency}`, primary: true },
        { key: 'method', header: t('billing.method'), cell: (row) => t(`billing.methods.${row.method}`) },
        {
          key: 'period',
          header: t('billing.period'),
          cell: (row) => `${formatDateTime(row.period_start)} → ${formatDateTime(row.period_end)}`,
        },
        { key: 'reference', header: t('billing.reference'), cell: (row) => row.reference ?? '—' },
      ]}
      empty={{ title: t('billing.noPayments') }}
    />
  );
}

export function SubscriptionPage() {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  const orgId = membership.organization_id;
  const canView = membership.permissions.includes('subscription.view');
  const canManage = membership.permissions.includes('subscription.manage');
  const sub = useBillingQuery<Subscription>('/subscription', canView ? orgId : null);
  const [offset, setOffset] = useState(0);
  const payments = useBillingQuery<Page<Payment>>(`/subscription/payments?limit=20&offset=${offset}`, canView ? orgId : null);
  const plans = useBillingQuery<Page<Plan>>('/plans?limit=100', canView ? undefined : null);
  const cancel = useBillingMutation<Subscription>('/subscription/cancel-at-period-end', orgId);
  const [pendingCancel, setPendingCancel] = useState<{ orgId: string; value: boolean } | null>(null);
  const request = useBillingMutation('/subscription/plan-requests', orgId, true);
  const [planCode, setPlanCode] = useState('');
  if (!canView) return <ForbiddenState />;
  if (sub.isPending) return <Skeleton className="h-48" />;
  if (!sub.data) return <ErrorState message={errorMessage(sub.error, t)} onRetry={() => void sub.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title={t('billing.title')} />
      <SettingsTabs />
      <SubscriptionSummary subscription={sub.data} />
      {canManage ? (
        <Card className="space-y-4 p-5">
          <label className="flex gap-3">
            <input
              type="checkbox"
              checked={pendingCancel?.orgId === orgId ? pendingCancel.value : sub.data.cancel_at_period_end}
              disabled={cancel.isPending || membership.org_status !== 'ACTIVE'}
              onChange={(event) => {
                const value = event.target.checked;
                setPendingCancel({ orgId, value });
                cancel.mutate({ value }, { onSettled: () => setPendingCancel((current) => (current?.orgId === orgId ? null : current)) });
              }}
            />
            {t('billing.cancel')}
          </label>
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              request.mutate({ plan_code: planCode });
            }}
          >
            <Select aria-label={t('billing.plan')} required value={planCode} onChange={(event) => setPlanCode(event.target.value)}>
              <option value="">{t('billing.choosePlan')}</option>
              {plans.data?.results.map((plan) => (
                <option key={plan.id} value={plan.code}>
                  {plan.code} — {plan.price_monthly} TJS
                </option>
              ))}
            </Select>
            <Button disabled={request.isPending || !planCode || membership.org_status !== 'ACTIVE'}>{t('billing.requestPlan')}</Button>
          </form>
          {request.isSuccess ? <Alert tone="success">{t('billing.requestSent')}</Alert> : null}
          {cancel.isError || request.isError ? <Alert tone="danger">{errorMessage(cancel.error ?? request.error, t)}</Alert> : null}
        </Card>
      ) : null}
      {payments.isError ? (
        <ErrorState message={errorMessage(payments.error, t)} onRetry={() => void payments.refetch()} />
      ) : (
        <PaymentHistory rows={payments.data?.results} count={payments.data?.count} offset={offset} onPage={setOffset} />
      )}
    </div>
  );
}
