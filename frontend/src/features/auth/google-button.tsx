import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { useAuthMethod } from './use-auth-method';

/**
 * "Continue with Google". The OAuth flow (authorization code + state + PKCE, server-side exchange)
 * is owned by the backend; until /meta reports it as enabled the button stays disabled and explains why.
 */
export function GoogleButton() {
  const { t } = useTranslation();
  const { available, meta } = useAuthMethod('google');
  return (
    <div className="space-y-1.5">
      <Button type="button" variant="secondary" block size="lg" disabled={!available} aria-describedby="google-status">
        <span aria-hidden="true" className="flex size-4 items-center justify-center rounded-full border text-[0.625rem] font-bold">
          G
        </span>
        {t('auth.google.button')}
      </Button>
      {!available && !meta.isPending ? (
        <p id="google-status" className="text-center text-2xs text-muted-foreground">
          {t('auth.google.notEnabled')}
        </p>
      ) : null}
    </div>
  );
}

export function OrDivider() {
  const { t } = useTranslation();
  return (
    <div className="my-6 flex items-center gap-3 text-2xs font-medium uppercase tracking-wide text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      {t('auth.or')}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
