import { ImageIcon, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/shared/api/errors';
import { Alert, Avatar, Button, Card, ConfirmDialog, SectionHeader, toast, type AvatarKind } from '@/shared/ui';
import { IMAGE_MAX_BYTES, IMAGE_TYPES, type ImageSubject } from './constraints';

const KIND: Record<ImageSubject, AvatarKind> = { avatar: 'person', companyLogo: 'company', storeImage: 'store' };

function objectUrl(file: File): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
}

/**
 * CR-003 profile picture card: current image (or the entity mark), choose → preview → confirm upload, and remove with
 * confirmation. Without `canEdit` the picture is shown read-only. Uploads replace the image in place; the caller's
 * mutation updates the cached resource so every place showing the picture changes at once.
 */
export function ImagePicker({
  subject,
  name,
  src,
  canEdit,
  onUpload,
  onRemove,
}: {
  subject: ImageSubject;
  /** Person or organization name: initials for a person, and part of the image's accessible text. */
  name: string;
  src: string | null | undefined;
  canEdit: boolean;
  onUpload: (file: File) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<{ file: File; preview: string | null } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const key = (suffix: string) => `images.${subject}.${suffix}`;

  // The local preview is a blob: URL; release it when it is replaced or the card goes away.
  useEffect(() => () => (chosen?.preview ? URL.revokeObjectURL(chosen.preview) : undefined), [chosen]);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // choosing the same file again still triggers a change
    if (!file) return;
    setProblem(null);
    if (!IMAGE_TYPES.includes(file.type)) return setProblem(t('errors.image_type_not_allowed'));
    if (file.size > IMAGE_MAX_BYTES) return setProblem(t('errors.image_too_large'));
    setChosen({ file, preview: objectUrl(file) });
  };

  const upload = async () => {
    if (!chosen) return;
    setBusy('upload');
    setProblem(null);
    try {
      await onUpload(chosen.file);
      setChosen(null);
      toast({ tone: 'success', title: t(key('uploaded')) });
    } catch (error) {
      setProblem(errorMessage(error, t));
      setChosen(null);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    setProblem(null);
    try {
      await onRemove();
      toast({ tone: 'success', title: t(key('removed')) });
    } catch (error) {
      setProblem(errorMessage(error, t));
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeader icon={ImageIcon} title={t(key('title'))} subtitle={t(key('subtitle'))} />
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar kind={KIND[subject]} name={name} size="xl" src={src} alt={t(key('alt'), { name })} />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-label text-muted-foreground">{src ? t('images.current') : t(key('empty'))}</p>
          {canEdit ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={busy === 'upload'}
                  disabled={busy !== null}
                  onClick={() => input.current?.click()}
                >
                  <ImagePlus aria-hidden="true" /> {src ? t(key('change')) : t(key('upload'))}
                </Button>
                {src ? (
                  <Button
                    type="button"
                    variant="danger-outline"
                    size="sm"
                    loading={busy === 'remove'}
                    disabled={busy !== null}
                    onClick={() => setConfirmRemove(true)}
                  >
                    <Trash2 aria-hidden="true" /> {t(key('remove'))}
                  </Button>
                ) : null}
              </div>
              <p id={`${inputId}-hint`} className="text-2xs text-muted-foreground">
                {t('images.requirements')}
              </p>
              <input
                ref={input}
                id={inputId}
                type="file"
                accept={IMAGE_TYPES.join(',')}
                className="sr-only"
                tabIndex={-1}
                aria-label={src ? t(key('change')) : t(key('upload'))}
                aria-describedby={`${inputId}-hint`}
                disabled={busy !== null}
                onChange={choose}
              />
            </>
          ) : (
            <p className="text-2xs text-muted-foreground">{t(key('readOnly'))}</p>
          )}
        </div>
      </div>
      {problem ? (
        <Alert tone="danger" className="mt-4">
          {problem}
        </Alert>
      ) : null}

      <ConfirmDialog
        open={chosen !== null}
        onOpenChange={(open) => (open ? undefined : setChosen(null))}
        title={t(key('previewTitle'))}
        description={t('images.previewHint')}
        confirmLabel={t(key('confirmUpload'))}
        loading={busy === 'upload'}
        onConfirm={() => void upload()}
      >
        <div className="flex items-center gap-4 rounded-2xl border bg-subtle/40 p-4">
          <Avatar kind={KIND[subject]} name={name} size="xl" src={chosen?.preview} alt={t('images.previewAlt')} />
          <p className="min-w-0 truncate text-label text-muted-foreground">{chosen?.file.name}</p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        tone="danger"
        title={t(key('removeTitle'))}
        description={t(key('removeHint'))}
        confirmLabel={t(key('remove'))}
        loading={busy === 'remove'}
        onConfirm={() => void remove()}
      />
    </Card>
  );
}
