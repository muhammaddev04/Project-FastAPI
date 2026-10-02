import { Check, CircleDashed, Clock3, FileCheck2, FileText, FileUp, ShieldCheck, XCircle } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { SettingsTabs } from '@/features/organization/settings-tabs';
import { cn } from '@/shared/lib/cn';
import { formatDateTime } from '@/shared/lib/datetime';
import { Alert, Button, Card, ConfirmDialog, ErrorState, PageHeader, SectionHeader, Skeleton, Spinner, StatusBadge } from '@/shared/ui';
import {
  ALLOWED_TYPES,
  MAX_FILE_BYTES,
  useSubmitVerification,
  useUploadVerificationFile,
  useVerification,
  type DocType,
  type OrgVerificationStatus,
  type StoredFileOut,
} from './api';

const STATUS_ICON = { NOT_SUBMITTED: CircleDashed, PENDING: Clock3, APPROVED: ShieldCheck, REJECTED: XCircle } as const;
const STATUS_TILE: Record<OrgVerificationStatus, string> = {
  NOT_SUBMITTED: 'bg-primary/10 text-primary',
  PENDING: 'bg-warning/10 text-warning',
  APPROVED: 'bg-success/10 text-success',
  REJECTED: 'bg-danger/10 text-danger',
};

function formatBytes(size: number): string {
  return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** One required document: choose a file, it is uploaded privately at once (VER-002 checks client- and server-side). */
function DocumentSlot({
  docType,
  optional,
  value,
  onUploaded,
}: {
  docType: DocType;
  optional?: boolean;
  value: StoredFileOut | undefined;
  onUploaded: (file: StoredFileOut | undefined) => void;
}) {
  const { t } = useTranslation();
  const upload = useUploadVerificationFile();
  const [clientError, setClientError] = useState<string | null>(null);
  const inputId = `doc-${docType}`;

  const onChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setClientError(null);
    if (!ALLOWED_TYPES.includes(file.type)) return setClientError(t('errors.file_type_not_allowed'));
    if (file.size > MAX_FILE_BYTES) return setClientError(t('errors.file_too_large'));
    try {
      onUploaded(await upload.mutateAsync(file));
    } catch {
      onUploaded(undefined);
    }
  };

  const problem = clientError ?? (upload.isError ? errorMessage(upload.error, t) : null);
  return (
    <div className={cn('rounded-xl border px-4 py-3.5 transition-colors', value ? 'border-success/40 bg-success-soft/40' : 'bg-subtle/40')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', value ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary')}>
            {value ? <FileCheck2 className="size-[1.125rem]" aria-hidden="true" /> : <FileText className="size-[1.125rem]" aria-hidden="true" />}
          </span>
          <div className="min-w-0">
          <p className="text-sm font-medium">
            {t(`verification.docTypes.${docType}`)}
            {optional ? <span className="ml-1.5 text-caption font-normal text-muted-foreground">{t('verification.optional')}</span> : null}
          </p>
          {value ? (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-label text-muted-foreground">
              <FileCheck2 className="size-3.5 shrink-0 text-success" aria-hidden="true" />
              <span className="truncate">{value.display_name}</span> · {formatBytes(value.size_bytes)}
            </p>
          ) : (
            <p className="mt-0.5 text-label text-muted-foreground">{t('verification.fileHint')}</p>
          )}
          </div>
        </div>
        <label
          htmlFor={inputId}
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-primary/40 bg-surface/60 px-3.5 text-label font-semibold text-primary transition-colors hover:border-primary hover:bg-primary/5"
        >
          {upload.isPending ? <Spinner className="size-4" label={t('verification.uploading')} /> : <FileUp className="size-4" aria-hidden="true" />}
          {value ? t('verification.replaceFile') : t('verification.chooseFile')}
        </label>
        <input
          id={inputId}
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          className="sr-only"
          aria-label={t(`verification.docTypes.${docType}`)}
          disabled={upload.isPending}
          onChange={(event) => void onChange(event)}
        />
      </div>
      {problem ? (
        <p role="alert" className="mt-2 text-label text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * P02 §8 /company|store/settings/verification: status, the documents the TZ requires (VER-003), submission with a
 * confirmation step (FE-002), and on REJECTED the reason plus a new submission. Only a TezFarmo administrator can
 * approve; nothing on this page marks the organization verified.
 */
export function VerificationPage() {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  const orgId = membership.organization_id;
  const state = useVerification(orgId);
  const submit = useSubmitVerification(orgId);
  const [files, setFiles] = useState<Partial<Record<DocType, StoredFileOut>>>({});
  const [confirming, setConfirming] = useState(false);
  const canSubmitRole = membership.permissions.includes('verification.submit');
  const date = (value: string | null) => formatDateTime(value) ?? '—';

  if (state.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (state.isError) return <ErrorState message={errorMessage(state.error, t)} onRetry={() => void state.refetch()} />;

  const data = state.data;
  const required = data.required_documents;
  const ready = required.every((docType) => files[docType]);
  const status = data.verification_status;
  const request = data.latest_request;

  const onSubmit = async () => {
    const documents = (Object.entries(files) as [DocType, StoredFileOut | undefined][])
      .filter((entry): entry is [DocType, StoredFileOut] => Boolean(entry[1]))
      .map(([doc_type, file]) => ({ doc_type, file_id: file.id }));
    try {
      await submit.mutateAsync(documents);
      setFiles({});
    } finally {
      setConfirming(false);
    }
  };

  const steps = [
    { key: 'submit', done: status !== 'NOT_SUBMITTED', current: status === 'NOT_SUBMITTED' },
    { key: 'review', done: status === 'APPROVED' || status === 'REJECTED', current: status === 'PENDING' },
    { key: 'decision', done: status === 'APPROVED', current: status === 'REJECTED' },
  ];
  const StatusIcon = STATUS_ICON[status];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('verification.eyebrow')} title={t('verification.title')} description={t('verification.why')} />
      <SettingsTabs />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:p-6">
          <span className={cn('flex size-14 shrink-0 items-center justify-center rounded-2xl', STATUS_TILE[status])}>
            <StatusIcon className="size-7" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <p className="font-display text-base font-bold">{t('verification.statusLabel')}</p>
              <StatusBadge kind="verification" value={status} />
            </div>
            <p className="mt-2 text-body leading-relaxed text-muted-foreground">{t(`verification.explain.${status}`)}</p>
            {status === 'APPROVED' ? (
              <p className="mt-1 text-label text-muted-foreground">{t('verification.verifiedAt', { date: date(data.verified_at) })}</p>
            ) : null}
            {request ? (
              <p className="mt-1 text-label text-muted-foreground">{t('verification.submittedAt', { date: date(request.submitted_at) })}</p>
            ) : null}
          </div>
        </div>
        <ol className="grid grid-cols-3 border-t bg-subtle/40" aria-label={t('verification.steps.label')}>
          {steps.map((step, index) => (
            <li key={step.key} className="flex items-center gap-2.5 px-3 py-3.5 sm:px-6" aria-current={step.current ? 'step' : undefined}>
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-caption font-bold',
                  step.done
                    ? 'border-primary bg-primary text-primary-foreground'
                    : step.current
                      ? status === 'REJECTED'
                        ? 'border-danger bg-danger-soft text-danger'
                        : ' border-primary bg-primary/10 text-primary-ink'
                      : 'bg-surface text-muted-foreground',
                )}
              >
                {step.done ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span className={cn('min-w-0 text-caption font-semibold leading-tight sm:text-label', step.done || step.current ? 'text-foreground' : 'text-muted-foreground')}>
                {t(`verification.steps.${step.key}`)}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {status === 'REJECTED' && request?.rejection_reason ? (
        <Alert tone="danger" title={t('verification.rejectedTitle')}>
          <p className="whitespace-pre-line">{request.rejection_reason}</p>
          <p className="mt-2">{t('verification.rejectedNext')}</p>
        </Alert>
      ) : null}

      {data.can_submit && canSubmitRole ? (
        <Card className="space-y-4 p-5 sm:p-6">
          <SectionHeader
            icon={FileUp}
            title={status === 'REJECTED' ? t('verification.resubmitTitle') : t('verification.documentsTitle')}
            subtitle={t('verification.documentsHelp')}
          />
          {required.map((docType) => (
            <DocumentSlot key={docType} docType={docType} value={files[docType]} onUploaded={(file) => setFiles((current) => ({ ...current, [docType]: file }))} />
          ))}
          <DocumentSlot docType="OTHER" optional value={files.OTHER} onUploaded={(file) => setFiles((current) => ({ ...current, OTHER: file }))} />
          {submit.isError ? (
            <Alert tone="danger">
              {submit.error instanceof ApiError && submit.error.code === 'verification_documents_missing'
                ? t('errors.verification_documents_missing')
                : errorMessage(submit.error, t)}
            </Alert>
          ) : null}
          <div className="flex justify-end">
            <Button disabled={!ready} onClick={() => setConfirming(true)} className="max-sm:w-full">
              <ShieldCheck /> {t('verification.submit')}
            </Button>
          </div>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            icon={ShieldCheck}
            title={t('verification.confirmTitle')}
            description={t('verification.confirmText')}
            confirmLabel={t('verification.confirmSubmit')}
            loading={submit.isPending}
            onConfirm={() => void onSubmit()}
          />
        </Card>
      ) : null}

      {data.can_submit && !canSubmitRole ? <Alert tone="info">{t('verification.ownerOnly')}</Alert> : null}

      {request && request.documents.length > 0 ? (
        <Card className="p-5 sm:p-6">
          <SectionHeader icon={FileCheck2} title={t('verification.submittedDocuments')} />
          <ul className="mt-4 space-y-2">
            {request.documents.map((document) => (
              <li key={document.id} className="flex items-center gap-3 rounded-xl border bg-subtle/40 px-3.5 py-3">
                <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label font-semibold">{t(`verification.docTypes.${document.doc_type}`)}</span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {document.file.display_name} · {formatBytes(document.file.size_bytes)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
