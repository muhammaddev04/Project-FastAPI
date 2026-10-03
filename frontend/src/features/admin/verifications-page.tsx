import { Title as DialogPrimitiveTitle } from '@radix-ui/react-dialog';
import { Building2, ExternalLink, FileText, History, Landmark, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminContext } from '@/app/shell/use-admin-context';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { formatDateTime } from '@/shared/lib/datetime';
import {
  Alert,
  Avatar,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  ErrorState,
  FormField,
  InfoRow,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
} from '@/shared/ui';
import {
  QUEUE_PAGE_SIZE,
  fetchDocumentUrl,
  useReviewAction,
  useVerificationQueue,
  useVerificationRequest,
  type AdminRequestSummary,
  type QueueFilter,
  type QueuePage,
} from './api';

const SNAPSHOT_FIELDS = ['legal_name', 'tax_identifier', 'address'] as const;
const PROFILE_FIELDS = [
  'name',
  'legal_name',
  'tax_identifier',
  'phone',
  'email',
  'city',
  'address',
  'latitude',
  'longitude',
  'public_code',
] as const;
const MIN_REASON = 10;
/** The working queue: requests waiting for a decision, any organization type. "Reset filters" returns here. */
const DEFAULT_FILTER: QueueFilter = { status: 'SUBMITTED', org_type: '' };

function useDate() {
  return (value: string | null) => formatDateTime(value) ?? '—';
}

/** One document: the signed URL is fetched on demand (5 minutes, audited as verification.document_viewed). */
function DocumentLink({ requestId, documentId, label }: { requestId: string; documentId: string; label: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  const open = async () => {
    setLoading(true);
    setFailed(null);
    try {
      setUrl((await fetchDocumentUrl(requestId, documentId)).url);
    } catch (error) {
      setFailed(error);
    } finally {
      setLoading(false);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          {label} <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ) : (
        <Button size="sm" variant="secondary" loading={loading} onClick={() => void open()}>
          {t('admin.verifications.openDocument', { name: label })}
        </Button>
      )}
      {failed ? <span className="text-label text-danger">{errorMessage(failed, t)}</span> : null}
    </span>
  );
}

function DetailSection({ icon: Icon, title, children }: { icon: typeof FileText; title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 font-display text-body-lg font-bold">
        <Icon className="size-4 text-primary" aria-hidden="true" />
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function RequestDetail({ id, adminId }: { id: string; adminId: string }) {
  const { t } = useTranslation();
  const date = useDate();
  const detail = useVerificationRequest(id);
  const act = useReviewAction(id);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  if (detail.isPending) {
    return (
      <div className="space-y-3">
        <DialogPrimitiveTitle className="sr-only">{t('admin.verifications.detailTitle')}</DialogPrimitiveTitle>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <>
        <DialogPrimitiveTitle className="sr-only">{t('admin.verifications.detailTitle')}</DialogPrimitiveTitle>
        <ErrorState message={errorMessage(detail.error, t)} onRetry={() => void detail.refetch()} />
      </>
    );
  }
  const data = detail.data;
  const mine = data.reviewer_id === adminId;
  const reasonOk = reason.trim().replace(/\s+/g, ' ').length >= MIN_REASON;

  return (
    <div className="space-y-5" aria-label={t('admin.verifications.detailTitle')}>
      <div className="flex items-start gap-3 pr-8">
        <Avatar kind={data.org_type === 'STORE' ? 'store' : 'company'} size="lg" />
        <div className="min-w-0">
          <DialogPrimitiveTitle className="break-words font-display text-lg font-bold leading-snug">{data.org_name}</DialogPrimitiveTitle>
          <p className="text-label text-muted-foreground">
            {t(`orgTypes.${data.org_type}`)} · {t('admin.verifications.submittedAt', { date: date(data.submitted_at) })}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge kind="request" value={data.status} />
            <StatusBadge kind="verification" value={data.org_verification_status} />
          </div>
        </div>
      </div>

      <Alert tone="info">{t('admin.verifications.manualNote')}</Alert>

      <DetailSection icon={Landmark} title={t('admin.verifications.snapshotTitle')}>
        <dl className="divide-y rounded-xl border bg-subtle/40 px-4">
          {SNAPSHOT_FIELDS.map((key) => (
            <InfoRow key={key} label={t(`admin.verifications.fields.${key}`)} value={data.legal_snapshot[key] ?? '—'} />
          ))}
        </dl>
      </DetailSection>

      <DetailSection icon={FileText} title={t('admin.verifications.documentsTitle')}>
        <ul className="space-y-2">
          {data.documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-subtle/40 px-3.5 py-2.5 text-label"
            >
              <span className="font-semibold">{t(`verification.docTypes.${document.doc_type}`)}</span>
              <DocumentLink requestId={data.id} documentId={document.id} label={document.file.display_name} />
            </li>
          ))}
        </ul>
      </DetailSection>

      <DetailSection icon={Building2} title={t('admin.verifications.profileTitle')}>
        <dl className="divide-y rounded-xl border bg-subtle/40 px-4">
          {PROFILE_FIELDS.filter((key) => data.current_profile[key] != null).map((key) => (
            <InfoRow key={key} label={t(`admin.verifications.fields.${key}`)} value={data.current_profile[key]} />
          ))}
        </dl>
      </DetailSection>

      {data.history.length > 0 ? (
        <DetailSection icon={History} title={t('admin.verifications.historyTitle')}>
          <ul className="space-y-1.5 text-label">
            {data.history.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge kind="request" value={item.status} />
                <span>{date(item.submitted_at)}</span>
                {item.rejection_reason ? <span className="text-muted-foreground">— {item.rejection_reason}</span> : null}
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}

      {data.rejection_reason ? (
        <Alert tone="danger" title={t('admin.verifications.rejectionReason')}>
          {data.rejection_reason}
        </Alert>
      ) : null}
      {act.isError ? <Alert tone="danger">{errorMessage(act.error, t)}</Alert> : null}

      <div className="border-t pt-4">
        {data.status === 'SUBMITTED' ? (
          <Button loading={act.isPending} onClick={() => act.mutate({ action: 'start-review' })} className="max-sm:w-full">
            {t('admin.verifications.startReview')}
          </Button>
        ) : null}
        {data.status === 'UNDER_REVIEW' && !mine ? <Alert tone="warning">{t('admin.verifications.otherReviewer')}</Alert> : null}
        {data.status === 'UNDER_REVIEW' ? (
          <div className="space-y-3">
            {rejecting ? (
              <div className="space-y-3">
                <FormField label={t('admin.verifications.reasonLabel')} hint={t('admin.verifications.reasonHint')}>
                  <Textarea maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
                </FormField>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="secondary" onClick={() => setRejecting(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!reasonOk}
                    loading={act.isPending}
                    onClick={() => act.mutate({ action: 'reject', reason: reason.trim() }, { onSuccess: () => setRejecting(false) })}
                  >
                    {t('admin.verifications.confirmReject')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="danger-outline" onClick={() => setRejecting(true)}>
                  {t('admin.verifications.reject')}
                </Button>
                {mine ? (
                  <Button loading={act.isPending} onClick={() => act.mutate({ action: 'approve' })}>
                    <ShieldCheck /> {t('admin.verifications.approve')}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
        {act.error instanceof ApiError && act.error.code === 'invalid_transition' ? (
          <Button size="sm" variant="ghost" onClick={() => void detail.refetch()}>
            {t('common.retry')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * P02 §8 /admin/verifications (SUPERADMIN): the queue and one request at a time. Approval is a person's decision
 * after checking the documents and the legal data against official sources; the page never approves by itself.
 */
export function VerificationsPage() {
  const { t } = useTranslation();
  const { me } = useAdminContext();
  const date = useDate();
  const [filter, setFilterState] = useState<QueueFilter>(DEFAULT_FILTER);
  const [page, setPage] = useState<QueuePage>({ ordering: 'submitted_at', offset: 0 });
  const [openId, setOpenId] = useState<string | null>(null);
  const queue = useVerificationQueue(filter, page);
  const setFilter = (update: (current: QueueFilter) => QueueFilter) => {
    setFilterState(update);
    setPage((current) => ({ ...current, offset: 0 }));
  };
  // A page that became empty (its last request was decided meanwhile) steps back to the last page that has rows.
  const data = queue.data;
  useEffect(() => {
    if (data && data.offset === page.offset && data.results.length === 0 && data.count > 0 && page.offset > 0) {
      setPage((current) => ({ ...current, offset: Math.floor((data.count - 1) / QUEUE_PAGE_SIZE) * QUEUE_PAGE_SIZE }));
    }
  }, [data, page.offset]);

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.verifications.title')} description={t('admin.verifications.description')} />

      <DataTable<AdminRequestSummary>
        caption={t('admin.verifications.title')}
        rowKey={(item) => item.id}
        rows={queue.data?.results}
        loading={queue.isPending}
        error={queue.isError ? errorMessage(queue.error, t) : undefined}
        onRetry={() => void queue.refetch()}
        empty={{ title: t('admin.verifications.empty') }}
        busy={queue.isFetching && !queue.isPending}
        filters={{
          changed: filter.status !== DEFAULT_FILTER.status || filter.org_type !== DEFAULT_FILTER.org_type,
          onReset: () => setFilter(() => DEFAULT_FILTER),
        }}
        pagination={
          data
            ? {
                offset: page.offset,
                limit: QUEUE_PAGE_SIZE,
                count: data.count,
                onChange: (offset) => setPage((current) => ({ ...current, offset })),
              }
            : undefined
        }
        sort={{
          key: 'submitted',
          direction: page.ordering === '-submitted_at' ? 'desc' : 'asc',
          onChange: (next) => setPage({ ordering: next.direction === 'desc' ? '-submitted_at' : 'submitted_at', offset: 0 }),
        }}
        selectedKey={openId}
        toolbar={
          <>
            <Select
              aria-label={t('admin.verifications.filterStatus')}
              value={filter.status}
              onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value as QueueFilter['status'] }))}
              className="sm:w-48"
            >
              <option value="">{`${t('admin.verifications.filterStatus')}: ${t('admin.verifications.all')}`}</option>
              {(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const).map((status) => (
                <option key={status} value={status}>
                  {t(`admin.verifications.requestStatus.${status}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('admin.verifications.filterType')}
              value={filter.org_type}
              onChange={(event) => setFilter((current) => ({ ...current, org_type: event.target.value as QueueFilter['org_type'] }))}
              className="sm:w-48"
            >
              <option value="">{`${t('admin.verifications.filterType')}: ${t('admin.verifications.all')}`}</option>
              <option value="COMPANY">{t('orgTypes.COMPANY')}</option>
              <option value="STORE">{t('orgTypes.STORE')}</option>
            </Select>
          </>
        }
        columns={[
          {
            key: 'organization',
            header: t('admin.verifications.columns.organization'),
            primary: true,
            cell: (item) => (
              <div className="flex items-center gap-3">
                <Avatar kind={item.org_type === 'STORE' ? 'store' : 'company'} size="md" className="rounded-xl" />
                <button
                  type="button"
                  className="min-w-0 truncate text-left font-semibold text-foreground hover:text-primary"
                  onClick={() => setOpenId(item.id)}
                >
                  {item.org_name}
                </button>
              </div>
            ),
          },
          { key: 'type', header: t('admin.verifications.columns.type'), cell: (item) => t(`orgTypes.${item.org_type}`) },
          {
            key: 'status',
            header: t('admin.verifications.columns.status'),
            cell: (item) => <StatusBadge kind="request" value={item.status} />,
          },
          {
            key: 'submitted',
            header: t('admin.verifications.columns.submitted'),
            sortable: true,
            cell: (item) => <span className="text-muted-foreground">{date(item.submitted_at)}</span>,
          },
        ]}
      />

      <Dialog open={openId !== null} onOpenChange={(open) => (open ? undefined : setOpenId(null))}>
        <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
          {openId ? <RequestDetail id={openId} adminId={me.id} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
