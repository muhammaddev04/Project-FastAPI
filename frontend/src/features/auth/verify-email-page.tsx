import { MailCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { AuthCard, CardSwitch, authPrimaryButton } from './auth-layout';
import { MethodUnavailable } from './availability';
import { useAuthMethod } from './use-auth-method';
import { useLinkToken } from './use-link-token';

/**
 * CR-001 /verify-email: without a token it explains the inbox step; with a `token` from the email link it would
 * confirm the address. Confirmation is done by the server (deferred), so the page reports the real state only.
 */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const token = useLinkToken();
  const { available, meta } = useAuthMethod('email_verification');

  return (
    <AuthCard title={t('auth.verify.title')}>
      <div className="flex items-start gap-3 rounded-2xl bg-primary/10 px-4 py-3.5">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-[0.9375rem] leading-relaxed text-foreground/85">{token ? t('auth.verify.withLink') : t('auth.verify.checkInbox')}</p>
      </div>
      {!available ? (
        <div className="mt-4">
          <MethodUnavailable method="email_verification" meta={meta} />
        </div>
      ) : null}
      <div className="mt-5 space-y-2">
        <Button type="button" block className={authPrimaryButton} disabled={!available} loading={meta.isPending}>
          {token ? t('auth.verify.confirm') : t('auth.verify.resend')}
        </Button>
        <Button asChild variant="ghost" block className="h-11 rounded-2xl text-[0.875rem] text-muted-foreground">
          <Link to="/register">{t('auth.verify.wrongEmail')}</Link>
        </Button>
      </div>
      <CardSwitch question={t('auth.verify.alreadyVerified')} to="/login" link={t('auth.register.signIn')} />
    </AuthCard>
  );
}
