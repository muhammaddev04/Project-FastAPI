import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Check, Mail, MessageSquareText, Phone, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { OrgTypeChoice } from '@/features/onboarding/org-type-choice';
import { currentLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/cn';
import { Button, FormField, Input, PasswordInput, Select } from '@/shared/ui';
import { AuthLayout } from './auth-layout';
import { MethodUnavailable } from './availability';
import { useAuthMethod } from './use-auth-method';
import { GoogleButton, OrDivider } from './google-button';
import { PasswordChecklist } from './password-checklist';
import { REGISTER_STEPS, registerSchema, type RegisterValues } from './schemas';

type StepId = (typeof REGISTER_STEPS)[number]['id'] | 'review';
const ORDER: StepId[] = ['business', 'details', 'security', 'review'];

function Stepper({ current }: { current: StepId }) {
  const { t } = useTranslation();
  const index = ORDER.indexOf(current);
  return (
    <ol className="mb-6 grid grid-cols-4 gap-2" aria-label={t('auth.register.progress', { step: index + 1, total: ORDER.length })}>
      {ORDER.map((step, position) => (
        <li key={step} aria-current={position === index ? 'step' : undefined}>
          <span
            className={cn(
              'block h-1 rounded-full transition-colors',
              position < index ? 'bg-primary' : position === index ? 'bg-primary/60' : 'bg-muted',
            )}
          />
          <span
            className={cn(
              'mt-1.5 hidden text-2xs font-medium sm:block',
              position <= index ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {t(`auth.register.steps.${step}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  const { available, meta } = useAuthMethod('registration');
  const [step, setStep] = useState<StepId>('business');
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    shouldUnregister: false,
    defaultValues: {
      orgType: 'COMPANY',
      orgName: '',
      fullName: '',
      phone: '+992 ',
      email: '',
      language: currentLanguage(),
      password: '',
      confirmPassword: '',
    },
  });
  const errors = form.formState.errors;
  const values = form.watch();
  const message = (key?: string) => (key ? t(key) : undefined);

  async function next() {
    const definition = REGISTER_STEPS.find((item) => item.id === step);
    if (definition && !(await form.trigger(definition.fields, { shouldFocus: true }))) return;
    setStep(ORDER[ORDER.indexOf(step) + 1] ?? 'review');
  }
  const back = () => setStep(ORDER[ORDER.indexOf(step) - 1] ?? 'business');

  return (
    <AuthLayout
      title={t('auth.register.title')}
      subtitle={t(`auth.register.subtitles.${step}`)}
      footer={
        <>
          {t('auth.register.haveAccount')}{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            {t('auth.register.signIn')}
          </Link>
        </>
      }
    >
      <Stepper current={step} />
      {!available ? <MethodUnavailable method="registration" meta={meta} /> : null}

      {/* Account creation (SMS/e-mail verification, then session) is wired by the deferred P01 flow. */}
      <form className="mt-5 space-y-4" noValidate onSubmit={(event) => event.preventDefault()}>
        {step === 'business' ? (
          <>
            <OrgTypeChoice selected={values.orgType} field={form.register('orgType')} legend={t('auth.register.typeLegend')} compact />
            <FormField
              label={values.orgType === 'COMPANY' ? t('onboarding.companyName') : t('onboarding.storeName')}
              hint={t('onboarding.nameHint')}
              error={message(errors.orgName?.message)}
            >
              <Input autoComplete="organization" {...form.register('orgName')} />
            </FormField>
          </>
        ) : null}

        {step === 'details' ? (
          <>
            <FormField label={t('auth.fields.fullName')} error={message(errors.fullName?.message)}>
              <Input autoComplete="name" leading={<UserRound />} {...form.register('fullName')} />
            </FormField>
            <FormField
              label={t('auth.fields.phone')}
              hint={t('auth.register.phoneHint')}
              error={message(errors.phone?.message)}
            >
              <Input type="tel" inputMode="tel" autoComplete="tel" leading={<Phone />} {...form.register('phone')} />
            </FormField>
            <FormField
              label={
                <>
                  {t('auth.fields.email')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
                </>
              }
              hint={t('auth.register.emailHint')}
              error={message(errors.email?.message)}
            >
              <Input type="email" autoComplete="email" leading={<Mail />} {...form.register('email')} />
            </FormField>
            <FormField label={t('auth.fields.language')}>
              <Select {...form.register('language')}>
                <option value="tg">{t('languages.tg')}</option>
                <option value="ru">{t('languages.ru')}</option>
                <option value="en">{t('languages.en')}</option>
              </Select>
            </FormField>
          </>
        ) : null}

        {step === 'security' ? (
          <>
            <FormField label={t('auth.fields.newPassword')} error={message(errors.password?.message)}>
              <PasswordInput autoComplete="new-password" {...form.register('password')} />
            </FormField>
            <PasswordChecklist password={values.password} />
            <FormField label={t('auth.fields.confirmPassword')} error={message(errors.confirmPassword?.message)}>
              <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
            </FormField>
            <p className="text-[0.8125rem] text-muted-foreground">{t('auth.register.commonNote')}</p>
          </>
        ) : null}

        {step === 'review' ? (
          <div className="space-y-4">
            <dl className="divide-y rounded-lg border bg-surface text-[0.8125rem] shadow-card">
              {[
                [t('auth.register.review.organization'), `${values.orgName} · ${t(`orgTypes.${values.orgType}`)}`],
                [t('auth.fields.fullName'), values.fullName],
                [t('auth.fields.phone'), values.phone.replace(/\s/g, '')],
                [t('auth.fields.email'), values.email || '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 px-4 py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="truncate text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="rounded-lg border bg-subtle px-4 py-3">
              <p className="text-[0.8125rem] font-medium">{t('auth.register.review.nextTitle')}</p>
              <ul className="mt-2 space-y-1.5 text-[0.8125rem] text-muted-foreground">
                <li className="flex gap-2">
                  <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t('auth.register.review.sms', { phone: values.phone.replace(/\s/g, '') })}
                </li>
                {values.email ? (
                  <li className="flex gap-2">
                    <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {t('auth.register.review.email', { email: values.email })}
                  </li>
                ) : null}
                <li className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t('auth.register.review.owner', { type: t(`orgTypes.${values.orgType}`) })}
                </li>
              </ul>
            </div>
          </div>
        ) : null}

        <div className="flex gap-3 pt-2">
          {step !== 'business' ? (
            <Button type="button" variant="secondary" size="lg" onClick={back}>
              <ArrowLeft /> {t('common.back')}
            </Button>
          ) : null}
          {step === 'review' ? (
            <Button type="submit" size="lg" className="flex-1" disabled={!available}>
              {t('auth.register.submit')}
            </Button>
          ) : (
            <Button type="button" size="lg" className="flex-1" onClick={() => void next()}>
              {t('common.continue')}
            </Button>
          )}
        </div>
      </form>

      {step === 'business' ? (
        <>
          <OrDivider />
          <GoogleButton />
        </>
      ) : null}
    </AuthLayout>
  );
}
