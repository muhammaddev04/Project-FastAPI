import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/shared/api/errors';
import type { AuthMethods, useMeta } from '@/shared/api/meta';
import { Alert, Button } from '@/shared/ui';

/** Honest notice for a method that the server does not offer yet (no request is sent). */
export function MethodUnavailable({ method, meta }: { method: keyof AuthMethods; meta: ReturnType<typeof useMeta> }) {
  const { t } = useTranslation();
  if (meta.isPending) return null;
  if (meta.isError) {
    return (
      <Alert
        tone="danger"
        title={t('auth.unavailable.metaErrorTitle')}
        action={
          <Button size="sm" variant="secondary" onClick={() => void meta.refetch()}>
            {t('common.retry')}
          </Button>
        }
      >
        {errorMessage(meta.error, t)}
      </Alert>
    );
  }
  return (
    <Alert tone="info" title={t(`auth.unavailable.${method}.title`)}>
      {t(`auth.unavailable.${method}.text`)}
    </Alert>
  );
}
