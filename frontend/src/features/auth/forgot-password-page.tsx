import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button, FormField, Input } from '@/shared/ui';
import { AuthCard, CardSwitch, authLabel, authPrimaryButton } from './auth-layout';
import { MethodUnavailable } from './availability';
import { forgotPasswordSchema, type ForgotPasswordValues } from './schemas';
import { useAuthMethod } from './use-auth-method';

/**
 * CR-001 /forgot-password: request a reset link by email. Once enabled, the server always answers the same way
 * whether or not the email is registered (no account enumeration).
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { available, meta } = useAuthMethod('password_reset');
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  });
  const error = form.formState.errors.email?.message;

  return (
    <AuthCard title={t('auth.forgot.title')}>
      <p className="-mt-2 mb-5 text-[0.8125rem] text-muted-foreground">{t('auth.forgot.subtitle')}</p>
      {!available ? (
        <div className="mb-5">
          <MethodUnavailable method="password_reset" meta={meta} />
        </div>
      ) : null}
      {/* The reset request is wired by the deferred P01 reset flow; nothing is sent until it is enabled. */}
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit(() => undefined)}>
        <FormField labelClassName={authLabel} label={t('auth.fields.email')} hint={t('auth.forgot.emailHint')} error={error && t(error)}>
          <Input variant="outline" type="email" inputMode="email" autoComplete="email" placeholder="name@company.tj" {...form.register('email')} />
        </FormField>
        <Button type="submit" block className={`!mt-6 ${authPrimaryButton}`} disabled={!available} loading={meta.isPending}>
          {t('auth.forgot.submit')}
        </Button>
      </form>
      <CardSwitch question={t('auth.reset.remembered')} to="/login" link={t('auth.register.signIn')} />
    </AuthCard>
  );
}
