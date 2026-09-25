import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Alert, Button, FormField, PasswordInput } from '@/shared/ui';
import { AuthCard, CardSwitch, authLabel, authPrimaryButton } from './auth-layout';
import { MethodUnavailable } from './availability';
import { PasswordChecklist } from './password-checklist';
import { resetPasswordSchema, type ResetPasswordValues } from './schemas';
import { useAuthMethod } from './use-auth-method';
import { useLinkToken } from './use-link-token';

/**
 * CR-001 /reset-password?token=…: choose a new password with a one-time link from email. The token is validated by
 * the server (deferred reset flow); here it is only checked for presence and never shown or logged.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const token = useLinkToken();
  const { available, meta } = useAuthMethod('password_reset');
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onTouched',
    defaultValues: { password: '', confirmPassword: '' },
  });
  const errors = form.formState.errors;
  const password = form.watch('password');

  if (!token) {
    return (
      <AuthCard title={t('auth.resetPassword.title')}>
        <Alert tone="danger" title={t('auth.resetPassword.invalidTitle')}>
          {t('auth.resetPassword.invalidText')}
        </Alert>
        <Button asChild block className={`mt-5 ${authPrimaryButton}`}>
          <Link to="/forgot-password">{t('auth.resetPassword.requestNew')}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.resetPassword.title')}>
      <p className="-mt-2 mb-5 text-[0.8125rem] text-muted-foreground">{t('auth.resetPassword.subtitle')}</p>
      {!available ? (
        <div className="mb-5">
          <MethodUnavailable method="password_reset" meta={meta} />
        </div>
      ) : null}
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit(() => undefined)}>
        <div className="space-y-2">
          <FormField labelClassName={authLabel} label={t('auth.fields.newPassword')} error={errors.password?.message && t(errors.password.message)}>
            <PasswordInput variant="outline" autoComplete="new-password" {...form.register('password')} />
          </FormField>
          <PasswordChecklist password={password} />
        </div>
        <FormField
          labelClassName={authLabel}
          label={t('auth.fields.confirmPassword')}
          error={errors.confirmPassword?.message && t(errors.confirmPassword.message)}
        >
          <PasswordInput variant="outline" autoComplete="new-password" {...form.register('confirmPassword')} />
        </FormField>
        <p className="text-[0.75rem] text-muted-foreground">{t('auth.resetPassword.signOutNote')}</p>
        <Button type="submit" block className={`!mt-6 ${authPrimaryButton}`} disabled={!available} loading={meta.isPending}>
          {t('auth.resetPassword.submit')}
        </Button>
      </form>
      <CardSwitch question={t('auth.reset.remembered')} to="/login" link={t('auth.register.signIn')} />
    </AuthCard>
  );
}
