import Decimal from 'decimal.js';
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useAreaContext } from '@/app/shell/use-area-context';
import { Feedback, Field } from '@/features/catalog/shared';
import {
  Badge,
  Button,
  Card,
  DataTable,
  ForbiddenState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  toast,
  type Column,
} from '@/shared/ui';
import { BarChart, LineChart, type Point } from './charts';
import {
  defaultPeriod,
  useCreateExport,
  useDownloadExport,
  useExports,
  useReport,
  useReportList,
  type ColumnKind,
  type Export,
  type ExportFormat,
  type Period,
  type Report,
  type ReportRow,
} from './api';

/** Reports and exports live in both areas; the base path is what distinguishes the two. */
function useReportsAccess() {
  const { membership } = useAreaContext();
  const base = membership.org_type === 'COMPANY' ? '/company' : '/store';
  return { membership, base, orgId: membership.organization_id };
}

function formatValue(value: unknown, kind: ColumnKind, yes: string, no: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'bool') return value ? yes : no;
  if (kind === 'percent') return `${value}%`;
  if (kind === 'hours') return `${value} h`;
  return String(value);
}

/** The period is part of the answer, so the row the chart draws is the row the table lists (RPT-005). */
function PeriodFilters({
  report,
  period,
  onChange,
  groups,
}: {
  report?: Report;
  period: Period;
  onChange: (next: Period) => void;
  groups: string[];
}) {
  const { t } = useTranslation();
  const periodic = report ? report.date_to !== null : true;
  return (
    <div className="flex flex-wrap items-end gap-3">
      {periodic ? (
        <>
          <Field label={t('reports.dateFrom')}>
            <Input
              type="date"
              value={period.date_from}
              max={period.date_to}
              onChange={(event) => onChange({ ...period, date_from: event.target.value })}
            />
          </Field>
          <Field label={t('reports.dateTo')}>
            <Input
              type="date"
              value={period.date_to}
              min={period.date_from}
              onChange={(event) => onChange({ ...period, date_to: event.target.value })}
            />
          </Field>
        </>
      ) : null}
      {groups.length > 1 ? (
        <Field label={t('reports.groupBy')}>
          <Select value={period.group_by ?? groups[0]} onChange={(event) => onChange({ ...period, group_by: event.target.value })}>
            {groups.map((group) => (
              <option key={group} value={group}>
                {t(`reports.group.${group}`)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </div>
  );
}

function ExportButtons({ kind, period }: { kind: string; period: Period }) {
  const { t } = useTranslation();
  const create = useCreateExport();
  const { base } = useReportsAccess();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Feedback error={create.error} />
      {(['CSV', 'XLSX'] as ExportFormat[]).map((format) => (
        <Button
          key={format}
          variant="outline"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(
              { kind, format, params: { ...period } },
              { onSuccess: () => toast({ tone: 'success', title: t('exports.queued') }) },
            )
          }
        >
          <FileSpreadsheet />
          {t('reports.export', { format })}
        </Button>
      ))}
      <Button asChild variant="ghost">
        <Link to={`${base}/exports`}>{t('exports.title')}</Link>
      </Button>
    </div>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  const { base } = useReportsAccess();
  const reports = useReportList();
  if (reports.error) return <ErrorState onRetry={() => void reports.refetch()} />;
  if (reports.data?.length === 0) return <ForbiddenState />;
  return (
    <div className="space-y-6">
      <PageHeader title={t('reports.title')} description={t('reports.description')} />
      <Feedback error={reports.error} />
      {reports.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reports.data?.map((report) => (
            <Card key={report.code} className="flex flex-col gap-3 p-5">
              <div className="space-y-1">
                <h2 className="font-semibold">{t(`reports.codes.${report.code}.title`)}</h2>
                <p className="text-sm text-muted-foreground">{t(`reports.codes.${report.code}.description`)}</p>
              </div>
              <Button asChild className="mt-auto w-fit" variant="outline">
                <Link to={`${base}/reports/${report.code}`}>{t('reports.open')}</Link>
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** Which reports earn a diagram, and which shape it takes (§5). */
const LINE_REPORTS = new Set(['sales_summary', 'payments', 'purchases']);
const BAR_REPORTS = new Set(['receivables_aging', 'store_debt', 'sales_by_store', 'order_funnel']);

function chartPoints(report: Report): Point[] {
  if (LINE_REPORTS.has(report.code)) {
    const measure = report.code === 'payments' ? 'amount' : 'total';
    const byPeriod = new Map<string, Decimal>();
    for (const row of report.rows as ReportRow[]) {
      const label = String(row.period ?? '');
      byPeriod.set(label, (byPeriod.get(label) ?? new Decimal(0)).plus(String(row[measure] ?? 0)));
    }
    return [...byPeriod.entries()].map(([label, value]) => ({ label, value: value.toNumber(), display: value.toFixed(2) }));
  }
  if (report.code === 'receivables_aging') {
    const totals = report.totals as Record<string, string>;
    return ['current', '1-30', '31-60', '61-90', '90+'].map((bucket) => ({
      label: bucket,
      value: Number(totals[bucket] ?? 0),
      display: String(totals[bucket] ?? '0.00'),
    }));
  }
  if (report.code === 'order_funnel') {
    return (report.rows as ReportRow[]).map((row) => ({
      label: String(row.status ?? ''),
      value: Number(row.orders ?? 0),
      display: String(row.orders ?? 0),
    }));
  }
  const measure = report.code === 'store_debt' ? 'overdue' : 'sales';
  return (report.rows as ReportRow[]).slice(0, 8).map((row) => ({
    label: String(row.store_name ?? row.company_name ?? ''),
    value: Number(row[measure] ?? 0),
    display: String(row[measure] ?? '0.00'),
  }));
}

export function ReportPage() {
  const { t } = useTranslation();
  const { code } = useParams<{ code: string }>();
  const reports = useReportList();
  const info = reports.data?.find((entry) => entry.code === code);
  const [period, setPeriod] = useState<Period>(() => defaultPeriod());
  const effectivePeriod = { ...period, group_by: period.group_by ?? info?.group_by[0] };
  const report = useReport(code, effectivePeriod, Boolean(info));
  const yes = t('reports.yes');
  const no = t('reports.no');

  const columns = useMemo<Column<ReportRow>[]>(
    () =>
      (report.data?.columns ?? []).map((column) => ({
        key: column.key,
        header: t(`reports.columns.${column.key}`),
        primary: column.kind === 'text' || column.kind === 'date',
        numeric: ['money', 'int', 'quantity', 'percent', 'hours'].includes(column.kind),
        cell: (row) => formatValue(row[column.key], column.kind, yes, no),
      })),
    [report.data?.columns, t, yes, no],
  );

  if (reports.error) return <ErrorState onRetry={() => void reports.refetch()} />;
  if (reports.data && !info) return <ForbiddenState />;
  const rows = (report.data?.rows ?? []) as ReportRow[];
  const totals = (report.data?.totals ?? {}) as Record<string, unknown>;
  const points = report.data ? chartPoints(report.data) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t(`reports.codes.${code}.title`)}
        description={t(`reports.codes.${code}.description`)}
        actions={code ? <ExportButtons kind={code} period={effectivePeriod} /> : null}
      >
        <PeriodFilters report={report.data} period={period} onChange={setPeriod} groups={info?.group_by ?? []} />
      </PageHeader>
      <Feedback error={report.error} />
      {Object.keys(totals).length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(totals)
            .filter(([, value]) => typeof value !== 'object' || value === null)
            .map(([key, value]) => (
              <Card key={key} className="p-4">
                <p className="text-sm text-muted-foreground">{t(`reports.totals.${key}`, t(`reports.columns.${key}`, key))}</p>
                <strong className="text-xl tabular-nums">{value === null ? '—' : String(value)}</strong>
              </Card>
            ))}
        </div>
      ) : null}
      {report.data && (LINE_REPORTS.has(report.data.code) || BAR_REPORTS.has(report.data.code)) ? (
        <Card className="p-5">
          {LINE_REPORTS.has(report.data.code) ? (
            <LineChart points={points} caption={t(`reports.codes.${report.data.code}.title`)} />
          ) : (
            <BarChart points={points} caption={t(`reports.codes.${report.data.code}.title`)} />
          )}
        </Card>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => columns.map((column) => String(row[column.key] ?? '')).join('|')}
        caption={t(`reports.codes.${code}.title`)}
        loading={report.isLoading || reports.isLoading}
        error={report.error ? <Feedback error={report.error} /> : undefined}
        onRetry={() => void report.refetch()}
        density="compact"
        empty={{ title: t('reports.empty') }}
      />
    </div>
  );
}

const EXPORT_TONES: Record<Export['status'], 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'info',
  RUNNING: 'warning',
  READY: 'success',
  FAILED: 'danger',
  EXPIRED: 'neutral',
};

export function ExportsPage() {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const exports = useExports(undefined, offset);
  const download = useDownloadExport();

  const columns: Column<Export>[] = [
    {
      key: 'kind',
      header: t('exports.kind'),
      primary: true,
      cell: (row) => t(`reports.codes.${row.kind}.title`, row.kind),
    },
    { key: 'format', header: t('exports.format'), cell: (row) => row.format },
    {
      key: 'status',
      header: t('exports.status'),
      cell: (row) => <Badge tone={EXPORT_TONES[row.status]}>{t(`exports.statuses.${row.status}`)}</Badge>,
    },
    { key: 'row_count', header: t('exports.rows'), numeric: true, cell: (row) => row.row_count ?? '—' },
    {
      key: 'created_at',
      header: t('exports.requested'),
      cell: (row) => new Date(row.created_at).toLocaleString(),
    },
    {
      key: 'expires_at',
      header: t('exports.expires'),
      cell: (row) => (row.expires_at ? new Date(row.expires_at).toLocaleDateString() : '—'),
    },
    {
      key: 'actions',
      header: t('exports.download'),
      cell: (row) =>
        row.status === 'READY' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={download.isPending}
            onClick={() =>
              download.mutate(row.id, {
                onSuccess: (link) => window.open(link.url, '_blank', 'noopener'),
                onError: () => toast({ tone: 'danger', title: t('exports.downloadFailed') }),
              })
            }
          >
            <Download />
            {t('exports.download')}
          </Button>
        ) : row.status === 'FAILED' ? (
          <span className="text-sm text-muted-foreground">{row.error ? t(`exports.errors.${row.error}`, row.error) : '—'}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('exports.title')}
        description={t('exports.description')}
        actions={
          <Button variant="outline" onClick={() => void exports.refetch()} disabled={exports.isFetching}>
            <RefreshCw />
            {t('exports.refresh')}
          </Button>
        }
      />
      <Feedback error={exports.error} />
      <DataTable
        columns={columns}
        rows={exports.data?.results}
        rowKey={(row) => row.id}
        caption={t('exports.title')}
        loading={exports.isLoading}
        error={exports.error ? <Feedback error={exports.error} /> : undefined}
        onRetry={() => void exports.refetch()}
        busy={exports.isFetching && !exports.isLoading}
        density="compact"
        empty={{ title: t('exports.empty') }}
        pagination={{ offset, limit: 20, count: exports.data?.count ?? 0, onChange: setOffset }}
      />
    </div>
  );
}
