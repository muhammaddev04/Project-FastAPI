import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Building2, Check, Mail, Store, UserRound } from 'lucide-react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Button, FormField, Input, PasswordInput } from '@/shared/ui';
import { AuthCard, BrandTitle, CardSwitch, authLabel, authPrimaryButton } from './auth-layout';
import { MethodUnavailable } from './availability';
import { PasswordChecklist } from './password-checklist';
import { registerSchema, type RegisterValues } from './schemas';
import { useAuthMethod } from './use-auth-method';

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
      <div className="grid grid-cols-2 gap-2.5">
        {options.map(({ type, icon: Icon, badge }) => {
          const active = selected === type;
          return (
            <label
              key={type}
              className={cn(
                'relative flex cursor-pointer items-center gap-2 rounded-2xl border px-2.5 py-3 short:py-1.5 sm:gap-3 transition-[border-color,background-color,box-shadow,transform] duration-200 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.2)] active:scale-[0.98] sm:px-3.5',
                active ? 'border-primary/70 bg-primary/10' : 'border-input bg-subtle/60 hover:-translate-y-0.5 hover:border-primary/40',
              )}
            >
              <input type="radio" value={type} className="sr-only" {...field} />
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center sm:size-9 justify-center rounded-xl transition-colors',
                  active ? 'bg-[#0B7D72] text-white dark:bg-[#0D8276]' : 'bg-surface text-muted-foreground',
                )}
              >
                <Icon className="size-[1.125rem]" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block break-words text-[0.8125rem] font-semibold leading-tight sm:text-[0.875rem]">{t(`auth.register.roles.${type}.title`)}</span>
                <span className="block text-[0.6875rem] font-medium text-muted-foreground">{badge}</span>
              </span>
              {active ? <Check className="absolute right-2.5 top-2.5 size-3.5 text-primary" aria-hidden="true" /> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** What happens after the form: email confirmation → organization review → approval (TZ P01/P02). */
function NextSteps() {
  const { t } = useTranslation();
  const steps = [t('auth.shell.flowEmail'), t('auth.shell.flowReview'), t('auth.shell.flowAccess')];
  return (
    <div className="rounded-2xl bg-subtle/60 px-3.5 py-2.5 short:flex short:items-center short:gap-3 short:py-2">
      <p className="shrink-0 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground short:hidden short:sm:block short:sm:max-w-[6.5rem] short:sm:leading-tight">
        {t('auth.shell.flowTitle')}
      </p>
      <ol className="mt-1.5 grid flex-1 grid-cols-3 short:mt-0 gap-2 text-[0.75rem] font-medium leading-tight sm:text-[0.8125rem]">
        {steps.map((step, index) => (
          <li key={step} className="flex items-start gap-1.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[0.6875rem] font-bold text-primary">
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
  const { available, meta } = useAuthMethod('registration');
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
  const message = (key?: string) => (key ? t(key) : undefined);

  return (
    <AuthCard title={<BrandTitle i18nKey="auth.shell.registerTitle" />} subtitle={t('auth.shell.registerSubtitle')} tabs>
      {!available ? (
        <div className="mb-4 short:mb-3">
          <MethodUnavailable method="registration" meta={meta} />
        </div>
      ) : null}

      {/* Account creation (email verification, then organization review) is wired by the deferred P01 flow. */}
      <form className="space-y-4 short:space-y-2.5" noValidate onSubmit={form.handleSubmit(() => undefined)}>
        <RoleChoice selected={orgType} field={form.register('orgType')} />
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-3 short:gap-2.5">
          <FormField
            labelClassName={authLabel}
            label={orgType === 'COMPANY' ? t('onboarding.companyName') : t('onboarding.storeName')}
            error={message(errors.orgName?.message)}
          >
            <Input variant="auth" autoComplete="organization" leading={orgType === 'COMPANY' ? <Building2 /> : <Store />} {...form.register('orgName')} />
          </FormField>
          <FormField labelClassName={authLabel} label={t('auth.fields.fullName')} error={message(errors.fullName?.message)}>
            <Input variant="auth" autoComplete="name" placeholder={t('auth.register.namePlaceholder')} leading={<UserRound />} {...form.register('fullName')} />
          </FormField>
        </div>
        <FormField labelClassName={authLabel} label={t('auth.fields.email')} hint={t('auth.register.emailHint')} error={message(errors.email?.message)}>
          <Input variant="auth" type="email" inputMode="email" autoComplete="email" placeholder="name@company.tj" leading={<Mail />} {...form.register('email')} />
        </FormField>
        <div className="space-y-2">
          <FormField labelClassName={authLabel} label={t('auth.fields.newPassword')} error={message(errors.password?.message)}>
            <PasswordInput variant="auth" placeholder={t('auth.login.passwordPlaceholder')} autoComplete="new-password" {...form.register('password')} />
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
        <div className="space-y-1">
          <label className="flex cursor-pointer items-start gap-2.5 text-[0.75rem] leading-[1.125rem] text-muted-foreground sm:text-[0.8125rem] sm:leading-5 short:sm:text-[0.75rem] short:sm:leading-[1.125rem]">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-[hsl(var(--primary))]" {...form.register('acceptTerms')} />
            <span>{t('auth.register.terms')}</span>
          </label>
          {errors.acceptTerms?.message ? (
            <p role="alert" className="pl-6 text-[0.8125rem] text-danger">
              {t(errors.acceptTerms.message)}
            </p>
          ) : null}
        </div>
        <NextSteps />
        <Button type="submit" block className={authPrimaryButton} disabled={!available} loading={meta.isPending}>
          {t('auth.register.submit')}
          <ArrowRight className="transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true" />
        </Button>
      </form>

      <CardSwitch question={t('auth.register.haveAccount')} to="/login" link={t('auth.register.signIn')} />
    </AuthCard>
  );
}
