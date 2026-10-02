import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { useSessionStore } from '@/shared/auth/session-store';
import { Alert, Button, FormField, Input, PasswordInput } from '@/shared/ui';
import { useLogin } from './api';
import { AuthForm, AuthPage, AuthSwitch } from './auth-layout';
import { MethodUnavailable } from './availability';
import { GoogleButton, OrDivider } from './google-button';
import { loginSchema, type LoginValues } from './schemas';
import { useAuthMethod } from './use-auth-method';
import { useCountdown } from './use-countdown';
import { VERIFY_PATH, type LoginState, type VerifyEmailState } from './handover';

const FORM_FIELDS = ['email', 'password'] as const;

/** Why the last attempt failed. Field problems go to the fields; this is for everything else. */
function LoginError({ error, email }: { error: unknown; email: string }) {
  const { t } = useTranslation();
  if (error instanceof ApiError && error.code === 'email_not_verified') {
    const state: VerifyEmailState = { email };
    return (
      <Alert tone="warning" title={t('auth.login.notVerifiedTitle')}>
        <p>{t('errors.email_not_verified')}</p>
        <Link to={VERIFY_PATH} state={state} className="link-grow mt-1 inline-block font-semibold text-primary hover:text-primary-hover">
          {t('auth.login.goVerify')}
        </Link>
      </Alert>
    );
  }
  return (
    <Alert tone="danger" title={t('auth.login.failed')}>
      {errorMessage(error, t)}
    </Alert>
  );
}

/**
 * /login (Phase D).
 *
 * The screen answers four questions in the order they are asked: where do I type my credentials, how do I
 * continue with Google, how do I recover a password, and how do I register. Nothing else is on it.
 *
 * Two things were removed. The Login | Register tab plate is gone: registration is now a five-step journey
 * rather than the other half of this screen, and a tab bar promised they were peers. And the standing line
 * "5 attempts per 15 minutes (brute-force protection)" no longer sits under the password field; it is a
 * warning about a thing that has not happened, and it now appears where it is actually useful, next to the
 * countdown after the server has refused an attempt.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const handover = (useLocation().state ?? null) as LoginState;
  const endedReason = useSessionStore((state) => state.endedReason);
  const { available, meta } = useAuthMethod('password_login');
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { email: handover?.email ?? '', password: '' },
  });
  const errors = form.formState.errors;
  const login = useLogin();
  const [retryIn, setRetryIn] = useCountdown();
  // Client rules are translation keys; server validation messages arrive already translated (Accept-Language).
  const message = (key?: string) => (key ? (key.startsWith('validation.') ? t(key) : key) : undefined);
  const formError = login.error instanceof ApiError && login.error.code === 'validation_error' ? null : login.error;

  // Arriving from step 2 with the address already filled in: the password is the only thing left to ask for.
  const { setFocus } = form;
  useEffect(() => {
    if (handover?.justVerified) setFocus('password');
  }, [handover?.justVerified, setFocus]);

  const onSubmit = form.handleSubmit(async (values) => {
    // The schema has already trimmed and lowercased the email, exactly like registration.
    try {
      await login.mutateAsync({ email: values.email, password: values.password });
    } catch (error) {
      if (!(error instanceof ApiError)) return;
      if (error.code === 'validation_error') {
        error.fieldErrors.forEach((field) => {
          const name = FORM_FIELDS.find((candidate) => candidate === field.field);
          if (name) form.setError(name, { message: field.message });
        });
      } else if (error.status === 429) {
        setRetryIn(error.retryAfterSeconds ?? 60);
      }
    }
    // On success the session store and the cached user change, and RequireGuest leaves /login (to ?next= or home).
  });

  return (
    <AuthPage
      title={t('auth.login.title')}
      lead={t('auth.login.lead')}
      footer={<AuthSwitch question={t('auth.login.noAccount')} to="/register" link={t('auth.login.createAccount')} />}
    >
      {handover?.justVerified || endedReason || !available ? (
        <div className="mb-5 space-y-2.5">
          {handover?.justVerified ? (
            <Alert tone="success" title={t('auth.verify.successTitle')}>
              {t('auth.login.verifiedNext')}
            </Alert>
          ) : null}
          {endedReason ? (
            <Alert tone="warning" title={t('auth.login.sessionEnded')}>
              {t(`errors.${endedReason}`, { defaultValue: t('errors.token_invalid') })}
            </Alert>
          ) : null}
          {!available ? <MethodUnavailable method="password_login" meta={meta} /> : null}
        </div>
      ) : null}

      <AuthForm onSubmit={onSubmit}>
        <FormField size="lg" label={t('auth.fields.email')} error={message(errors.email?.message)}>
          <Input size="lg" type="email" inputMode="email" autoComplete="username" placeholder="name@company.tj" {...form.register('email')} />
        </FormField>
        <FormField
          size="lg"
          label={t('auth.fields.password')}
          error={message(errors.password?.message)}
          action={
            <Link to="/forgot-password" className="link-grow text-label font-semibold text-primary hover:text-primary-hover">
              {t('auth.login.forgot')}
            </Link>
          }
        >
          <PasswordInput size="lg" autoComplete="current-password" {...form.register('password')} />
        </FormField>
        {formError ? <LoginError error={formError} email={form.getValues('email').trim().toLowerCase()} /> : null}
        <Button
          type="submit"
          block
          size="xl"
          disabled={!available || retryIn > 0}
          loading={meta.isPending || login.isPending || login.isSuccess}
        >
          {retryIn > 0 ? t('auth.login.retryIn', { seconds: retryIn }) : t('auth.login.submit')}
        </Button>
        {retryIn > 0 ? <p className="text-label text-muted-foreground">{t('auth.login.lockoutHint')}</p> : null}
      </AuthForm>

      <OrDivider className="my-5" />
      <GoogleButton />
    </AuthPage>
  );
}
