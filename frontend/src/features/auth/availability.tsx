import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/shared/api/errors';
import type { AuthMethods, useMeta } from '@/shared/api/meta';
import { Alert, Button, Spinner } from '@/shared/ui';

const fade = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.18 },
};

/**
 * Availability of a sign-in method from GET /api/v1/meta: a "checking" row while it loads, a retryable error,
 * or an honest notice when the server does not offer the method yet (no request is ever sent for it).
 */
export function MethodUnavailable({ method, meta }: { method: keyof AuthMethods; meta: ReturnType<typeof useMeta> }) {
  const { t } = useTranslation();
  const state = meta.isPending ? 'loading' : meta.isError ? 'error' : 'unavailable';
  return (
    <AnimatePresence mode="wait" initial={false}>
      {state === 'loading' ? (
        <motion.div
          key="loading"
          {...fade}
          role="status"
          className="flex items-center gap-2.5 rounded border border-dashed border-input px-3.5 py-3 text-[0.8125rem] text-muted-foreground"
        >
          <Spinner className="size-4 text-primary" />
          {t('auth.unavailable.checking')}
        </motion.div>
      ) : state === 'error' ? (
        <motion.div key="error" {...fade}>
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
        </motion.div>
      ) : (
        <motion.div key="unavailable" {...fade}>
          <Alert tone="info" className="short:py-2 short:leading-[1.125rem]" title={t(`auth.unavailable.${method}.title`)}>
            {t(`auth.unavailable.${method}.text`)}
          </Alert>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
