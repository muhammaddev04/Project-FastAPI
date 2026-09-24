import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Building2, Mail, MessageSquareText, ShieldCheck, Smartphone, Store, UserCheck, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMeta } from '@/shared/api/meta';
import { currentLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/cn';
import { Badge, Button, FormField, Input, OtpInput, PasswordInput, Select } from '@/shared/ui';
import { AuthFrame, LogoTile } from './auth-layout';
import { MethodUnavailable } from './availability';
import { GoogleButton, OrDivider } from './google-button';
import { PasswordChecklist } from './password-checklist';
import { REGISTER_STEPS, normalizePhone, registerSchema, type RegisterValues } from './schemas';
import { useAuthMethod } from './use-auth-method';

type StepId = (typeof REGISTER_STEPS)[number]['id'];
const ORDER: StepId[] = REGISTER_STEPS.map((step) => step.id);

function RequiredMark() {
  return (
    <span className="text-danger" aria-hidden="true">
      {' '}
      *
    </span>
  );
}

/** Tinted header card: brand, API chip, step progress and the serif page title. */
function RegisterHero({ step }: { step: StepId }) {
  const { t } = useTranslation();
  const meta = useMeta();
  const index = ORDER.indexOf(step);
  const percent = Math.round(((index + 1) / ORDER.length) * 100);
  return (
    <section className="relative overflow-hidden rounded-lg bg-gradient-to-br from-subtle via-subtle to-primary-soft/60 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-surface p-1 shadow-raised">
            <LogoTile />
          </span>
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2 py-0.5 font-data text-[0.75rem] font-medium text-muted-foreground">
              <span aria-hidden="true" className={cn('size-1.5 rounded-full', meta.isSuccess ? 'bg-primary' : 'bg-muted-foreground/40')} />
              API · v{meta.data?.version ?? '—'}
            </span>
            <p className="mt-1 text-[0.9375rem] font-medium text-foreground">{t('auth.register.network')}</p>
          </div>
        </div>
        <span className="hidden font-data text-[0.75rem] font-semibold text-muted-foreground sm:block">TJ · TJS</span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-[0.9375rem] font-semibold">
        <span className="text-primary">
          {t('auth.register.stepOf', { step: index + 1, total: ORDER.length, name: t(`auth.register.steps.${step}`) })}
        </span>
        <span className="font-data text-[0.8125rem] text-muted-foreground">{percent}%</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t('auth.register.progress', { step: index + 1, total: ORDER.length })}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <ol className="mt-2 grid grid-cols-3 gap-2 text-[0.8125rem] font-medium">
        {ORDER.map((id, position) => (
          <li
            key={id}
            aria-current={position === index ? 'step' : undefined}
            className={cn(position === index ? 'text-primary' : 'text-muted-foreground', position === 1 && 'text-center', position === 2 && 'text-right')}
          >
            {position + 1}. {t(`auth.register.steps.${id}`)}
          </li>
        ))}
      </ol>

      <h1 className="mt-5 font-display text-[1.75rem] font-bold leading-tight text-foreground sm:text-[2rem]">
        {t('auth.register.title')}
      </h1>
      <p className="mt-1 text-[1.0625rem] leading-7 text-muted-foreground">{t('auth.register.subtitle')}</p>
    </section>
  );
}

function RoleChoice({ selected, field }: { selected: RegisterValues['orgType']; field: UseFormRegisterReturn }) {
  const { t } = useTranslation();
  const options = [
    { type: 'STORE' as const, icon: Store, badge: t('auth.register.storeBadge'), tone: 'accent' as const },
    { type: 'COMPANY' as const, icon: Building2, badge: t('auth.register.companyBadge'), tone: 'warning' as const },
  ];
  return (
    <fieldset>
      <legend className="mb-2 text-[0.9375rem] font-semibold">{t('auth.register.typeLegend')}</legend>
      <div className="space-y-1 rounded-lg bg-subtle p-1.5">
        {options.map(({ type, icon: Icon, badge, tone }) => {
          const active = selected === type;
          return (
            <label
              key={type}
              className={cn(
                'block cursor-pointer rounded-md px-3 py-3 transition-all focus-within:ring-2 focus-within:ring-ring',
                active ? 'bg-surface shadow-raised ring-1 ring-primary/30' : 'hover:bg-surface/60',
              )}
            >
              <input type="radio" value={type} className="sr-only" {...field} />
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[1.0625rem] font-bold">
                  <Icon className={cn('size-5', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                  {t(`auth.register.roles.${type}.title`)}
                </span>
                <Badge tone={tone} className="normal-case tracking-normal text-2xs">
                  {badge}
                </Badge>
              </span>
              <span className="mt-1 block text-[0.9375rem] text-muted-foreground">{t(`auth.register.roles.${type}.description`)}</span>
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
  const phoneDisplay = normalizePhone(values.phone);

  async function next() {
    const definition = REGISTER_STEPS.find((item) => item.id === step);
    if (definition && !(await form.trigger(definition.fields, { shouldFocus: true }))) return;
    setStep(ORDER[ORDER.indexOf(step) + 1] ?? 'confirm');
  }
  const back = () => setStep(ORDER[ORDER.indexOf(step) - 1] ?? 'account');

  return (
    <AuthFrame width="narrow">
      <div className="space-y-6 pt-2">
        <RegisterHero step={step} />
        {!available ? <MethodUnavailable method="registration" meta={meta} /> : null}

        {/* Account creation (SMS/e-mail verification, then session) is wired by the deferred P01 flow. */}
        <form className="space-y-6" noValidate onSubmit={(event) => event.preventDefault()}>
          {step === 'account' ? (
            <>
              <RoleChoice selected={values.orgType} field={form.register('orgType')} />
              <div>
                <OrDivider label={t('auth.register.orNetworks')} />
                <GoogleButton />
              </div>
              <FormField label={<>{t('auth.fields.fullName')}<RequiredMark /></>} error={message(errors.fullName?.message)}>
                <Input autoComplete="name" leading={<UserRound />} placeholder={t('auth.register.namePlaceholder')} {...form.register('fullName')} />
              </FormField>
              <FormField
                label={<>{t('auth.fields.mobile')}<RequiredMark /></>}
                action={<span className="font-data text-[0.8125rem] font-semibold text-primary">TJ (+992)</span>}
                hint={
                  <span className="flex gap-1.5">
                    <MessageSquareText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    {t('auth.register.phoneHint')}
                  </span>
                }
                error={message(errors.phone?.message)}
              >
                <Input type="tel" inputMode="tel" autoComplete="tel-national" placeholder="900 12 34 56" data addon="+992" {...form.register('phone')} />
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
              <div className="space-y-2">
                <FormField label={<>{t('auth.fields.newPassword')}<RequiredMark /></>} error={message(errors.password?.message)}>
                  <PasswordInput autoComplete="new-password" {...form.register('password')} />
                </FormField>
                <PasswordChecklist password={values.password} />
              </div>
              <FormField label={<>{t('auth.fields.confirmPassword')}<RequiredMark /></>} error={message(errors.confirmPassword?.message)}>
                <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
              </FormField>

              <section className="rounded-lg border bg-surface p-4" aria-labelledby="otp-title">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="otp-title" className="flex items-center gap-2 text-[1rem] font-bold">
                    <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
                    {t('auth.register.otp.title')}
                  </h2>
                  <Badge tone="info" className="normal-case tracking-normal">
                    {t('auth.register.otp.digits')}
                  </Badge>
                </div>
                <p className="mt-2 text-[0.9375rem] text-muted-foreground">
                  {available ? t('auth.register.otp.text') : t('auth.register.otp.disabled')}
                </p>
                <div className="mt-4">
                  <OtpInput value={code} onChange={setCode} disabled={!available} label={t('auth.register.otp.title')} />
                </div>
              </section>

              <div className="space-y-1">
                <label className="flex cursor-pointer items-start gap-3 text-[0.9375rem] leading-6">
                  <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[hsl(var(--primary))]" {...form.register('acceptTerms')} />
                  <span>{t('auth.register.terms')}</span>
                </label>
                {errors.acceptTerms?.message ? (
                  <p role="alert" className="pl-8 text-[0.8125rem] text-danger">
                    {t(errors.acceptTerms.message)}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          {step === 'organization' ? (
            <>
              <FormField
                label={<>{values.orgType === 'COMPANY' ? t('onboarding.companyName') : t('onboarding.storeName')}<RequiredMark /></>}
                hint={t('onboarding.nameHint')}
                error={message(errors.orgName?.message)}
              >
                <Input autoComplete="organization" leading={values.orgType === 'COMPANY' ? <Building2 /> : <Store />} {...form.register('orgName')} />
              </FormField>
              <FormField label={t('auth.fields.language')} hint={t('profile.languageHint')}>
                <Select {...form.register('language')}>
                  <option value="tg">{t('languages.tg')}</option>
                  <option value="ru">{t('languages.ru')}</option>
                  <option value="en">{t('languages.en')}</option>
                </Select>
              </FormField>
            </>
          ) : null}

          {step === 'confirm' ? (
            <div className="space-y-4">
              <dl className="divide-y rounded-lg border bg-surface text-[0.9375rem]">
                {[
                  [t('auth.register.review.organization'), `${values.orgName} · ${t(`orgTypes.${values.orgType}`)}`],
                  [t('auth.fields.fullName'), values.fullName],
                  [t('auth.fields.phone'), phoneDisplay],
                  [t('auth.fields.email'), values.email || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 px-4 py-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="truncate text-right font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="rounded-lg bg-subtle px-4 py-3">
                <p className="font-semibold">{t('auth.register.review.nextTitle')}</p>
                <ul className="mt-2 space-y-1.5 text-[0.875rem] text-muted-foreground">
                  <li className="flex gap-2">
                    <MessageSquareText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    {t('auth.register.review.sms', { phone: phoneDisplay })}
                  </li>
                  {values.email ? (
                    <li className="flex gap-2">
                      <Mail className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                      {t('auth.register.review.email', { email: values.email })}
                    </li>
                  ) : null}
                  <li className="flex gap-2">
                    <UserCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    {t('auth.register.review.owner', { type: t(`orgTypes.${values.orgType}`) })}
                  </li>
                </ul>
              </div>
            </div>
          ) : null}

          <div className="flex gap-3">
            {step !== 'account' ? (
              <Button type="button" variant="secondary" size="xl" onClick={back}>
                <ArrowLeft /> {t('common.back')}
              </Button>
            ) : null}
            {step === 'confirm' ? (
              <Button type="submit" size="xl" className="flex-1" disabled={!available}>
                <UserCheck /> {t('auth.register.submit')}
              </Button>
            ) : (
              <Button type="button" size="xl" className="flex-1" onClick={() => void next()}>
                {step === 'account' ? <Smartphone /> : null}
                {step === 'account' && available ? t('auth.register.continueSms') : t('common.continue')}
              </Button>
            )}
          </div>
        </form>

        <p className="text-center text-[1.0625rem] text-muted-foreground">
          {t('auth.register.haveAccount')}{' '}
          <Link to="/login" className="font-bold text-primary hover:underline">
            {t('auth.register.signIn')}
          </Link>
        </p>
        <div className="flex items-start gap-3 rounded-lg bg-subtle px-4 py-3 text-[0.9375rem] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          {t('auth.register.dataNote')}
        </div>
      </div>
    </AuthFrame>
  );
}
