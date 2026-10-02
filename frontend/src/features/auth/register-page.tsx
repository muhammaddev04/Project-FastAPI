import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { currentLanguage } from '@/shared/i18n';
import { Alert, Button, Checkbox, CheckboxField, FormField, Input, PasswordInput } from '@/shared/ui';
import { useRegister } from './api';
import { AuthForm, AuthPage, AuthSwitch } from './auth-layout';
import { MethodUnavailable } from './availability';
import { GoogleButton, OrDivider } from './google-button';
import { PasswordChecklist } from './password-checklist';
import { PASSWORD_PROBLEMS, createAccountSchema, type CreateAccountValues } from './schemas';
import { useAuthMethod } from './use-auth-method';
import { VERIFY_PATH, type VerifyEmailState } from './handover';

/** Server field names of RegisterRequest to form fields. */
const SERVER_FIELDS: Record<string, 'email' | 'password' | 'fullName'> = {
  email: 'email',
  password: 'password',
  full_name: 'fullName',
};

/**
 * Step 1 of 5: create the account (Phase D).
 *
 * Before: one screen asked for the business type, the organization name, the owner's name, the email, a
 * password and the terms, and closed with a three-item strip describing what would happen afterwards. Six
 * decisions, two of them about a legal entity, before the user had an account at all.
 *
 * Now it asks for the three values `POST /auth/register` actually needs, and the journey rail says what comes
 * next instead of a paragraph doing it. The business questions moved to steps 3 and 4, after the address is
 * confirmed, which is also the first moment the backend will let an organization be created.
 */
export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { available, meta } = useAuthMethod('registration');
  const registration = useRegister();
  const form = useForm<CreateAccountValues>({
    resolver: zodResolver(createAccountSchema),
    mode: 'onTouched',
    defaultValues: { fullName: '', email: '', password: '', acceptTerms: false as unknown as true },
  });
  const errors = form.formState.errors;
  const password = form.watch('password');
  // Client rules are translation keys; server validation messages arrive already translated (Accept-Language).
  const message = (key?: string) => (key ? (key.startsWith('validation.') ? t(key) : key) : undefined);
  // Field problems are shown on the fields; anything else (rate limit, email delivery, network) in one alert.
  const formError =
    registration.error instanceof ApiError && ['weak_password', 'validation_error'].includes(registration.error.code)
      ? null
      : registration.error;

  const onSubmit = form.handleSubmit(async (values) => {
    // IAM-001: registration creates the user and sends the code. No organization, and no onboarding intent.
    const payload = {
      email: values.email,
      password: values.password,
      full_name: values.fullName.trim(),
      language: currentLanguage(),
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
    // 202 says nothing about whether the address was new (IAM-001); step 2 only needs it to verify and resend.
    const state: VerifyEmailState = { email: payload.email, justRegistered: true };
    navigate(VERIFY_PATH, { state });
  });

  return (
    <AuthPage
      title={t('auth.register.title')}
      lead={t('auth.register.lead')}
      footer={<AuthSwitch question={t('auth.register.haveAccount')} to="/login" link={t('auth.register.signIn')} />}
    >
      {!available ? (
        <div className="mb-5">
          <MethodUnavailable method="registration" meta={meta} />
        </div>
      ) : null}

      <AuthForm onSubmit={onSubmit}>
        <FormField size="lg" label={t('auth.fields.fullName')} error={message(errors.fullName?.message)}>
          <Input size="lg" autoComplete="name" placeholder={t('auth.register.namePlaceholder')} {...form.register('fullName')} />
        </FormField>
        <FormField size="lg" label={t('auth.fields.email')} hint={t('auth.register.emailHint')} error={message(errors.email?.message)}>
          <Input size="lg" type="email" inputMode="email" autoComplete="email" placeholder="name@company.tj" {...form.register('email')} />
        </FormField>
        <div className="space-y-2">
          <FormField size="lg" label={t('auth.fields.newPassword')} error={message(errors.password?.message)}>
            <PasswordInput size="lg" autoComplete="new-password" {...form.register('password')} />
          </FormField>
          <AnimatePresence initial={false}>
            {password ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
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
        {formError ? (
          <Alert tone="danger" title={t('auth.register.failed')}>
            {errorMessage(formError, t)}
          </Alert>
        ) : null}
        <Button type="submit" block size="xl" disabled={!available} loading={meta.isPending || registration.isPending}>
          {t('auth.register.submit')}
        </Button>
      </AuthForm>

      <OrDivider className="my-5" />
      <GoogleButton />
    </AuthPage>
  );
}
