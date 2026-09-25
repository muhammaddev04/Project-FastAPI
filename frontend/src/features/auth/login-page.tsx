import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useSessionStore } from '@/shared/auth/session-store';
import { Alert, Button, FormField, Input, PasswordInput } from '@/shared/ui';
import { AuthCard, BrandTitle, CardSwitch, authLabel, authPrimaryButton } from './auth-layout';
import { MethodUnavailable } from './availability';
import { GoogleButton, OrDivider } from './google-button';
import { loginSchema, type LoginValues } from './schemas';
import { useAuthMethod } from './use-auth-method';

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

      {/* Submission is wired by the P01 session service; until it is enabled no credentials are sent anywhere. */}
      <form className="space-y-4 short:space-y-2.5" noValidate onSubmit={form.handleSubmit(() => undefined)}>
        <FormField labelClassName={authLabel} label={t('auth.fields.email')} error={errors.email?.message && t(errors.email.message)}>
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
          error={errors.password?.message && t(errors.password.message)}
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
        <Button type="submit" block className={authPrimaryButton} disabled={!available} loading={meta.isPending}>
          {t('auth.login.submit')}
          <ArrowRight className="transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
        </Button>
      </form>

      <OrDivider />
      <GoogleButton />
      <CardSwitch question={t('auth.login.noAccount')} to="/register" link={t('auth.login.createAccount')} />
    </AuthCard>
  );
}
