import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Smartphone } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, FormField, Input } from '@/shared/ui';
import { AuthCard, AuthFrame, AuthHero } from './auth-layout';
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
    <AuthFrame>
      <AuthHero title={t('auth.reset.title')} subtitle={t('auth.reset.subtitle')} />
      <AuthCard>
        {!available ? <MethodUnavailable method="password_reset" meta={meta} /> : null}
        <form className="mt-6 space-y-6" noValidate onSubmit={form.handleSubmit(() => undefined)}>
          <FormField
            label={t('auth.fields.phone')}
            hint={t('auth.reset.phoneHint')}
            error={error && t(error)}
            action={<span className="font-data text-[0.8125rem] text-muted-foreground">TJ (+992)</span>}
          >
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="900 12 34 56"
              data
              addon={
                <>
                  <Smartphone /> +992
                </>
              }
              {...form.register('phone')}
            />
          </FormField>
          <Button type="submit" block size="xl" disabled={!available}>
            {t('auth.reset.submit')} <ArrowRight />
          </Button>
        </form>
      </AuthCard>
      <p className="mt-6 text-center">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-[1.0625rem] font-semibold text-primary hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" /> {t('auth.reset.back')}
        </Link>
      </p>
    </AuthFrame>
  );
}
