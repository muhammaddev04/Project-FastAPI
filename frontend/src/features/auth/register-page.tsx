import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Building2, Check, Mail, MessageSquareText, Store, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { currentLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/cn';
import { Button, FormField, Input, OtpInput, PasswordInput, Select } from '@/shared/ui';
import { AuthCard, AuthSplit, CardSwitch, authLabel } from './auth-layout';
import { MethodUnavailable } from './availability';
import { GoogleButton, OrDivider } from './google-button';
import { PasswordChecklist } from './password-checklist';
import { REGISTER_STEPS, normalizePhone, registerSchema, type RegisterValues } from './schemas';
import { useAuthMethod } from './use-auth-method';

type StepId = (typeof REGISTER_STEPS)[number]['id'];
const ORDER: StepId[] = REGISTER_STEPS.map((step) => step.id);

function StepMeter({ step }: { step: StepId }) {
  const { t } = useTranslation();
  const index = ORDER.indexOf(step);
  const percent = Math.round(((index + 1) / ORDER.length) * 100);
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between text-[0.75rem] font-medium">
        <span className="text-primary">
          {t('auth.register.stepOf', { step: index + 1, total: ORDER.length, name: t(`auth.register.steps.${step}`) })}
        </span>
        <span className="font-data text-muted-foreground">{percent}%</span>
      </div>
      <div
        className="mt-2 h-1 overflow-hidden rounded-full bg-primary-soft"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t('auth.register.progress', { step: index + 1, total: ORDER.length })}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Store / Company choice as two compact tiles with their TZ commercial terms (Store free, Company trial). */
function RoleChoice({ selected, field }: { selected: RegisterValues['orgType']; field: UseFormRegisterReturn }) {
  const { t } = useTranslation();
  const options = [
    { type: 'STORE' as const, icon: Store, badge: t('auth.register.storeBadge') },
    { type: 'COMPANY' as const, icon: Building2, badge: t('auth.register.companyBadge') },
  ];
  return (
    <fieldset>
      <legend className={cn(authLabel, 'mb-2')}>{t('auth.register.typeLegend')}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map(({ type, icon: Icon, badge }) => {
          const active = selected === type;
          return (
            <label
              key={type}
              className={cn(
                'relative flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2.5 transition-[border-color,box-shadow] focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.14)]',
                active ? 'border-primary/70 bg-primary-soft/40' : 'border-input hover:border-primary/40',
              )}
            >
              <input type="radio" value={type} className="sr-only" {...field} />
              <span className="flex items-center justify-between">
                <Icon className={cn('size-4', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                {active ? <Check className="size-3.5 text-primary" aria-hidden="true" /> : null}
              </span>
              <span className="text-[0.8125rem] font-semibold leading-tight">{t(`auth.register.roles.${type}.title`)}</span>
              <span className="text-[0.6875rem] font-medium text-muted-foreground">{badge}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RegisterPage() {
  const { t } = useTranslation();
  const { available, meta } = useAuthMethod('registration');
  const [step, setStep] = useState<StepId>('account');
  const [code, setCode] = useState('');
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    shouldUnregister: false,
    defaultValues: {
      orgType: 'STORE',
      orgName: '',
      fullName: '',
      phone: '',
      email: '',
      acceptTerms: false as unknown as true,
      language: currentLanguage(),
      password: '',
      confirmPassword: '',
    },
  });
  const errors = form.formState.errors;
  const values = form.watch();
  const message = (key?: string) => (key ? t(key) : undefined);
  const phone = normalizePhone(values.phone);

  async function next() {
    const definition = REGISTER_STEPS.find((item) => item.id === step);
    if (definition && !(await form.trigger(definition.fields, { shouldFocus: true }))) return;
    setStep(ORDER[ORDER.indexOf(step) + 1] ?? 'confirm');
  }
  const back = () => setStep(ORDER[ORDER.indexOf(step) - 1] ?? 'account');

  return (
    <AuthSplit headline={t('auth.split.register.headline')} tagline={[t('auth.split.register.line1'), t('auth.split.register.line2')]}>
      <AuthCard title={t('auth.register.title')}>
        <StepMeter step={step} />
        {!available ? (
          <div className="mb-5">
            <MethodUnavailable method="registration" meta={meta} />
          </div>
        ) : null}

        {/* Account creation (SMS/e-mail verification, then session) is wired by the deferred P01 flow. */}
        <form className="space-y-4" noValidate onSubmit={(event) => event.preventDefault()}>
          {step === 'account' ? (
            <>
              <RoleChoice selected={values.orgType} field={form.register('orgType')} />
              <FormField labelClassName={authLabel} label={t('auth.fields.fullName')} error={message(errors.fullName?.message)}>
                <Input variant="outline" autoComplete="name" placeholder={t('auth.register.namePlaceholder')} {...form.register('fullName')} />
              </FormField>
              <FormField
                labelClassName={authLabel}
                label={t('auth.fields.mobile')}
                hint={t('auth.register.phoneHint')}
                error={message(errors.phone?.message)}
              >
                <Input variant="outline" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="900 12 34 56" data addon="+992" {...form.register('phone')} />
              </FormField>
              <FormField
                labelClassName={authLabel}
                label={
                  <>
                    {t('auth.fields.email')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
                  </>
                }
                error={message(errors.email?.message)}
              >
                <Input variant="outline" type="email" autoComplete="email" placeholder="name@company.tj" {...form.register('email')} />
              </FormField>
              <div className="space-y-2">
                <FormField labelClassName={authLabel} label={t('auth.fields.newPassword')} error={message(errors.password?.message)}>
                  <PasswordInput variant="outline" placeholder={t('auth.login.passwordPlaceholder')} autoComplete="new-password" {...form.register('password')} />
                </FormField>
                <PasswordChecklist password={values.password} />
              </div>
              <FormField labelClassName={authLabel} label={t('auth.fields.confirmPassword')} error={message(errors.confirmPassword?.message)}>
                <PasswordInput variant="outline" autoComplete="new-password" {...form.register('confirmPassword')} />
              </FormField>

              <section className="rounded-md border border-input p-3" aria-labelledby="otp-title">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="otp-title" className="text-[0.8125rem] font-semibold">
                    {t('auth.register.otp.title')}
                  </h2>
                  <span className="text-[0.6875rem] font-medium text-muted-foreground">{t('auth.register.otp.digits')}</span>
                </div>
                <p className="mt-1 text-[0.75rem] text-muted-foreground">
                  {available ? t('auth.register.otp.text') : t('auth.register.otp.disabled')}
                </p>
                <div className="mt-3">
                  <OtpInput value={code} onChange={setCode} disabled={!available} label={t('auth.register.otp.title')} />
                </div>
              </section>

              <div className="space-y-1">
                <label className="flex cursor-pointer items-start gap-2.5 text-[0.75rem] leading-5 text-muted-foreground">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]" {...form.register('acceptTerms')} />
                  <span>{t('auth.register.terms')}</span>
                </label>
                {errors.acceptTerms?.message ? (
                  <p role="alert" className="pl-6 text-[0.75rem] text-danger">
                    {t(errors.acceptTerms.message)}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          {step === 'organization' ? (
            <>
              <FormField
                labelClassName={authLabel}
                label={values.orgType === 'COMPANY' ? t('onboarding.companyName') : t('onboarding.storeName')}
                hint={t('onboarding.nameHint')}
                error={message(errors.orgName?.message)}
              >
                <Input variant="outline" autoComplete="organization" {...form.register('orgName')} />
              </FormField>
              <FormField labelClassName={authLabel} label={t('auth.fields.language')} hint={t('profile.languageHint')}>
                <Select {...form.register('language')}>
                  <option value="tg">{t('languages.tg')}</option>
                  <option value="ru">{t('languages.ru')}</option>
                  <option value="en">{t('languages.en')}</option>
                </Select>
              </FormField>
            </>
          ) : null}

          {step === 'confirm' ? (
            <div className="space-y-3">
              <dl className="divide-y rounded-md border border-input text-[0.8125rem]">
                {[
                  [t('auth.register.review.organization'), `${values.orgName} · ${t(`orgTypes.${values.orgType}`)}`],
                  [t('auth.fields.fullName'), values.fullName],
                  [t('auth.fields.phone'), phone],
                  [t('auth.fields.email'), values.email || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 px-3 py-2.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="truncate text-right font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="rounded-md bg-primary-soft/50 px-3 py-2.5">
                <p className="text-[0.8125rem] font-semibold">{t('auth.register.review.nextTitle')}</p>
                <ul className="mt-1.5 space-y-1 text-[0.75rem] text-muted-foreground">
                  <li className="flex gap-2">
                    <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    {t('auth.register.review.sms', { phone })}
                  </li>
                  {values.email ? (
                    <li className="flex gap-2">
                      <Mail className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                      {t('auth.register.review.email', { email: values.email })}
                    </li>
                  ) : null}
                  <li className="flex gap-2">
                    <UserCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    {t('auth.register.review.owner', { type: t(`orgTypes.${values.orgType}`) })}
                  </li>
                </ul>
              </div>
            </div>
          ) : null}

          <div className="flex gap-2 pt-2">
            {step !== 'account' ? (
              <Button type="button" variant="secondary" className="h-11 rounded-md text-[0.8125rem]" onClick={back}>
                <ArrowLeft /> {t('common.back')}
              </Button>
            ) : null}
            {step === 'confirm' ? (
              <Button type="submit" className="h-11 flex-1 rounded-md text-[0.8125rem]" disabled={!available}>
                {t('auth.register.submit')}
              </Button>
            ) : (
              <Button type="button" className="h-11 flex-1 rounded-md text-[0.8125rem]" onClick={() => void next()}>
                {step === 'account' && available ? t('auth.register.continueSms') : t('common.continue')}
              </Button>
            )}
          </div>
        </form>

        {step === 'account' ? (
          <>
            <OrDivider />
            <GoogleButton />
          </>
        ) : null}
        <CardSwitch question={t('auth.register.haveAccount')} to="/login" link={t('auth.register.signIn')} />
      </AuthCard>
    </AuthSplit>
  );
}
