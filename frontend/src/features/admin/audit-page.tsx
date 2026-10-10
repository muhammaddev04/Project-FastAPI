import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Feedback } from '@/features/catalog/shared';
import { Badge, Button, Card, DataTable, Dialog, DialogContent, DialogHeader, Input, PageHeader, toast, type Column } from '@/shared/ui';
import {
  PAGE_SIZE,
  useAuditExport,
  useAdminExport,
  useAdminExportDownload,
  useAuditLogs,
  type AuditFilters,
  type AuditLog,
} from './platform-api';

/** ADM-006: the viewer shows what changed, so a row opens its own before/after rather than a flat message. */
function JsonBlock({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{title}</p>
      <pre className="max-h-48 overflow-auto rounded-xl bg-subtle p-3 text-xs">{value ? JSON.stringify(value, null, 2) : '—'}</pre>
    </div>
  );
}

export function AdminAuditPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const logs = useAuditLogs(filters, offset);
  const exportLogs = useAuditExport();
  const download = useAdminExportDownload();
  const exportStatus = useAdminExport(exportLogs.data?.id);
  const currentExport = exportStatus.data ?? exportLogs.data;
  const exportExpired = Boolean(currentExport?.expires_at && new Date(currentExport.expires_at).getTime() <= Date.now());

  const set = (key: keyof AuditFilters) => (event: { target: { value: string } }) => {
    setFilters((current) => ({ ...current, [key]: event.target.value || undefined }));
    setOffset(0);
  };

  const columns: Column<AuditLog>[] = [
    {
      key: 'created_at',
      header: t('admin.audit.when'),
      primary: true,
      cell: (row) => new Date(row.created_at).toLocaleString(),
    },
    {
      key: 'actor_type',
      header: t('admin.audit.actor'),
      cell: (row) => (
        <Badge tone={row.actor_type === 'SUPERADMIN' ? 'accent' : 'neutral'}>
          {t(`admin.audit.actors.${row.actor_type}`, row.actor_type)}
        </Badge>
      ),
    },
    { key: 'action', header: t('admin.audit.action'), cell: (row) => row.action },
    { key: 'entity_type', header: t('admin.audit.entity'), cell: (row) => row.entity_type },
    { key: 'reason', header: t('admin.audit.reason'), cell: (row) => row.reason ?? '—' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.admin.audit')}
        description={t('admin.audit.description')}
        actions={
          <div className="flex gap-2">
            {(['CSV', 'XLSX'] as const).map((format) => (
              <Button
                key={format}
                variant="outline"
                disabled={exportLogs.isPending}
                onClick={() =>
                  exportLogs.mutate({ ...filters, format }, { onSuccess: () => toast({ tone: 'success', title: t('exports.queued') }) })
                }
              >
                <FileSpreadsheet />
                {t('reports.export', { format })}
              </Button>
            ))}
          </div>
        }
      />
      <Feedback error={logs.error ?? exportLogs.error ?? exportStatus.error ?? download.error} />
      {exportLogs.data ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p>{t(`exports.statuses.${exportExpired ? 'EXPIRED' : (currentExport?.status ?? 'PENDING')}`)}</p>
            {currentExport?.error ? <p className="text-sm text-destructive">{currentExport.error}</p> : null}
          </div>
          <Button
            variant="outline"
            disabled={download.isPending || currentExport?.status !== 'READY' || exportExpired || Boolean(exportStatus.error)}
            onClick={() => download.mutate(exportLogs.data!.id, { onSuccess: (link) => window.open(link.url, '_blank', 'noopener') })}
          >
            {t('exports.download')}
          </Button>
        </Card>
      ) : null}
      <DataTable
        columns={columns}
        rows={logs.data?.results}
        rowKey={(row) => row.id}
        caption={t('nav.admin.audit')}
        density="compact"
        loading={logs.isLoading}
        error={logs.error ? <Feedback error={logs.error} /> : undefined}
        onRetry={() => void logs.refetch()}
        onRowClick={setSelected}
        selectedKey={selected?.id}
        toolbar={
          <div className="flex flex-wrap gap-2">
            <Input placeholder={t('admin.audit.orgId')} value={filters.org_id ?? ''} onChange={set('org_id')} />
            <Input placeholder={t('admin.audit.actorId')} value={filters.actor_id ?? ''} onChange={set('actor_id')} />
            <Input placeholder={t('admin.audit.action')} value={filters.action ?? ''} onChange={set('action')} />
            <Input placeholder={t('admin.audit.entity')} value={filters.entity_type ?? ''} onChange={set('entity_type')} />
            <Input type="date" value={filters.date_from ?? ''} onChange={set('date_from')} />
            <Input type="date" value={filters.date_to ?? ''} onChange={set('date_to')} />
          </div>
        }
        filters={{
          changed: Object.values(filters).some(Boolean),
          onReset: () => {
            setFilters({});
            setOffset(0);
          },
        }}
        pagination={{ offset, limit: PAGE_SIZE, count: logs.data?.count ?? 0, onChange: setOffset }}
        empty={{ title: t('admin.audit.empty') }}
      />
      <Dialog open={Boolean(selected)} onOpenChange={(next) => (next ? undefined : setSelected(null))}>
        <DialogContent>
          <DialogHeader title={selected?.action ?? ''} description={selected?.entity_type} />
          {selected ? (
            <div className="space-y-3">
              <Card className="space-y-1 p-3 text-sm">
                <p>
                  {t('admin.audit.when')}: {new Date(selected.created_at).toLocaleString()}
                </p>
                <p>
                  {t('admin.audit.entity')}: {selected.entity_type} · {selected.entity_id}
                </p>
                <p>
                  {t('admin.audit.actor')}: {selected.actor_type} · {selected.actor_id ?? '—'}
                </p>
                {selected.reason ? (
                  <p>
                    {t('admin.audit.reason')}: {selected.reason}
                  </p>
                ) : null}
              </Card>
              <JsonBlock title={t('admin.audit.before')} value={selected.old_data} />
              <JsonBlock title={t('admin.audit.after')} value={selected.new_data} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
