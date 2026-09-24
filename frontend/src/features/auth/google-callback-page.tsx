import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button } from '@/shared/ui';
import { AuthCard, AuthFrame, AuthHero } from './auth-layout';
import { useAuthMethod } from './use-auth-method';

/**
 * Google redirects back here. The code is never handled by the browser app itself: exchanging it belongs to
 * the backend OAuth flow, which is not enabled yet, so this page only reports the outcome honestly.
 */
export function GoogleCallbackPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { available } = useAuthMethod('google');
  const cancelled = params.get('error') === 'access_denied';

  return (
    <AuthFrame>
      <AuthHero title={t('auth.google.callbackTitle')} subtitle={t('auth.google.callbackSubtitle')} />
      <AuthCard className="mx-auto max-w-2xl">
        {cancelled ? (
          <Alert tone="warning" title={t('auth.google.cancelledTitle')}>
            {t('auth.google.cancelledText')}
          </Alert>
        ) : !available ? (
          <Alert tone="info" title={t('auth.unavailable.google.title')}>
            {t('auth.unavailable.google.text')}
          </Alert>
        ) : null}
        <Button asChild variant="secondary" block size="lg" className="mt-5">
          <Link to="/login">{t('auth.reset.back')}</Link>
        </Button>
      </AuthCard>
    </AuthFrame>
  );
}
