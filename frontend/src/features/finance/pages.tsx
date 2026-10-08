import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { useCatalogQuery, useCatalogMutation, type Page } from '@/features/catalog/api';
import { Feedback, Field } from '@/features/catalog/shared';
import type { Partnership } from '@/features/partnerships/api';
import { Button, Card, Dialog, DialogContent, DialogHeader, ForbiddenState, Input, PageHeader, Select, Skeleton } from '@/shared/ui';
import type { components } from '@/shared/api/schema';
import {
  adjustmentBalance,
  dushanbeToday,
  limitWarning,
  validAmount,
  type Adjustment,
  type Balance,
  type Charge,
  type PartnerBalance,
  type Payment,
  type Preview,
  type Statement,
  type Summary,
} from './api';

function useFinanceAccess() {
  const { membership, me } = useAreaContext();
  const company = membership.org_type === 'COMPANY';
  return {
    membership,
    me,
    company,
    orgId: membership.organization_id,
    allowed: membership.permissions.includes('finance.view'),
    base: company ? '/company/finance' : '/store/finance',
    can: (permission: string) => membership.permissions.includes(permission),
  };
}
function MoneyCards({ value }: { value: Summary | Balance }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {(['balance', 'overdue', 'unapplied', ...('credit_limit' in value ? (['credit_limit', 'available'] as const) : [])] as const).map(
        (key) => (
          <Card key={key} className="p-4">
            <p>{t(`finance.${key}`)}</p>
            <strong className="text-xl">{value[key as keyof typeof value] as string} TJS</strong>
          </Card>
        ),
      )}
    </div>
  );
}
function Aging({ value }: { value: Summary | Balance }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...Object.values(value.aging).map(Number));
  return (
    <Card className="space-y-3 p-4">
      <h2>{t('finance.aging')}</h2>
      {Object.entries(value.aging).map(([bucket, amount]) => (
        <div key={bucket}>
          <p>
            {t(`finance.buckets.${bucket}`)}: {amount} TJS
          </p>
          <div className="h-3 rounded bg-muted">
            <div className="h-3 rounded bg-primary" style={{ width: `${(Number(amount) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </Card>
  );
}
function Pager({ count, offset, setOffset }: { count: number; offset: number; setOffset: (value: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-3">
      <Button variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>
        {t('finance.previous')}
      </Button>
      <span>
        {count ? offset + 1 : 0}–{Math.min(offset + 20, count)} / {count}
      </span>
      <Button variant="outline" disabled={offset + 20 >= count} onClick={() => setOffset(offset + 20)}>
        {t('finance.next')}
      </Button>
    </div>
  );
}
function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr>
            {headers.map((header) => (
              <th scope="col" key={header} className="p-3">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function PartnerLink({ id }: { id: string }) {
  const { orgId, base } = useFinanceAccess();
  const query = useCatalogQuery<Partnership>(`/partnerships/${id}`, orgId);
  return (
    <Link className="underline" to={`${base}/${id}`}>
      {query.data?.partner?.name ?? id}
    </Link>
  );
}
export function FinancePage() {
  const { t } = useTranslation();
  const { orgId, company, allowed, base } = useFinanceAccess();
  const [offset, setOffset] = useState(0);
  const [overdue, setOverdue] = useState(false);
  const [ordering, setOrdering] = useState('-balance');
  const summary = useCatalogQuery<Summary>('/finance/summary', orgId, allowed);
  const partners = useCatalogQuery<Page<PartnerBalance>>(
    `/finance/partnerships?limit=20&offset=${offset}&ordering=${ordering}${overdue ? '&overdue=true' : ''}`,
    orgId,
    allowed,
  );
  if (!allowed) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader title={t(company ? 'finance.title' : 'finance.debts')} />
      <Feedback error={summary.error ?? partners.error} />
      {summary.data ? (
        <>
          <MoneyCards value={summary.data} />
          <Aging value={summary.data} />
        </>
      ) : (
        <Skeleton className="h-32" />
      )}
      {company && (
        <div className="flex gap-4">
          <Link to={`${base}/payments?status=PENDING`}>{t('finance.pendingPayments')}</Link>
          <Link to={`${base}/adjustments`}>{t('finance.adjustments')}</Link>
        </div>
      )}
      <div className="flex gap-3">
        <Button
          variant={overdue ? 'primary' : 'outline'}
          onClick={() => {
            setOverdue(!overdue);
            setOffset(0);
          }}
        >
          {t('finance.overdueOnly')}
        </Button>
        <Field label={t('finance.ordering')}>
          <Select
            aria-label={t('finance.ordering')}
            value={ordering}
            onChange={(event) => {
              setOrdering(event.target.value);
              setOffset(0);
            }}
          >
            <option value="-balance">{t('finance.balance')}</option>
            <option value="-overdue">{t('finance.overdue')}</option>
            <option value="balance">{t('finance.balanceAscending')}</option>
          </Select>
        </Field>
      </div>
      <Table headers={['partner', 'balance', 'overdue', 'credit_limit', 'available'].map((key) => t(`finance.${key}`))}>
        {partners.data?.results.map((row) => (
          <tr
            key={row.partnership_id}
            className={limitWarning(row) === 'danger' ? 'bg-danger/10' : limitWarning(row) === 'warning' ? 'bg-warning/10' : ''}
          >
            <td className="p-3">
              <Link className="underline" to={`${base}/${row.partnership_id}`}>
                {row.partner_name}
              </Link>
            </td>
            {(['balance', 'overdue', 'credit_limit', 'available'] as const).map((key) => (
              <td className="p-3" key={key}>
                {row[key]} TJS
              </td>
            ))}
          </tr>
        ))}
      </Table>
      {partners.data && (
        <>
          <p>{!partners.data.count && t('finance.empty')}</p>
          <Pager count={partners.data.count} offset={offset} setOffset={setOffset} />
        </>
      )}
    </div>
  );
}
export function PartnerFinancePage() {
  const { partnershipId = '' } = useParams();
  const { t } = useTranslation();
  const { orgId, company, allowed, can } = useFinanceAccess();
  const [tab, setTab] = useState('charges');
  const [record, setRecord] = useState(false);
  const balance = useCatalogQuery<Balance>(`/finance/partnerships/${partnershipId}`, orgId, allowed);
  const partner = useCatalogQuery<Partnership>(`/partnerships/${partnershipId}`, orgId, allowed);
  if (!allowed) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader
        title={partner.data?.partner?.name ?? t('finance.partner')}
        actions={
          can('payments.record') && <Button onClick={() => setRecord(true)}>{t(company ? 'finance.record' : 'finance.report')}</Button>
        }
      />
      <Feedback error={balance.error ?? partner.error} />
      {balance.data && (
        <>
          <MoneyCards value={balance.data} />
          <Aging value={balance.data} />
        </>
      )}
      <div className="flex gap-3" role="group" aria-label={t('finance.sections')}>
        {['charges', 'payments', 'statement', ...(company ? ['adjustments'] : [])].map((key) => (
          <Button key={key} variant={tab === key ? 'primary' : 'outline'} onClick={() => setTab(key)}>
            {t(`finance.${key}`)}
          </Button>
        ))}
      </div>
      {tab === 'charges' && <Charges partnershipId={partnershipId} />}
      {tab === 'payments' && <Payments partnershipId={partnershipId} />}
      {tab === 'statement' && <StatementPanel partnershipId={partnershipId} />}
      {tab === 'adjustments' && <Adjustments partnershipId={partnershipId} balance={balance.data?.balance} />}
      {record && (
        <PaymentForm
          partnershipId={partnershipId}
          methods={partner.data?.current_terms?.payment_methods ?? []}
          onDone={() => setRecord(false)}
        />
      )}
    </div>
  );
}
function Charges({ partnershipId }: { partnershipId: string }) {
  const { t } = useTranslation();
  const { orgId } = useFinanceAccess();
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string>();
  const query = useCatalogQuery<Page<Charge>>(
    `/finance/partnerships/${partnershipId}/charges?limit=20&offset=${offset}${status ? `&status=${status}` : ''}`,
    orgId,
  );
  const detail = useCatalogQuery<components['schemas']['ChargeDetail']>(`/finance/charges/${selected}`, orgId, !!selected);
  return (
    <div className="space-y-3">
      <Field label={t('finance.status')}>
        <Select
          aria-label={t('finance.status')}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('finance.all')}</option>
          {['OPEN', 'PARTIALLY_PAID', 'PAID'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
      </Field>
      <Feedback error={query.error} />
      <Table headers={['due', 'amount', 'allocated', 'status'].map((key) => t(`finance.${key}`))}>
        {query.data?.results.map((row) => (
          <tr key={row.id}>
            <td className="p-3">
              <Button variant="ghost" onClick={() => setSelected(row.id)}>
                {row.due_date}
              </Button>
              {row.status !== 'PAID' && row.due_date < dushanbeToday() && <span className="text-danger">{t('finance.overdue')}</span>}
            </td>
            <td>{row.amount} TJS</td>
            <td>{row.allocated_amount} TJS</td>
            <td>{row.status}</td>
          </tr>
        ))}
      </Table>
      {query.data && <Pager count={query.data.count} offset={offset} setOffset={setOffset} />}
      <Dialog open={!!selected} onOpenChange={() => setSelected(undefined)}>
        <DialogContent>
          <DialogHeader title={t('finance.charge')} />
          <Feedback error={detail.error} />
          {detail.data && (
            <>
              <p>
                {detail.data.amount} TJS · {detail.data.status}
              </p>
              <p>{detail.data.source_id}</p>
              <ul>
                {detail.data.allocations.map((row) => (
                  <li key={row.id}>
                    {row.amount} TJS · {row.created_at}
                  </li>
                ))}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function PaymentForm({ partnershipId, methods, onDone }: { partnershipId: string; methods: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const { orgId, can } = useFinanceAccess();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(methods[0] ?? '');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const preview = useCatalogQuery<Preview>(
    `/finance/partnerships/${partnershipId}/allocation-preview?amount=${encodeURIComponent(amount)}`,
    orgId,
    validAmount(amount),
  );
  const mutation = useCatalogMutation('/payments', orgId, 'POST', true);
  const ready =
    validAmount(amount) &&
    !!preview.data &&
    !preview.isFetching &&
    methods.includes(method) &&
    (method !== 'BANK_TRANSFER' || !!reference.trim());
  const submit = (confirm: boolean) =>
    mutation.mutate(
      { partnership_id: partnershipId, amount, method, reference: reference.trim() || null, note: note.trim() || null, confirm },
      { onSuccess: onDone },
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onDone();
      }}
    >
      <DialogContent className="space-y-4">
        <DialogHeader title={t('finance.record')} />
        <Field label={t('finance.amount')}>
          <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label={t('finance.method')}>
          <Select aria-label={t('finance.method')} value={method} onChange={(event) => setMethod(event.target.value)}>
            {methods.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('finance.reference')}>
          <Input value={reference} maxLength={100} onChange={(event) => setReference(event.target.value)} />
        </Field>
        <Field label={t('finance.note')}>
          <Input value={note} maxLength={5000} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Feedback error={mutation.error ?? preview.error} />
        {preview.data && validAmount(amount) && (
          <section aria-label={t('finance.preview')}>
            <h3>{t('finance.preview')}</h3>
            <ul>
              {preview.data.lines.map((line) => (
                <li key={line.charge_id}>
                  {line.due_date}: {line.amount} TJS
                </li>
              ))}
            </ul>
            <p>
              {t('finance.unapplied')}: {preview.data.unapplied} TJS
            </p>
          </section>
        )}
        <div className="flex gap-3">
          <Button disabled={!ready || mutation.isPending} onClick={() => submit(false)}>
            {t('finance.record')}
          </Button>
          {can('payments.confirm') && (
            <Button disabled={!ready || mutation.isPending} onClick={() => submit(true)}>
              {t('finance.recordConfirm')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function PaymentsPage() {
  const { allowed } = useFinanceAccess();
  const { t } = useTranslation();
  return allowed ? (
    <div className="space-y-5">
      <PageHeader title={t('finance.payments')} />
      <Payments />
    </div>
  ) : (
    <ForbiddenState />
  );
}
function Payments({ partnershipId }: { partnershipId?: string }) {
  const { t } = useTranslation();
  const { orgId, can, me } = useFinanceAccess();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [method, setMethod] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Payment>();
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const query = useCatalogQuery<Page<Payment>>(
    `/payments?${new URLSearchParams({ limit: '20', offset: String(offset), ...(partnershipId ? { partnership_id: partnershipId } : {}), ...(status ? { status } : {}), ...(method ? { method } : {}) })}`,
    orgId,
  );
  const detail = useCatalogQuery<components['schemas']['PaymentDetail']>(`/payments/${selected?.id}`, orgId, !!selected);
  const mutation = useCatalogMutation(`/payments/${selected?.id}/${action}`, orgId, 'POST', true);
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Field label={t('finance.status')}>
          <Select
            aria-label={t('finance.status')}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">{t('finance.all')}</option>
            {['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('finance.method')}>
          <Select
            aria-label={t('finance.method')}
            value={method}
            onChange={(event) => {
              setMethod(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">{t('finance.all')}</option>
            <option>CASH</option>
            <option>BANK_TRANSFER</option>
          </Select>
        </Field>
      </div>
      <Feedback error={query.error} />
      <Table headers={[...(!partnershipId ? ['partner'] : []), 'amount', 'method', 'status', 'actions'].map((key) => t(`finance.${key}`))}>
        {query.data?.results.map((row) => (
          <tr key={row.id}>
            {!partnershipId && (
              <td className="p-3">
                <PartnerLink id={row.partnership_id} />
              </td>
            )}
            <td className="p-3">
              <Button
                variant="ghost"
                onClick={() => {
                  setSelected(row);
                  setAction('');
                }}
              >
                {row.amount} TJS
              </Button>
            </td>
            <td>{row.method}</td>
            <td>{row.status}</td>
            <td>
              {row.status === 'PENDING' && (
                <div className="flex gap-2">
                  {[
                    ...(can('payments.confirm') ? ['confirm'] : []),
                    ...(can('payments.reject') ? ['reject'] : []),
                    ...(row.recorded_by === me.id ? ['cancel'] : []),
                  ].map((key) => (
                    <Button
                      key={key}
                      variant="outline"
                      onClick={() => {
                        setSelected(row);
                        setReason('');
                        setAction(key);
                      }}
                    >
                      {t(`finance.${key}`)}
                    </Button>
                  ))}
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {query.data && <Pager count={query.data.count} offset={offset} setOffset={setOffset} />}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setSelected(undefined);
        }}
      >
        <DialogContent className="space-y-4">
          <DialogHeader title={t(action ? `finance.${action}` : 'finance.payments')} />
          <p>
            {selected?.amount} TJS · {selected?.method}
          </p>
          <Feedback error={mutation.error ?? detail.error} />
          {action === 'reject' && (
            <Field label={t('finance.reason')}>
              <Input value={reason} maxLength={5000} onChange={(event) => setReason(event.target.value)} />
            </Field>
          )}
          {action ? (
            <Button
              disabled={mutation.isPending || (action === 'reject' && !reason.trim())}
              onClick={() =>
                mutation.mutate(
                  { version: selected?.version, ...(action === 'reject' ? { reason: reason.trim() } : {}) },
                  { onSuccess: () => setSelected(undefined) },
                )
              }
            >
              {t(`finance.${action}`)}
            </Button>
          ) : (
            <>
              <p>
                {detail.data?.reference} {detail.data?.note}
              </p>
              <ul>
                {detail.data?.history.map((row) => (
                  <li key={row.id}>
                    {row.to_status} · {row.created_at} · {row.reason}
                  </li>
                ))}
              </ul>
              <ul>
                {detail.data?.allocations.map((row) => (
                  <li key={row.id}>
                    {row.charge_id}: {row.amount} TJS
                  </li>
                ))}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function StatementPanel({ partnershipId }: { partnershipId: string }) {
  const { t } = useTranslation();
  const { orgId } = useFinanceAccess();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(dushanbeToday());
  const valid = !from || !to || from <= to;
  const query = useCatalogQuery<Statement>(
    `/finance/partnerships/${partnershipId}/statement?${new URLSearchParams({ ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) })}`,
    orgId,
    valid,
  );
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Field label={t('finance.from')}>
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label={t('finance.to')}>
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
      </div>
      {!valid && <p role="alert">{t('finance.dateError')}</p>}
      <Feedback error={query.error} />
      {query.data && valid && (
        <>
          <p>
            {t('finance.opening')}: {query.data.opening_balance} TJS
          </p>
          <Table headers={['date', 'type', 'amount', 'balance'].map((key) => t(`finance.${key}`))}>
            {query.data.entries.map((row) => (
              <tr key={row.id}>
                <td className="p-3">{new Date(row.created_at).toLocaleString(undefined, { timeZone: 'Asia/Dushanbe' })}</td>
                <td>{row.entry_type}</td>
                <td>
                  {row.direction === 'CREDIT' ? '−' : '+'}
                  {row.amount} TJS
                </td>
                <td>{row.balance_after} TJS</td>
              </tr>
            ))}
          </Table>
          <p>
            {t('finance.closing')}: {query.data.closing_balance} TJS
          </p>
        </>
      )}
    </div>
  );
}
export function AdjustmentsPage() {
  const { allowed, company } = useFinanceAccess();
  const { t } = useTranslation();
  return allowed && company ? (
    <div className="space-y-5">
      <PageHeader title={t('finance.adjustments')} />
      <Adjustments />
    </div>
  ) : (
    <ForbiddenState />
  );
}
function Adjustments({ partnershipId, balance }: { partnershipId?: string; balance?: string }) {
  const { t } = useTranslation();
  const { orgId, can } = useFinanceAccess();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<Adjustment>();
  const [action, setAction] = useState('approve');
  const [reason, setReason] = useState('');
  const query = useCatalogQuery<Page<Adjustment>>(
    `/adjustments?limit=20&offset=${offset}${partnershipId ? `&partnership_id=${partnershipId}` : ''}${status ? `&status=${status}` : ''}`,
    orgId,
  );
  const mutation = useCatalogMutation(`/adjustments/${selected?.id}/${action}`, orgId, 'POST', true);
  return (
    <div className="space-y-3">
      {can('adjustments.create') && <Button onClick={() => setCreate(true)}>{t('finance.newAdjustment')}</Button>}
      <Field label={t('finance.status')}>
        <Select
          aria-label={t('finance.status')}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setOffset(0);
          }}
        >
          <option value="">{t('finance.all')}</option>
          {['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
      </Field>
      <Feedback error={query.error} />
      <Table
        headers={[...(!partnershipId ? ['partner'] : []), 'type', 'amount', 'reason', 'status', 'actions'].map((key) =>
          t(`finance.${key}`),
        )}
      >
        {query.data?.results.map((row) => (
          <tr key={row.id}>
            {!partnershipId && (
              <td className="p-3">
                <PartnerLink id={row.partnership_id} />
              </td>
            )}
            <td className="p-3">{row.type}</td>
            <td>{row.amount} TJS</td>
            <td>{row.reason}</td>
            <td>{row.status}</td>
            <td>
              {row.status === 'PENDING_APPROVAL' &&
                can('adjustments.approve') &&
                ['approve', 'reject'].map((key) => (
                  <Button
                    key={key}
                    variant="outline"
                    onClick={() => {
                      setSelected(row);
                      setAction(key);
                      setReason('');
                    }}
                  >
                    {t(`finance.${key}`)}
                  </Button>
                ))}
            </td>
          </tr>
        ))}
      </Table>
      {query.data && <Pager count={query.data.count} offset={offset} setOffset={setOffset} />}
      {create && <AdjustmentForm partnershipId={partnershipId} balance={balance} onDone={() => setCreate(false)} />}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setSelected(undefined);
        }}
      >
        <DialogContent className="space-y-4">
          <DialogHeader title={t(`finance.${action}`)} />
          <p>
            {selected?.type}: {selected?.amount} TJS · {selected?.reason}
          </p>
          <Feedback error={mutation.error} />
          {action === 'reject' && (
            <Field label={t('finance.reason')}>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          )}
          <Button
            disabled={mutation.isPending || (action === 'reject' && !reason.trim())}
            onClick={() =>
              mutation.mutate(
                { version: selected?.version, ...(action === 'reject' ? { reason: reason.trim() } : {}) },
                { onSuccess: () => setSelected(undefined) },
              )
            }
          >
            {t(`finance.${action}`)}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function AdjustmentForm({ partnershipId, balance, onDone }: { partnershipId?: string; balance?: string; onDone: () => void }) {
  const { t } = useTranslation();
  const { orgId } = useFinanceAccess();
  const [pid, setPid] = useState(partnershipId ?? '');
  const [type, setType] = useState('DEBIT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [offset, setOffset] = useState(0);
  const partners = useCatalogQuery<Page<PartnerBalance>>(`/finance/partnerships?limit=20&offset=${offset}`, orgId, !partnershipId);
  const current = useCatalogQuery<Balance>(`/finance/partnerships/${pid}`, orgId, !!pid && balance === undefined);
  const mutation = useCatalogMutation('/adjustments', orgId, 'POST', true);
  const before = balance ?? current.data?.balance;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onDone();
      }}
    >
      <DialogContent className="space-y-4">
        <DialogHeader title={t('finance.newAdjustment')} />
        {!partnershipId && (
          <>
            <Field label={t('finance.partner')}>
              <Select aria-label={t('finance.partner')} value={pid} onChange={(event) => setPid(event.target.value)}>
                <option value="">{t('finance.choose')}</option>
                {partners.data?.results.map((row) => (
                  <option key={row.partnership_id} value={row.partnership_id}>
                    {row.partner_name}
                  </option>
                ))}
              </Select>
            </Field>
            {partners.data && <Pager count={partners.data.count} offset={offset} setOffset={setOffset} />}
          </>
        )}
        <Field label={t('finance.type')}>
          <Select aria-label={t('finance.type')} value={type} onChange={(event) => setType(event.target.value)}>
            <option>DEBIT</option>
            <option>CREDIT</option>
            <option>REFUND</option>
          </Select>
        </Field>
        <Field label={t('finance.amount')}>
          <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label={t('finance.reason')}>
          <Input minLength={10} maxLength={5000} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {before !== undefined && validAmount(amount) && (
          <p>
            {t('finance.balanceEffect')}: {before} → {adjustmentBalance(before, amount, type)} TJS
          </p>
        )}
        <Feedback error={mutation.error ?? partners.error ?? current.error} />
        <Button
          disabled={!pid || !validAmount(amount) || reason.trim().length < 10 || mutation.isPending || before === undefined}
          onClick={() => mutation.mutate({ partnership_id: pid, type, amount, reason: reason.trim() }, { onSuccess: onDone })}
        >
          {t('finance.create')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
