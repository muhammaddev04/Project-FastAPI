import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button, FormField, Input } from '@/shared/ui';
import { AuthCard, CardSwitch, authLabel, authPrimaryButton } from './auth-layout';
import { MethodUnavailable } from './availability';
import { resetSchema, type ResetValues } from './schemas';
import { useAuthMethod } from './use-auth-method';

/** P01 §10 /reset (3 steps: phone -> SMS code -> new password). Steps 2-3 arrive with the deferred reset flow. */
export function ResetPage() {
  const { t } = useTranslation();
  const { available, meta } = useAuthMethod('password_reset');
  const form = useForm<ResetValues>({ resolver: zodResolver(resetSchema), mode: 'onTouched', defaultValues: { phone: '' } });
  const error = form.formState.errors.phone?.message;

  return (
    <AuthCard title={t('auth.reset.title')}>
      <p className="-mt-2 mb-5 text-[0.8125rem] text-muted-foreground">{t('auth.reset.subtitle')}</p>
      {!available ? (
        <div className="mb-5">
          <MethodUnavailable method="password_reset" meta={meta} />
        </div>
      ) : null}
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit(() => undefined)}>
        <FormField labelClassName={authLabel} label={t('auth.fields.phone')} hint={t('auth.reset.phoneHint')} error={error && t(error)}>
          <Input variant="outline" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="900 12 34 56" data addon="+992" {...form.register('phone')} />
        </FormField>
        <Button type="submit" block className={`!mt-6 ${authPrimaryButton}`} disabled={!available} loading={meta.isPending}>
          {t('auth.reset.submit')}
        </Button>
      </form>
      <CardSwitch question={t('auth.reset.remembered')} to="/login" link={t('auth.register.signIn')} />
    </AuthCard>
  );
}
