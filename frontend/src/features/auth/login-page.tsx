import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useSessionStore } from '@/shared/auth/session-store';
import { Alert, Button, FormField, Input, PasswordInput } from '@/shared/ui';
import { AuthCard, CardSwitch, authLabel, authPrimaryButton } from './auth-layout';
import { MethodUnavailable } from './availability';
import { GoogleButton } from './google-button';
import { loginSchema, type LoginValues } from './schemas';
import { useAuthMethod } from './use-auth-method';

export function LoginPage() {
  const { t } = useTranslation();
  const endedReason = useSessionStore((state) => state.endedReason);
  const { available, meta } = useAuthMethod('password_login');
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { phone: '', password: '' },
  });
  const errors = form.formState.errors;

  return (
    <AuthCard title={t('auth.login.title')}>
      {endedReason || !available ? (
        <div className="mb-5 space-y-2">
          {endedReason ? (
            <Alert tone="warning" title={t('auth.login.sessionEnded')}>
              {t(`errors.${endedReason}`, { defaultValue: t('errors.token_invalid') })}
            </Alert>
          ) : null}
          {!available ? <MethodUnavailable method="password_login" meta={meta} /> : null}
        </div>
      ) : null}

      {/* Submission is wired by the P01 session service; until it is enabled no credentials are sent anywhere. */}
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit(() => undefined)}>
        <FormField labelClassName={authLabel} label={t('auth.fields.phone')} error={errors.phone?.message && t(errors.phone.message)}>
          <Input
            variant="outline"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="900 12 34 56"
            data
            addon="+992"
            {...form.register('phone')}
          />
        </FormField>
        <FormField
          labelClassName={authLabel}
          label={t('auth.fields.password')}
          error={errors.password?.message && t(errors.password.message)}
          action={
            <Link to="/reset" className="link-grow text-[0.8125rem] font-medium text-primary hover:text-primary-hover">
              {t('auth.login.forgot')}
            </Link>
          }
        >
          <PasswordInput variant="outline" placeholder={t('auth.login.passwordPlaceholder')} autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <Button type="submit" block className={`!mt-6 ${authPrimaryButton}`} disabled={!available} loading={meta.isPending}>
          {t('auth.login.submit')}
        </Button>
        <p className="text-center text-[0.75rem] text-muted-foreground">{t('auth.login.lockoutHint')}</p>
      </form>

      <div className="mt-4">
        <GoogleButton />
      </div>
      <CardSwitch question={t('auth.login.noAccount')} to="/register" link={t('auth.login.createAccount')} />
    </AuthCard>
  );
}
