import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '@/shared/api/client';
import { Feedback, Field } from '@/features/catalog/shared';
import { Button, Input } from '@/shared/ui';
import { useReturnsAccess } from './access';

export type AttachmentFile = { id: string; display_name: string };

export function AttachmentsInput({
  files,
  onChange,
  onBusyChange,
  limit = 10,
}: {
  files: AttachmentFile[];
  onChange: (files: AttachmentFile[]) => void;
  onBusyChange: (busy: boolean) => void;
  limit?: number;
}) {
  const { t } = useTranslation();
  const { orgId } = useReturnsAccess();
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.set('category', 'DISPUTE');
      body.set('file', file);
      return apiRequest<AttachmentFile>('/files', { method: 'POST', body, headers: { 'X-Org-Id': orgId } });
    },
    onMutate: () => onBusyChange(true),
    onSuccess: (file) => onChange([...files, file]),
    onSettled: () => onBusyChange(false),
  });
  return (
    <div className="space-y-2">
      <Field label={t('returns.addAttachment')}>
        <Input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          disabled={upload.isPending || files.length >= limit}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload.mutate(file);
            event.target.value = '';
          }}
        />
      </Field>
      <p className="text-micro text-muted-foreground">{t('returns.attachmentHint')}</p>
      <Feedback error={upload.error} />
      <ul className="space-y-1">
        {files.map((file) => (
          <li key={file.id} className="flex items-center gap-2 break-all">
            <span>{file.display_name}</span>
            <Button
              variant="ghost"
              disabled={upload.isPending}
              aria-label={t('returns.removeAttachment', { name: file.display_name })}
              onClick={() => onChange(files.filter((item) => item.id !== file.id))}
            >
              {t('returns.removeFile')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
