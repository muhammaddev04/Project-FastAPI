import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { Alert, Button, CodeInput, FormField, Input, PasswordInput } from '@/shared/ui';
import { usePasswordResetComplete, usePasswordResetStart, usePasswordResetVerify } from './api';
import { AuthActions, AuthForm, AuthPage, AuthSwitch } from './auth-layout';
import { MethodUnavailable } from './availability';
import { StepCount } from './journey';
import { maskEmail } from './mask';
import { PasswordChecklist } from './password-checklist';
import {
  PASSWORD_PROBLEMS,
  forgotPasswordSchema,
  resetCodeSchema,
  resetPasswordSchema,
  type ForgotPasswordValues,
  type ResetCodeValues,
  type ResetPasswordValues,
} from './schemas';
import { useAuthMethod } from './use-auth-method';
import { useCountdown } from './use-countdown';

/** A fresh code can be asked for after this long in the UI; the server's own limit answers 429 + Retry-After. */
const RESEND_COOLDOWN_SECONDS = 60;
const CODE_LENGTH = 6;
const TOTAL_STEPS = 3;

type Step = { name: 'email' } | { name: 'code'; email: string } | { name: 'password'; token: string } | { name: 'done' };

/** Client rules are translation keys; server validation messages arrive already translated (Accept-Language). */
function useFieldMessage() {
  const { t } = useTranslation();
  return (key?: string) => (key ? (key.startsWith('validation.') ? t(key) : key) : undefined);
}

/** Where in the three-step recovery the user is. Three steps need a count, not a map. */
function RecoveryStep({ current }: { current: 1 | 2 | 3 }) {
  const { t } = useTranslation();
  return <StepCount current={current} total={TOTAL_STEPS} label={t(`auth.forgot.steps.${current}`)} />;
}

/**
 * CR-001 /forgot-password (IAM-015, owner change: a code instead of a link):
 * 1. email to `password/reset/start` (the same neutral answer for every address);
 * 2. the 6-digit code from the email to `password/reset/verify`, which returns a one-time reset
 *    authorization kept in memory;
 * 3. the new password to `password/reset/complete` with that authorization; every device is signed out.
 *
 * Nothing secret ever goes into the URL. Phase D changed only the presentation: the three steps now say which
 * one they are, the destination address is masked where it is repeated back, and the screens are the same
 * composition as the rest of the authentication flow rather than three differently shaped cards.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ name: 'email' });

  if (step.name === 'done') {
    return (
      <AuthPage title={t('auth.resetPassword.successTitle')} lead={t('auth.resetPassword.successText')}>
        <Button asChild block size="xl">
          <Link to="/login" replace>
            {t('auth.resetPassword.goToLogin')}
          </Link>
        </Button>
      </AuthPage>
    );
  }
  if (step.name === 'password') {
    return <NewPasswordStep token={step.token} onDone={() => setStep({ name: 'done' })} onRestart={() => setStep({ name: 'email' })} />;
  }
  if (step.name === 'code') {
    return (
      <CodeStep
        email={step.email}
        onVerified={(token) => setStep({ name: 'password', token })}
        onChangeEmail={() => setStep({ name: 'email' })}
      />
    );
  }
  return <EmailStep onSent={(email) => setStep({ name: 'code', email })} />;
}

function EmailStep({ onSent }: { onSent: (email: string) => void }) {
  const { t } = useTranslation();
  const message = useFieldMessage();
  const { available, meta } = useAuthMethod('password_reset');
  const start = usePasswordResetStart();
  const [retryIn, setRetryIn] = useCountdown();
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  });
  const failure = start.error instanceof ApiError && start.error.code === 'validation_error' ? null : start.error;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      // The schema has already trimmed and lowercased the address, like every other auth form.
      await start.mutateAsync(values.email);
      onSent(values.email);
    } catch (caught) {
      if (!(caught instanceof ApiError)) return;
      if (caught.code === 'validation_error') {
        const field = caught.fieldErrors.find((item) => item.field === 'email');
        if (field) form.setError('email', { message: field.message });
      } else if (caught.status === 429) {
        setRetryIn(caught.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
      }
    }
  });

  return (
    <AuthPage
      above={<RecoveryStep current={1} />}
      title={t('auth.forgot.title')}
      lead={t('auth.forgot.subtitle')}
      footer={<AuthSwitch question={t('auth.reset.remembered')} to="/login" link={t('auth.register.signIn')} />}
    >
      {!available ? (
        <div className="mb-5">
          <MethodUnavailable method="password_reset" meta={meta} />
        </div>
      ) : null}
      <AuthForm onSubmit={onSubmit}>
        <FormField size="lg" label={t('auth.fields.email')} hint={t('auth.forgot.emailHint')} error={message(form.formState.errors.email?.message)}>
          <Input size="lg" type="email" inputMode="email" autoComplete="email" placeholder="name@company.tj" {...form.register('email')} />
        </FormField>
        {failure ? (
          <Alert tone="danger" title={t('auth.forgot.failed')}>
            {errorMessage(failure, t)}
          </Alert>
        ) : null}
        <Button type="submit" block size="xl" disabled={!available || retryIn > 0} loading={meta.isPending || start.isPending}>
          {retryIn > 0 ? t('auth.forgot.retryIn', { seconds: retryIn }) : t('auth.forgot.submit')}
        </Button>
      </AuthForm>
    </AuthPage>
  );
}

function CodeStep({ email, onVerified, onChangeEmail }: { email: string; onVerified: (token: string) => void; onChangeEmail: () => void }) {
  const { t } = useTranslation();
  const message = useFieldMessage();
  const verify = usePasswordResetVerify();
  const resend = usePasswordResetStart();
  const [resendIn, setResendIn] = useCountdown(RESEND_COOLDOWN_SECONDS);
  const [verifyIn, setVerifyIn] = useCountdown();
  const form = useForm<ResetCodeValues>({ resolver: zodResolver(resetCodeSchema), mode: 'onTouched', defaultValues: { code: '' } });
  const codeField = form.register('code');
  const failure = verify.error instanceof ApiError && verify.error.code === 'validation_error' ? null : verify.error;
  const failureText =
    failure instanceof ApiError && failure.code === 'email_token_invalid'
      ? t('auth.verify.codeInvalid')
      : failure instanceof ApiError && failure.code === 'email_token_expired'
        ? t('auth.verify.codeExpired')
        : errorMessage(failure, t);

  const onSubmit = form.handleSubmit(async (values) => {
    resend.reset();
    try {
      const authorization = await verify.mutateAsync({ email, code: values.code });
      onVerified(authorization.reset_token);
    } catch (caught) {
      if (!(caught instanceof ApiError)) return;
      if (caught.code === 'validation_error') {
        const field = caught.fieldErrors.find((item) => item.field === 'code');
        if (field) form.setError('code', { message: field.message });
      } else if (caught.status === 429) {
        setVerifyIn(caught.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
      }
    }
  });

  const onResend = async () => {
    verify.reset();
    try {
      await resend.mutateAsync(email);
      setResendIn(RESEND_COOLDOWN_SECONDS);
      form.setValue('code', '');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 429) setResendIn(caught.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
    }
  };

  return (
    <AuthPage
      above={<RecoveryStep current={2} />}
      title={t('auth.forgot.codeTitle')}
      lead={t('auth.forgot.codeSent', { email: maskEmail(email) })}
      footer={<AuthSwitch question={t('auth.reset.remembered')} to="/login" link={t('auth.register.signIn')} />}
    >
      <AuthForm onSubmit={onSubmit}>
        <FormField size="lg" label={t('auth.verify.codeLabel')} hint={t('auth.verify.codeHint')} error={message(form.formState.errors.code?.message)}>
          <CodeInput length={CODE_LENGTH} autoFocus {...codeField} />
        </FormField>
        {failure ? (
          <Alert tone="danger" title={t('auth.forgot.codeFailed')}>
            {failureText}
          </Alert>
        ) : null}
        {resend.isSuccess ? <Alert tone="success">{t('auth.forgot.codeResent')}</Alert> : null}
        {resend.isError ? <Alert tone="danger">{errorMessage(resend.error, t)}</Alert> : null}
        <AuthActions>
          <Button type="submit" block size="xl" disabled={verifyIn > 0} loading={verify.isPending}>
            {verifyIn > 0 ? t('auth.verify.verifyIn', { seconds: verifyIn }) : t('auth.forgot.verifyCode')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            block
            size="lg"
            className="text-primary"
            disabled={resendIn > 0}
            loading={resend.isPending}
            onClick={() => void onResend()}
          >
            {resendIn > 0 ? t('auth.verify.resendIn', { seconds: resendIn }) : t('auth.verify.resend')}
          </Button>
          <Button type="button" variant="ghost" block size="lg" className="text-muted-foreground" onClick={onChangeEmail}>
            {t('auth.forgot.changeEmail')}
          </Button>
        </AuthActions>
      </AuthForm>
    </AuthPage>
  );
}

function NewPasswordStep({ token, onDone, onRestart }: { token: string; onDone: () => void; onRestart: () => void }) {
  const { t } = useTranslation();
  const message = useFieldMessage();
  const complete = usePasswordResetComplete();
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onTouched',
    defaultValues: { password: '', confirmPassword: '' },
  });
  const errors = form.formState.errors;
  const password = form.watch('password');
  const failure =
    complete.error instanceof ApiError && ['weak_password', 'validation_error'].includes(complete.error.code) ? null : complete.error;
  // The authorization expired (10 minutes) or was already used: only a new code helps.
  const authorizationGone =
    complete.error instanceof ApiError && ['email_token_invalid', 'email_token_expired'].includes(complete.error.code);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await complete.mutateAsync({ token, new_password: values.password });
      onDone();
    } catch (caught) {
      if (!(caught instanceof ApiError)) return;
      if (caught.code === 'weak_password') {
        const problem = caught.fieldErrors.map((field) => PASSWORD_PROBLEMS[field.code]).find(Boolean);
        form.setError('password', { message: problem ?? 'validation.passwordLetterDigit' }, { shouldFocus: true });
      } else if (caught.code === 'validation_error') {
        const field = caught.fieldErrors.find((item) => item.field === 'new_password');
        if (field) form.setError('password', { message: field.message });
      }
    }
  });

  return (
    <AuthPage above={<RecoveryStep current={3} />} title={t('auth.resetPassword.title')} lead={t('auth.resetPassword.subtitle')}>
      <AuthForm onSubmit={onSubmit}>
        <div className="space-y-2">
          <FormField size="lg" label={t('auth.fields.newPassword')} error={message(errors.password?.message)}>
            <PasswordInput size="lg" autoComplete="new-password" {...form.register('password')} />
          </FormField>
          <PasswordChecklist password={password} />
        </div>
        <FormField size="lg" label={t('auth.fields.confirmPassword')} error={message(errors.confirmPassword?.message)}>
          <PasswordInput size="lg" autoComplete="new-password" {...form.register('confirmPassword')} />
        </FormField>
        <p className="text-label text-muted-foreground">{t('auth.resetPassword.signOutNote')}</p>
        {failure ? (
          <Alert
            tone="danger"
            title={t('auth.resetPassword.failedTitle')}
            action={
              authorizationGone ? (
                <Button size="sm" variant="secondary" onClick={onRestart}>
                  {t('auth.resetPassword.requestNew')}
                </Button>
              ) : null
            }
          >
            {authorizationGone ? t('auth.resetPassword.expiredText') : errorMessage(failure, t)}
          </Alert>
        ) : null}
        <Button type="submit" block size="xl" disabled={authorizationGone} loading={complete.isPending}>
          {t('auth.resetPassword.submit')}
        </Button>
      </AuthForm>
    </AuthPage>
  );
}
