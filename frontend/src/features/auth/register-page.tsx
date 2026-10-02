import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Building2, Store } from 'lucide-react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { currentLanguage } from '@/shared/i18n';
import { Alert, Button, Checkbox, CheckboxField, ChoiceCard, ChoiceGroup, FormField, Input, PasswordInput } from '@/shared/ui';
import { useRegister } from './api';
import { GoogleButton, OrDivider } from './google-button';
import { AuthCard, BrandTitle, CardSwitch, authLabel } from './auth-layout';
import { MethodUnavailable } from './availability';
import { PasswordChecklist } from './password-checklist';
import { PASSWORD_PROBLEMS, registerSchema, type RegisterValues } from './schemas';
import { useAuthMethod } from './use-auth-method';
import type { VerifyEmailState } from './verify-email-page';

/** Server field names of RegisterRequest → form fields. */
const SERVER_FIELDS: Record<string, 'email' | 'password' | 'fullName'> = {
  email: 'email',
  password: 'password',
  full_name: 'fullName',
};

/**
 * Store / Company choice with the TZ commercial terms (Store free, Company trial).
 *
 * This was 40 lines of hand-rolled tile markup, a second implementation of the same decision that
 * `/welcome` already renders, and the only place in the product that hardcoded `#0B7D72` instead of using
 * the primary token. It now composes the shared choice primitive.
 */
function RoleChoice({ selected, field }: { selected: RegisterValues['orgType']; field: UseFormRegisterReturn }) {
  const { t } = useTranslation();
  const options = [
    { type: 'STORE' as const, icon: Store, badge: t('auth.register.storeBadge') },
    { type: 'COMPANY' as const, icon: Building2, badge: t('auth.register.companyBadge') },
  ];
  return (
    <ChoiceGroup legend={t('auth.register.typeLegend')} className="min-[360px]:grid-cols-2">
      {options.map(({ type, icon, badge }) => (
        <ChoiceCard
          key={type}
          compact
          field={field}
          value={type}
          selected={selected === type}
          icon={icon}
          title={t(`auth.register.roles.${type}.title`)}
          badge={badge}
        />
      ))}
    </ChoiceGroup>
  );
}

/** What happens after the form: email confirmation → organization review → approval (TZ P01/P02). */
function NextSteps() {
  const { t } = useTranslation();
  const steps = [t('auth.shell.flowEmail'), t('auth.shell.flowReview'), t('auth.shell.flowAccess')];
  return (
    <div className="rounded-2xl bg-subtle/60 px-3.5 py-2.5 short:flex short:items-center short:gap-3 short:py-2">
      <p className="shrink-0 text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground short:hidden short:sm:block short:sm:max-w-[6.5rem] short:sm:leading-tight">
        {t('auth.shell.flowTitle')}
      </p>
      <ol className="mt-1.5 grid flex-1 grid-cols-1 gap-1.5 min-[420px]:grid-cols-3 min-[420px]:gap-2 short:mt-0 text-caption font-medium leading-tight sm:text-label">
        {steps.map((step, index) => (
          <li key={step} className="flex items-start gap-1.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-micro font-bold text-primary-ink">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Short registration (one screen): only what creating the account and starting the organization review needs.
 * The full company/store profile, documents and team come later, after email confirmation.
 */
export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { available, meta } = useAuthMethod('registration');
  const registration = useRegister();
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    defaultValues: {
      orgType: 'STORE',
      orgName: '',
      fullName: '',
      email: '',
      password: '',
      acceptTerms: false as unknown as true,
    },
  });
  const errors = form.formState.errors;
  const orgType = form.watch('orgType');
  const password = form.watch('password');
  // Client rules are translation keys; server validation messages arrive already translated (Accept-Language).
  const message = (key?: string) => (key ? (key.startsWith('validation.') ? t(key) : key) : undefined);
  // Field problems are shown on the fields; anything else (rate limit, email delivery, network) in one alert.
  const formError =
    registration.error instanceof ApiError && ['weak_password', 'validation_error'].includes(registration.error.code) ? null : registration.error;

  const onSubmit = form.handleSubmit(async (values) => {
    // P01 §10: the Company/Store choice and organization name are remembered by the server as the onboarding intent;
    // registration itself creates only the user (IAM-001).
    const payload = {
      email: values.email,
      password: values.password,
      full_name: values.fullName.trim(),
      language: currentLanguage(),
      org_type: values.orgType,
      org_name: values.orgName.trim(),
    };
    try {
      await registration.mutateAsync(payload);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'weak_password') {
        const problem = error.fieldErrors.map((field) => PASSWORD_PROBLEMS[field.code]).find(Boolean);
        form.setError('password', { message: problem ?? 'validation.passwordLetterDigit' }, { shouldFocus: true });
      } else if (error instanceof ApiError && error.code === 'validation_error') {
        error.fieldErrors.forEach((field) => {
          const name = SERVER_FIELDS[field.field];
          if (name) form.setError(name, { message: field.message });
        });
      }
      return;
    }
    // 202 says nothing about whether the address was new (IAM-001); the next screen only needs it to resend.
    const state: VerifyEmailState = { email: payload.email, justRegistered: true };
    navigate('/verify-email', { state });
  });

  return (
    <AuthCard title={<BrandTitle i18nKey="auth.shell.registerTitle" />} subtitle={t('auth.shell.registerSubtitle')} tabs>
      {!available ? (
        <div className="mb-4 short:mb-3">
          <MethodUnavailable method="registration" meta={meta} />
        </div>
      ) : null}

      <form className="space-y-4 short:space-y-2.5" noValidate onSubmit={onSubmit}>
        <RoleChoice selected={orgType} field={form.register('orgType')} />
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-3 short:gap-2.5">
          <FormField
            labelClassName={authLabel}
            label={orgType === 'COMPANY' ? t('onboarding.companyName') : t('onboarding.storeName')}
            error={message(errors.orgName?.message)}
          >
            <Input size="lg" autoComplete="organization" {...form.register('orgName')} />
          </FormField>
          <FormField labelClassName={authLabel} label={t('auth.fields.fullName')} error={message(errors.fullName?.message)}>
            <Input size="lg" autoComplete="name" placeholder={t('auth.register.namePlaceholder')} {...form.register('fullName')} />
          </FormField>
        </div>
        <FormField labelClassName={authLabel} label={t('auth.fields.email')} hint={t('auth.register.emailHint')} error={message(errors.email?.message)}>
          <Input size="lg" type="email" inputMode="email" autoComplete="email" placeholder="name@company.tj" {...form.register('email')} />
        </FormField>
        <div className="space-y-2">
          <FormField labelClassName={authLabel} label={t('auth.fields.newPassword')} error={message(errors.password?.message)}>
            <PasswordInput size="lg" placeholder={t('auth.login.passwordPlaceholder')} autoComplete="new-password" {...form.register('password')} />
          </FormField>
          <AnimatePresence initial={false}>
            {password ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <PasswordChecklist password={password} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
        <CheckboxField
          control={<Checkbox {...form.register('acceptTerms')} />}
          error={errors.acceptTerms?.message ? t(errors.acceptTerms.message) : undefined}
        >
          {t('auth.register.terms')}
        </CheckboxField>
        <NextSteps />
        {formError ? (
          <Alert tone="danger" title={t('auth.register.failed')}>
            {errorMessage(formError, t)}
          </Alert>
        ) : null}
        <Button type="submit" block size="xl" disabled={!available} loading={meta.isPending || registration.isPending}>
          {t('auth.register.submit')}
          <ArrowRight className="transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
        </Button>
      </form>

      <OrDivider />
      <GoogleButton />
      <CardSwitch question={t('auth.register.haveAccount')} to="/login" link={t('auth.register.signIn')} />
    </AuthCard>
  );
}
