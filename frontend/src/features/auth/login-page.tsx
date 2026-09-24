import { zodResolver } from '@hookform/resolvers/zod';
import { Phone } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useSessionStore } from '@/shared/auth/session-store';
import { Alert, Button, FormField, Input, PasswordInput } from '@/shared/ui';
import { AuthLayout } from './auth-layout';
import { MethodUnavailable } from './availability';
import { useAuthMethod } from './use-auth-method';
import { GoogleButton, OrDivider } from './google-button';
import { loginSchema, type LoginValues } from './schemas';

export function LoginPage() {
  const { t } = useTranslation();
  const endedReason = useSessionStore((state) => state.endedReason);
  const { available, meta } = useAuthMethod('password_login');
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { phone: '+992 ', password: '' },
  });
  const errors = form.formState.errors;

  return (
    <AuthLayout
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      footer={
        <>
          {t('auth.login.noAccount')}{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            {t('auth.login.createAccount')}
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        {endedReason ? (
          <Alert tone="warning" title={t('auth.login.sessionEnded')}>
            {t(`errors.${endedReason}`, { defaultValue: t('errors.token_invalid') })}
          </Alert>
        ) : null}
        {!available ? <MethodUnavailable method="password_login" meta={meta} /> : null}
      </div>

      {/* Submission is wired by the P01 session service; until it is enabled no credentials are sent anywhere. */}
      <form className="mt-5 space-y-4" noValidate onSubmit={form.handleSubmit(() => undefined)}>
        <FormField label={t('auth.fields.phone')} error={errors.phone?.message && t(errors.phone.message)}>
          <Input type="tel" inputMode="tel" autoComplete="tel" leading={<Phone />} {...form.register('phone')} />
        </FormField>
        <FormField
          label={t('auth.fields.password')}
          error={errors.password?.message && t(errors.password.message)}
          action={
            <Link to="/reset" className="text-[0.8125rem] font-medium text-primary hover:underline">
              {t('auth.login.forgot')}
            </Link>
          }
        >
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <Button type="submit" block size="lg" disabled={!available}>
          {t('auth.login.submit')}
        </Button>
      </form>

      <OrDivider />
      <GoogleButton />
    </AuthLayout>
  );
}
