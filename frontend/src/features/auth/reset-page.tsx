import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Phone } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, FormField, Input } from '@/shared/ui';
import { AuthLayout } from './auth-layout';
import { MethodUnavailable } from './availability';
import { useAuthMethod } from './use-auth-method';
import { resetSchema, type ResetValues } from './schemas';

/** P01 §10 /reset (3 steps: phone -> SMS code -> new password). Steps 2-3 arrive with the deferred reset flow. */
export function ResetPage() {
  const { t } = useTranslation();
  const { available, meta } = useAuthMethod('password_reset');
  const form = useForm<ResetValues>({ resolver: zodResolver(resetSchema), mode: 'onTouched', defaultValues: { phone: '+992 ' } });
  const error = form.formState.errors.phone?.message;

  return (
    <AuthLayout
      title={t('auth.reset.title')}
      subtitle={t('auth.reset.subtitle')}
      footer={
        <Link to="/login" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
          <ArrowLeft className="size-3.5" aria-hidden="true" /> {t('auth.reset.back')}
        </Link>
      }
    >
      {!available ? <MethodUnavailable method="password_reset" meta={meta} /> : null}
      <form className="mt-5 space-y-4" noValidate onSubmit={form.handleSubmit(() => undefined)}>
        <FormField label={t('auth.fields.phone')} hint={t('auth.reset.phoneHint')} error={error && t(error)}>
          <Input type="tel" inputMode="tel" autoComplete="tel" leading={<Phone />} {...form.register('phone')} />
        </FormField>
        <Button type="submit" block size="lg" disabled={!available}>
          {t('auth.reset.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
