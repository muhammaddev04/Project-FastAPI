import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { useSessionStore } from '@/shared/auth/session-store';
import { Alert, Button, FormField, Input, PasswordInput } from '@/shared/ui';
import { useLogin } from './api';
import { AuthCard, BrandTitle, CardSwitch, authLabel, authPrimaryButton } from './auth-layout';
import { MethodUnavailable } from './availability';
import { GoogleButton, OrDivider } from './google-button';
import { loginSchema, type LoginValues } from './schemas';
import { useAuthMethod } from './use-auth-method';
import { useCountdown } from './use-countdown';
import type { VerifyEmailState } from './verify-email-page';

const FORM_FIELDS = ['email', 'password'] as const;

/** Why the last attempt failed, shown above the button; field problems go to the fields instead. */
function LoginError({ error, email }: { error: unknown; email: string }) {
  const { t } = useTranslation();
  if (error instanceof ApiError && error.code === 'email_not_verified') {
    const state: VerifyEmailState = { email };
    return (
      <Alert tone="warning" title={t('auth.login.notVerifiedTitle')}>
        <p>{t('errors.email_not_verified')}</p>
        <Link to="/verify-email" state={state} className="link-grow mt-1 inline-block font-semibold text-primary hover:text-primary-hover">
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

export function LoginPage() {
  const { t } = useTranslation();
  const endedReason = useSessionStore((state) => state.endedReason);
  const { available, meta } = useAuthMethod('password_login');
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  });
  const errors = form.formState.errors;
  const login = useLogin();
  const [retryIn, setRetryIn] = useCountdown();
  // Client rules are translation keys; server validation messages arrive already translated (Accept-Language).
  const message = (key?: string) => (key ? (key.startsWith('validation.') ? t(key) : key) : undefined);
  const formError = login.error instanceof ApiError && login.error.code === 'validation_error' ? null : login.error;

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
    <AuthCard title={<BrandTitle i18nKey="auth.shell.loginTitle" />} subtitle={t('auth.shell.loginSubtitle')} tabs>
      {endedReason || !available ? (
        <div className="mb-4 space-y-2 short:mb-3">
          {endedReason ? (
            <Alert tone="warning" title={t('auth.login.sessionEnded')}>
              {t(`errors.${endedReason}`, { defaultValue: t('errors.token_invalid') })}
            </Alert>
          ) : null}
          {!available ? <MethodUnavailable method="password_login" meta={meta} /> : null}
        </div>
      ) : null}

      <form className="space-y-4 short:space-y-2.5" noValidate onSubmit={onSubmit}>
        <FormField labelClassName={authLabel} label={t('auth.fields.email')} error={message(errors.email?.message)}>
          <Input
            variant="auth"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder="name@company.tj"
            leading={<Mail />}
            {...form.register('email')}
          />
        </FormField>
        <FormField
          labelClassName={authLabel}
          label={t('auth.fields.password')}
          error={message(errors.password?.message)}
          action={
            <Link to="/forgot-password" className="link-grow text-[0.875rem] font-semibold text-primary hover:text-primary-hover">
              {t('auth.login.forgot')}
            </Link>
          }
        >
          <PasswordInput variant="auth" placeholder={t('auth.login.passwordPlaceholder')} autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <p className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
          {t('auth.login.lockoutHint')}
        </p>
        {formError ? <LoginError error={formError} email={form.getValues('email').trim().toLowerCase()} /> : null}
        <Button
          type="submit"
          block
          className={authPrimaryButton}
          disabled={!available || retryIn > 0}
          loading={meta.isPending || login.isPending || login.isSuccess}
        >
          {retryIn > 0 ? t('auth.login.retryIn', { seconds: retryIn }) : t('auth.login.submit')}
          {retryIn > 0 ? null : <ArrowRight className="transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />}
        </Button>
      </form>

      <OrDivider />
      <GoogleButton />
      <CardSwitch question={t('auth.login.noAccount')} to="/register" link={t('auth.login.createAccount')} />
    </AuthCard>
  );
}
