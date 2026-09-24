import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, BriefcaseBusiness, LockKeyhole, ShieldCheck, Smartphone } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useSessionStore } from '@/shared/auth/session-store';
import { Alert, Button, FormField, Input, PasswordInput } from '@/shared/ui';
import { AuthCard, AuthFrame, AuthHero, NoticeRow } from './auth-layout';
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
    defaultValues: { phone: '', password: '' },
  });
  const errors = form.formState.errors;

  return (
    <AuthFrame>
      <AuthHero title={t('auth.login.title')} subtitle={t('auth.login.subtitle')} />
      <AuthCard>
        <div className="space-y-3">
          <NoticeRow icon={<BriefcaseBusiness />} title={t('auth.login.accessTitle')}>
            {t('auth.login.accessText')}
          </NoticeRow>
          {endedReason ? (
            <Alert tone="warning" title={t('auth.login.sessionEnded')}>
              {t(`errors.${endedReason}`, { defaultValue: t('errors.token_invalid') })}
            </Alert>
          ) : null}
          {!available ? <MethodUnavailable method="password_login" meta={meta} /> : null}
        </div>

        {/* Submission is wired by the P01 session service; until it is enabled no credentials are sent anywhere. */}
        <form className="mt-6 space-y-6" noValidate onSubmit={form.handleSubmit(() => undefined)}>
          <FormField
            label={t('auth.fields.phone')}
            hint={t('auth.login.phoneHint')}
            error={errors.phone?.message && t(errors.phone.message)}
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
          <FormField
            label={t('auth.fields.password')}
            error={errors.password?.message && t(errors.password.message)}
            action={
              <Link to="/reset" className="text-[0.9375rem] font-semibold text-primary hover:underline">
                {t('auth.login.forgot')}
              </Link>
            }
          >
            <PasswordInput autoComplete="current-password" {...form.register('password')} />
          </FormField>
          <div className="space-y-3">
            <Button type="submit" block size="xl" disabled={!available}>
              {t('auth.login.submit')} <ArrowRight />
            </Button>
            <p className="flex items-center justify-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
              <LockKeyhole className="size-4 text-warning" aria-hidden="true" />
              {t('auth.login.lockoutHint')}
            </p>
          </div>
        </form>

        <OrDivider />
        <GoogleButton />

        <div className="mt-5 flex items-center gap-3 rounded bg-subtle px-4 py-3 text-[0.875rem] font-medium text-muted-foreground">
          <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
          {t('auth.login.securityNote')}
        </div>
      </AuthCard>

      <p className="mt-6 text-center text-[1.0625rem] text-muted-foreground">
        {t('auth.login.noAccount')}{' '}
        <Link to="/register" className="font-semibold text-primary hover:underline">
          {t('auth.login.createAccount')}
        </Link>
      </p>
    </AuthFrame>
  );
}
