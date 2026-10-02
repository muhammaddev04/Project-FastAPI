import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { Alert, Button, CodeInput, FormField, Input } from '@/shared/ui';
import { useResendVerification, useVerifyEmail } from './api';
import { AuthActions, AuthForm, AuthPage, AuthSwitch } from './auth-layout';
import { MethodUnavailable } from './availability';
import type { LoginState, VerifyEmailState } from './handover';
import { maskEmail } from './mask';
import { verifyEmailSchema, type VerifyEmailValues } from './schemas';
import { useAuthMethod } from './use-auth-method';
import { useCountdown } from './use-countdown';

/** P01 §2.2: another email only 60 s after the previous one; registration has just sent one. */
const RESEND_COOLDOWN_SECONDS = 60;
const CODE_LENGTH = 6;

/** Code problems get wording about codes (the shared `errors.*` text also covers reset links). */
function verifyError(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError && error.code === 'email_token_invalid') return t('auth.verify.codeInvalid');
  if (error instanceof ApiError && error.code === 'email_token_expired') return t('auth.verify.codeExpired');
  return errorMessage(error, t as Parameters<typeof errorMessage>[1]);
}

/**
 * Step 2 of 5: confirm the address with the 6-digit code from the email (Phase D).
 *
 * The code field is the only thing the screen asks for when step 1 handed the address over, and the address is
 * named above it in masked form so a typo is still obvious without printing the whole thing on a phone screen
 * in a shop. Opened cold (a reload, an old bookmark, the "confirm your email first" path on /login without
 * state), it also asks for the address, because verification happens before any session exists and a bare
 * 6-digit code can never be matched against every user's codes.
 *
 * On success it goes straight to /login with the address and a success banner rather than showing a
 * congratulations screen for 2.5 seconds and then moving on. The backend issues no session here, so signing in
 * is genuinely the next step; the shortest honest path is to arrive on the sign-in form with one field left.
 */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useLocation().state as VerifyEmailState;
  const handedOver = state?.email;
  const { available, meta } = useAuthMethod('email_verification');
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const [resendIn, setResendIn] = useCountdown(state?.justRegistered ? RESEND_COOLDOWN_SECONDS : 0);
  const [verifyIn, setVerifyIn] = useCountdown();
  const form = useForm<VerifyEmailValues>({
    resolver: zodResolver(verifyEmailSchema),
    mode: 'onTouched',
    defaultValues: { email: handedOver ?? '', code: '' },
  });
  const errors = form.formState.errors;
  // Client rules are translation keys; server validation messages arrive already translated (Accept-Language).
  const message = (key?: string) => (key ? (key.startsWith('validation.') ? t(key) : key) : undefined);
  const codeField = form.register('code');
  const verifyFailed = verify.error instanceof ApiError && verify.error.code === 'validation_error' ? null : verify.error;

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
      return;
    }
    const next: LoginState = { email: values.email, justVerified: true };
    navigate('/login', { replace: true, state: next });
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

  return (
    <AuthPage
      step="verify"
      title={t('auth.verify.title')}
      lead={handedOver ? t('auth.verify.sentTo', { email: maskEmail(handedOver) }) : t('auth.verify.checkInbox')}
      footer={<AuthSwitch question={t('auth.verify.alreadyVerified')} to="/login" link={t('auth.register.signIn')} />}
    >
      {!available ? (
        <div className="mb-5">
          <MethodUnavailable method="email_verification" meta={meta} />
        </div>
      ) : null}

      <AuthForm onSubmit={onVerify}>
        {handedOver ? (
          // The address is already known, so it is not a question; it still has to reach the request and the resend.
          <input type="hidden" {...form.register('email')} />
        ) : (
          <FormField size="lg" label={t('auth.fields.email')} error={message(errors.email?.message)}>
            <Input size="lg" type="email" inputMode="email" autoComplete="email" placeholder="name@company.tj" {...form.register('email')} />
          </FormField>
        )}
        <FormField size="lg" label={t('auth.verify.codeLabel')} hint={t('auth.verify.codeHint')} error={message(errors.code?.message)}>
          <CodeInput length={CODE_LENGTH} autoFocus={Boolean(handedOver)} {...codeField} />
        </FormField>
        {verifyFailed ? (
          <Alert tone="danger" title={t('auth.verify.failedTitle')}>
            {verifyError(verifyFailed, t)}
          </Alert>
        ) : null}
        {resend.isSuccess ? <Alert tone="success">{t('auth.verify.resendSent')}</Alert> : null}
        {resend.isError ? <Alert tone="danger">{errorMessage(resend.error, t)}</Alert> : null}
        <AuthActions>
          <Button type="submit" block size="xl" disabled={!available || verifyIn > 0} loading={meta.isPending || verify.isPending}>
            {verifyIn > 0 ? t('auth.verify.verifyIn', { seconds: verifyIn }) : t('auth.verify.submit')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            block
            size="lg"
            className="text-primary"
            disabled={!available || resendIn > 0}
            loading={resend.isPending}
            onClick={() => void onResend()}
          >
            {resendIn > 0 ? t('auth.verify.resendIn', { seconds: resendIn }) : t('auth.verify.resend')}
          </Button>
        </AuthActions>
      </AuthForm>
      <p className="mt-4 text-label text-muted-foreground">
        {t('auth.verify.nextStep')}{' '}
        <Link to="/register" className="link-grow font-semibold text-primary hover:text-primary-hover">
          {t('auth.verify.wrongEmail')}
        </Link>
      </p>
    </AuthPage>
  );
}
