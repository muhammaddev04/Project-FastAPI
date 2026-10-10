import { RefreshCw, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Feedback } from '@/features/catalog/shared';
import { Badge, Button, DataTable, PageHeader, Select, toast, type Column } from '@/shared/ui';
import { ReasonDialog } from './platform-pages';
import {
  PAGE_SIZE,
  useNotificationFailures,
  useOutbox,
  useReconciliationIssues,
  useResolveIssue,
  useRetryOutbox,
  type NotificationFailure,
  type OutboxEvent,
  type ReconciliationIssue,
} from './platform-api';

/** ADM-007: the FAILED events, with the one action an administrator has over them. */
export function AdminOutboxPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string>('FAILED');
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<OutboxEvent | null>(null);
  const events = useOutbox(status || undefined, offset);
  const retry = useRetryOutbox();

  const columns: Column<OutboxEvent>[] = [
    { key: 'event_type', header: t('admin.ops.event'), primary: true, cell: (row) => row.event_type },
    {
      key: 'status',
      header: t('admin.ops.status'),
      cell: (row) => (
        <Badge tone={row.status === 'FAILED' ? 'danger' : row.status === 'PENDING' ? 'info' : 'success'}>
          {t(`admin.ops.statuses.${row.status}`, row.status)}
        </Badge>
      ),
    },
    { key: 'attempts', header: t('admin.ops.attempts'), numeric: true, cell: (row) => row.attempts },
    { key: 'last_error', header: t('admin.ops.error'), cell: (row) => row.last_error ?? '—' },
    {
      key: 'created_at',
      header: t('admin.ops.created'),
      cell: (row) => new Date(row.created_at).toLocaleString(),
    },
    {
      key: 'actions',
      header: t('admin.ops.retry'),
      cell: (row) =>
        row.status === 'FAILED' ? (
          <Button size="sm" variant="outline" onClick={() => setPending(row)}>
            <RotateCcw />
            {t('admin.ops.retry')}
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.admin.outbox')} description={t('admin.ops.outboxDescription')} />
      <Feedback error={events.error ?? retry.error} />
      <DataTable
        columns={columns}
        rows={events.data?.results}
        rowKey={(row) => row.id}
        caption={t('nav.admin.outbox')}
        density="compact"
        loading={events.isLoading}
        error={events.error ? <Feedback error={events.error} /> : undefined}
        onRetry={() => void events.refetch()}
        toolbar={
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setOffset(0);
            }}
          >
            <option value="FAILED">{t('admin.ops.statuses.FAILED', 'FAILED')}</option>
            <option value="PENDING">{t('admin.ops.statuses.PENDING', 'PENDING')}</option>
            <option value="PROCESSED">{t('admin.ops.statuses.PROCESSED', 'PROCESSED')}</option>
            <option value="">{t('admin.ops.anyStatus')}</option>
          </Select>
        }
        pagination={{ offset, limit: PAGE_SIZE, count: events.data?.count ?? 0, onChange: setOffset }}
        empty={{ title: t('admin.ops.outboxEmpty') }}
      />
      <ReasonDialog
        open={pending !== null}
        title={t('admin.ops.retry')}
        description={t('admin.reasonRequired')}
        pending={retry.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => {
          if (!pending) return;
          retry.mutate(
            { id: pending.id, reason },
            {
              onSuccess: () => {
                toast({ tone: 'success', title: t('admin.done') });
                setPending(null);
              },
            },
          );
        }}
      />
    </div>
  );
}

/** ADM-008 / NTF-004: a channel failure never breaks business, but it has to be visible here. */
export function AdminNotificationsPage() {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const failures = useNotificationFailures(offset);

  const columns: Column<NotificationFailure>[] = [
    { key: 'event_type', header: t('admin.ops.event'), primary: true, cell: (row) => row.event_type },
    { key: 'channel', header: t('admin.ops.channel'), cell: (row) => row.channel },
    { key: 'attempts', header: t('admin.ops.attempts'), numeric: true, cell: (row) => row.attempts },
    { key: 'last_error', header: t('admin.ops.error'), cell: (row) => row.last_error ?? '—' },
    { key: 'user_id', header: t('admin.ops.user'), cell: (row) => row.user_id },
    {
      key: 'created_at',
      header: t('admin.ops.created'),
      cell: (row) => new Date(row.created_at).toLocaleString(),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.admin.notifications')}
        description={t('admin.ops.notificationsDescription')}
        actions={
          <Button variant="outline" onClick={() => void failures.refetch()} disabled={failures.isFetching}>
            <RefreshCw />
            {t('exports.refresh')}
          </Button>
        }
      />
      <Feedback error={failures.error} />
      <DataTable
        columns={columns}
        rows={failures.data?.results}
        rowKey={(row) => row.id}
        caption={t('nav.admin.notifications')}
        density="compact"
        loading={failures.isLoading}
        error={failures.error ? <Feedback error={failures.error} /> : undefined}
        onRetry={() => void failures.refetch()}
        pagination={{ offset, limit: PAGE_SIZE, count: failures.data?.count ?? 0, onChange: setOffset }}
        empty={{ title: t('admin.ops.notificationsEmpty') }}
      />
    </div>
  );
}

/** ADM-009: the P09 reconciliation findings, resolved with a note that stays in the audit log. */
export function AdminReconciliationPage() {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<ReconciliationIssue | null>(null);
  const issues = useReconciliationIssues(offset);
  const resolve = useResolveIssue();

  const columns: Column<ReconciliationIssue>[] = [
    { key: 'check_code', header: t('admin.ops.check'), primary: true, cell: (row) => row.check_code },
    { key: 'expected', header: t('admin.ops.expected'), numeric: true, cell: (row) => row.expected },
    { key: 'actual', header: t('admin.ops.actual'), numeric: true, cell: (row) => row.actual },
    {
      key: 'detected_at',
      header: t('admin.ops.detected'),
      cell: (row) => new Date(row.detected_at).toLocaleString(),
    },
    {
      key: 'resolved_at',
      header: t('admin.ops.resolved'),
      cell: (row) =>
        row.resolved_at ? (
          <Badge tone="success">{new Date(row.resolved_at).toLocaleDateString()}</Badge>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setPending(row)}>
            {t('admin.ops.resolve')}
          </Button>
        ),
    },
    { key: 'note', header: t('admin.ops.note'), cell: (row) => row.note ?? '—' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.admin.reconciliation')} description={t('admin.ops.reconciliationDescription')} />
      <Feedback error={issues.error ?? resolve.error} />
      <DataTable
        columns={columns}
        rows={issues.data?.results}
        rowKey={(row) => row.id}
        caption={t('nav.admin.reconciliation')}
        density="compact"
        loading={issues.isLoading}
        error={issues.error ? <Feedback error={issues.error} /> : undefined}
        onRetry={() => void issues.refetch()}
        pagination={{ offset, limit: PAGE_SIZE, count: issues.data?.count ?? 0, onChange: setOffset }}
        empty={{ title: t('admin.ops.reconciliationEmpty') }}
      />
      <ReasonDialog
        open={pending !== null}
        title={t('admin.ops.resolve')}
        description={t('admin.ops.resolveHint')}
        pending={resolve.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(note) => {
          if (!pending) return;
          resolve.mutate(
            { id: pending.id, note },
            {
              onSuccess: () => {
                toast({ tone: 'success', title: t('admin.done') });
                setPending(null);
              },
            },
          );
        }}
      />
    </div>
  );
}
