import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { Alert, Button, Card, DataTable, ForbiddenState, Input, PageHeader, Select, Skeleton } from '@/shared/ui';
import { errorMessage } from '@/shared/api/errors';
import { formatDateTime } from '@/shared/lib/datetime';
import { downloadTemplate, useCatalogMutation, useCatalogQuery, type ImportError, type ImportJob, type ImportRow, type Page } from './api';
import { CatalogTabs, Feedback, Field } from './shared';
import { useCatalogAccess } from './api';

export function ImportHistoryPage() {
  const { t } = useTranslation();
  const { membership, orgId, writable } = useCatalogAccess('import.run');
  const allowed = membership.permissions.includes('import.run');
  const [offset, setOffset] = useState(0);
  const query = useCatalogQuery<Page<ImportJob>>(`/imports?limit=20&offset=${offset}`, orgId, allowed);
  if (!allowed) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('catalog.imports')}
        actions={
          writable && (
            <Button asChild>
              <Link to="/company/imports/new">{t('catalog.newImport')}</Link>
            </Button>
          )
        }
      />
      <CatalogTabs />
      <DataTable<ImportJob>
        rows={query.data?.results}
        loading={query.isPending}
        error={query.isError ? errorMessage(query.error, t) : undefined}
        onRetry={() => void query.refetch()}
        rowKey={(row) => row.id}
        empty={{ title: t('catalog.noImports') }}
        pagination={{ offset, limit: 20, count: query.data?.count ?? 0, onChange: setOffset }}
        columns={[
          {
            key: 'kind',
            header: t('catalog.kind'),
            primary: true,
            cell: (row) => (
              <Link className="text-primary underline" to={`/company/imports/${row.id}`}>
                {t(`catalog.kind${row.kind}`)}
              </Link>
            ),
          },
          { key: 'status', header: t('catalog.status'), cell: (row) => t(`catalog.importStatus.${row.status}`) },
          { key: 'rows', header: t('catalog.rows'), numeric: true, cell: (row) => row.total_rows },
          { key: 'errors', header: t('catalog.errors'), numeric: true, cell: (row) => row.error_count },
          { key: 'date', header: t('catalog.createdAt'), cell: (row) => formatDateTime(row.created_at) },
        ]}
      />
    </div>
  );
}

export function ImportWizardPage() {
  const { jobId } = useParams();
  const { membership } = useAreaContext();
  return <Wizard key={`${membership.organization_id}:${jobId ?? 'new'}`} id={jobId} />;
}

function Wizard({ id }: { id?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { membership, orgId, writable } = useCatalogAccess('import.run');
  const allowed = membership.permissions.includes('import.run');
  const [kind, setKind] = useState('PRODUCTS');
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState('');
  const [downloadError, setDownloadError] = useState<unknown>();
  const [rowOffset, setRowOffset] = useState(0);
  const [errorOffset, setErrorOffset] = useState(0);
  const upload = useCatalogMutation<ImportJob>('/imports', orgId);
  const query = useCatalogQuery<ImportJob>(`/imports/${id}`, orgId, !!id && allowed, 2000);
  const rows = useCatalogQuery<Page<ImportRow>>(
    `/imports/${id}/rows?limit=20&offset=${rowOffset}`,
    orgId,
    !!id && allowed,
    query.data?.status === 'UPLOADED' ? 2000 : undefined,
    query.data?.status,
  );
  const errors = useCatalogQuery<Page<ImportError>>(
    `/imports/${id}/errors?limit=20&offset=${errorOffset}`,
    orgId,
    !!id && allowed,
    query.data?.status === 'UPLOADED' ? 2000 : undefined,
    query.data?.status,
  );
  const confirm = useCatalogMutation<ImportJob>(`/imports/${id}/confirm`, orgId, 'POST', true);
  const cancel = useCatalogMutation<ImportJob>(`/imports/${id}/cancel`, orgId);
  if (!allowed) return <ForbiddenState />;
  const job = query.data;
  return (
    <div className="space-y-5">
      <PageHeader title={t('catalog.newImport')} />
      <CatalogTabs />
      {!id ? (
        <Card className="space-y-4 p-5">
          <h2 className="font-semibold">1. {t('catalog.chooseTemplate')}</h2>
          <Field label={t('catalog.kind')}>
            <Select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="PRODUCTS">{t('catalog.kindPRODUCTS')}</option>
              <option value="PRICES">{t('catalog.kindPRICES')}</option>
              <option value="STOCK">{t('catalog.kindSTOCK')}</option>
            </Select>
          </Field>
          <Button
            variant="outline"
            onClick={() => {
              setDownloadError(undefined);
              void downloadTemplate(kind, orgId).catch(setDownloadError);
            }}
          >
            {t('catalog.downloadTemplate')}
          </Button>
          <Feedback error={downloadError} />
          <h2 className="font-semibold">2. {t('catalog.upload')}</h2>
          <p>{t('catalog.importLimits')}</p>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!file) return;
              const data = new FormData();
              data.append('file', file);
              data.append('kind', kind);
              upload.mutate(data, { onSuccess: (result) => navigate(`/company/imports/${result.id}`) });
            }}
          >
            <Field label={t('catalog.file')}>
              <Input
                type="file"
                accept=".xlsx"
                required
                disabled={!writable}
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  const valid = next && next.name.toLowerCase().endsWith('.xlsx') && next.size <= 5 * 1024 * 1024;
                  setFile(valid ? next : null);
                  setLocalError(next && !valid ? t('catalog.importLimits') : '');
                }}
              />
            </Field>
            {localError && <Alert tone="danger">{localError}</Alert>}
            <Button type="submit" disabled={!file || !writable || upload.isPending}>
              {t('catalog.upload')}
            </Button>
            <Feedback error={upload.error} />
          </form>
        </Card>
      ) : query.isPending ? (
        <Skeleton className="h-48" />
      ) : job ? (
        <>
          <Card className="space-y-3 p-5">
            <h2 className="font-semibold" aria-live="polite">
              {t(`catalog.importStatus.${job.status}`)}
            </h2>
            <p>
              {t('catalog.rows')}: {job.total_rows} · {t('catalog.errors')}: {job.error_count}
            </p>
            {job.status === 'UPLOADED' || job.status === 'CONFIRMED' ? <p>{t('catalog.waiting')}</p> : null}
            {job.failure_reason && <Alert tone="danger">{t(`errors.${job.failure_reason}`)}</Alert>}
            {job.status === 'VALIDATED' && (
              <>
                <p>{t('catalog.allOrNothing')}</p>
                <Button disabled={!writable || !!job.error_count || confirm.isPending} onClick={() => confirm.mutate(undefined)}>
                  {t('catalog.confirm')}
                </Button>
              </>
            )}
            {['UPLOADED', 'VALIDATED'].includes(job.status) && (
              <Button variant="outline" disabled={!writable || cancel.isPending} onClick={() => cancel.mutate(undefined)}>
                {t('catalog.cancel')}
              </Button>
            )}
            <Feedback error={confirm.error ?? cancel.error} />
            {job.status === 'COMPLETED' && (
              <div>
                {['created', 'updated', 'skipped'].map((key) => (
                  <p key={key}>
                    {t(`catalog.${key}`)}: {String(job.summary[key] ?? 0)}
                  </p>
                ))}
              </div>
            )}
            {Array.isArray(job.summary.new_categories) && job.summary.new_categories.length > 0 && (
              <p>
                {t('catalog.newCategories')}: {job.summary.new_categories.join(', ')}
              </p>
            )}
          </Card>
          <DataTable<ImportRow>
            rows={rows.data?.results}
            loading={rows.isPending}
            error={rows.isError ? errorMessage(rows.error, t) : undefined}
            onRetry={() => void rows.refetch()}
            rowKey={(row) => row.id}
            empty={{ title: t('catalog.rows') }}
            pagination={{ offset: rowOffset, limit: 20, count: rows.data?.count ?? 0, onChange: setRowOffset }}
            columns={[
              { key: 'number', header: t('catalog.rowNumber'), numeric: true, cell: (row) => row.row_number },
              { key: 'action', header: t('catalog.action'), cell: (row) => t(`catalog.action${row.action}`) },
              {
                key: 'data',
                header: t('catalog.preview'),
                primary: true,
                cell: (row) =>
                  Object.entries(row.data)
                    .map(([key, value]) => `${key}: ${String(value ?? '—')}`)
                    .join(' · '),
              },
            ]}
          />
          <DataTable<ImportError>
            rows={errors.data?.results}
            loading={errors.isPending}
            rowKey={(row) => row.id}
            empty={{ title: t('catalog.noErrors') }}
            pagination={{ offset: errorOffset, limit: 20, count: errors.data?.count ?? 0, onChange: setErrorOffset }}
            columns={[
              { key: 'number', header: t('catalog.rowNumber'), numeric: true, cell: (row) => row.row_number },
              { key: 'field', header: t('catalog.field'), cell: (row) => row.field },
              { key: 'message', header: t('catalog.errors'), primary: true, cell: (row) => t(row.message_key, row.params) },
            ]}
          />
        </>
      ) : (
        <Feedback error={query.error} />
      )}
    </div>
  );
}
