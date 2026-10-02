import { zodResolver } from '@hookform/resolvers/zod';
import { Mail, MailCheck } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { Alert, Button, CodeInput, FormField, Input } from '@/shared/ui';
import { useResendVerification, useVerifyEmail } from './api';
import { AuthCard, CardSwitch, authLabel, authPrimaryButton } from './auth-layout';
import { MethodUnavailable } from './availability';
import { verifyEmailSchema, type VerifyEmailValues } from './schemas';
import { useAuthMethod } from './use-auth-method';
import { useCountdown } from './use-countdown';

/** Router state handed over by /register and /login; kept in history only, never in storage. */
export type VerifyEmailState = { email?: string; justRegistered?: boolean } | null;

/** P01 §2.2: another email only 60 s after the previous one; registration has just sent one. */
const RESEND_COOLDOWN_SECONDS = 60;
/** How long the success state stays before moving on to /login. */
const REDIRECT_DELAY_MS = 2500;
const CODE_LENGTH = 6;

/** Code problems get wording about codes (the shared `errors.*` text also covers reset links). */
function verifyError(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError && error.code === 'email_token_invalid') return t('auth.verify.codeInvalid');
  if (error instanceof ApiError && error.code === 'email_token_expired') return t('auth.verify.codeExpired');
  return errorMessage(error, t as Parameters<typeof errorMessage>[1]);
}

/**
 * /verify-email: the user types the 6-digit code from the verification email - nothing to click in the email.
 * The email names whose code it is (prefilled after registration or login). A new code can be requested here;
 * that answer is the same for every address (no account enumeration).
 */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useLocation().state as VerifyEmailState;
  const { available, meta } = useAuthMethod('email_verification');
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const [resendIn, setResendIn] = useCountdown(state?.justRegistered ? RESEND_COOLDOWN_SECONDS : 0);
  const [verifyIn, setVerifyIn] = useCountdown();
  const form = useForm<VerifyEmailValues>({
    resolver: zodResolver(verifyEmailSchema),
    mode: 'onTouched',
    defaultValues: { email: state?.email ?? '', code: '' },
  });
  const errors = form.formState.errors;
  // Client rules are translation keys; server validation messages arrive already translated (Accept-Language).
  const message = (key?: string) => (key ? (key.startsWith('validation.') ? t(key) : key) : undefined);
  const codeField = form.register('code');
  const verifyFailed = verify.error instanceof ApiError && verify.error.code === 'validation_error' ? null : verify.error;

  useEffect(() => {
    if (!verify.isSuccess) return undefined;
    const timer = setTimeout(() => navigate('/login', { replace: true }), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [verify.isSuccess, navigate]);

  const onVerify = form.handleSubmit(async (values) => {
    resend.reset();
    try {
      await verify.mutateAsync({ email: values.email, code: values.code });
    } catch (error) {
      if (!(error instanceof ApiError)) return;
      if (error.code === 'validation_error') {
        error.fieldErrors.forEach((field) => {
          if (field.field === 'email' || field.field === 'code') form.setError(field.field, { message: field.message });
        });
      } else if (error.status === 429) {
        setVerifyIn(error.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
      }
    }
  });

  const onResend = async () => {
    if (!(await form.trigger('email'))) return;
    verify.reset();
    try {
      await resend.mutateAsync(form.getValues('email').trim().toLowerCase());
      setResendIn(RESEND_COOLDOWN_SECONDS);
      form.setValue('code', '');
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) setResendIn(error.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
    }
  };

  if (verify.isSuccess) {
    return (
      <AuthCard title={t('auth.verify.title')}>
        <div className="space-y-4">
          <Alert tone="success" title={t('auth.verify.successTitle')}>
            {t('auth.verify.successText')}
          </Alert>
          <Button asChild block className={authPrimaryButton}>
            <Link to="/login" replace>
              {t('auth.verify.goToLogin')}
            </Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.verify.title')}>
      <div className="flex items-start gap-3 rounded-2xl bg-primary/10 px-4 py-3.5">
        <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 break-words text-body-lg leading-relaxed text-foreground/85">
          {state?.email ? t('auth.verify.sentTo', { email: state.email }) : t('auth.verify.checkInbox')}
        </p>
      </div>
      {!available ? (
        <div className="mt-4">
          <MethodUnavailable method="email_verification" meta={meta} />
        </div>
      ) : null}

      <form className="mt-5 space-y-4" noValidate onSubmit={onVerify}>
        <FormField labelClassName={authLabel} label={t('auth.fields.email')} error={message(errors.email?.message)}>
          <Input variant="auth" type="email" inputMode="email" autoComplete="email" placeholder="name@company.tj" leading={<Mail />} {...form.register('email')} />
        </FormField>
        <FormField labelClassName={authLabel} label={t('auth.verify.codeLabel')} hint={t('auth.verify.codeHint')} error={message(errors.code?.message)}>
          <CodeInput length={CODE_LENGTH} {...codeField} />
        </FormField>
        {verifyFailed ? (
          <Alert tone="danger" title={t('auth.verify.failedTitle')}>
            {verifyError(verifyFailed, t)}
          </Alert>
        ) : null}
        {resend.isSuccess ? <Alert tone="success">{t('auth.verify.resendSent')}</Alert> : null}
        {resend.isError ? <Alert tone="danger">{errorMessage(resend.error, t)}</Alert> : null}
        <Button type="submit" block className={authPrimaryButton} disabled={!available || verifyIn > 0} loading={meta.isPending || verify.isPending}>
          {verifyIn > 0 ? t('auth.verify.verifyIn', { seconds: verifyIn }) : t('auth.verify.submit')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          block
          className="h-11 rounded-2xl text-body font-semibold text-primary"
          disabled={!available || resendIn > 0}
          loading={resend.isPending}
          onClick={() => void onResend()}
        >
          {resendIn > 0 ? t('auth.verify.resendIn', { seconds: resendIn }) : t('auth.verify.resend')}
        </Button>
      </form>

      <Button asChild variant="ghost" block className="mt-1 h-11 rounded-2xl text-body text-muted-foreground">
        <Link to="/register">{t('auth.verify.wrongEmail')}</Link>
      </Button>
      <CardSwitch question={t('auth.verify.alreadyVerified')} to="/login" link={t('auth.register.signIn')} />
    </AuthCard>
  );
}
