import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { newPasswordSchema, PASSWORD_PROBLEMS } from '@/features/auth/schemas';
import { ApiError, apiRequest } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { logoutSession, useSessionStore } from '@/shared/auth/session-store';
import { Alert, Button, Card, FormField, PasswordInput, SectionHeader } from '@/shared/ui';

const schema = z
  .object({
    current: z.string().min(1, 'validation.required'),
    next: newPasswordSchema,
    confirm: z.string().min(1, 'validation.required'),
  })
  .refine((values) => values.next === values.confirm, { path: ['confirm'], message: 'validation.passwordsMismatch' });
type Values = z.infer<typeof schema>;

/**
 * P01 §6 `POST /auth/password/change` (IAM-008): the server revokes every session, this one included, so a success
 * signs the user out here too and the login page explains why.
 */
export function PasswordChangeCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { current: '', next: '', confirm: '' } });
  const errors = form.formState.errors;
  const change = useMutation({
    mutationFn: (values: Values) =>
      apiRequest<void>('/auth/password/change', { method: 'POST', body: { current_password: values.current, new_password: values.next } }),
  });
  const failure =
    change.error instanceof ApiError && ['invalid_credentials', 'weak_password', 'validation_error'].includes(change.error.code)
      ? null
      : change.error;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await change.mutateAsync(values);
    } catch (caught) {
      if (!(caught instanceof ApiError)) return;
      if (caught.code === 'invalid_credentials') {
        form.setError('current', { message: 'profile.password.wrongCurrent' }, { shouldFocus: true });
      } else if (caught.code === 'weak_password' || caught.code === 'validation_error') {
        const problem = caught.fieldErrors.map((field) => PASSWORD_PROBLEMS[field.code]).find(Boolean);
        form.setError('next', { message: problem ?? 'validation.passwordLetterDigit' }, { shouldFocus: true });
      }
      return;
    }
    await logoutSession();
    useSessionStore.getState().endSession('password_changed');
    queryClient.clear();
    navigate('/login', { replace: true });
  });

  const message = (key?: string) => (key ? t(key) : undefined);

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeader icon={KeyRound} title={t('profile.password.title')} subtitle={t('profile.password.subtitle')} />
      {open ? (
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          <FormField label={t('profile.password.current')} error={message(errors.current?.message)}>
            <PasswordInput autoComplete="current-password" {...form.register('current')} />
          </FormField>
          <div className="grid gap-4">
            <FormField label={t('auth.fields.newPassword')} error={message(errors.next?.message)}>
              <PasswordInput autoComplete="new-password" {...form.register('next')} />
            </FormField>
            <FormField label={t('profile.password.confirm')} error={message(errors.confirm?.message)}>
              <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
            </FormField>
          </div>
          <Alert tone="info">{t('profile.password.signOutNote')}</Alert>
          {failure ? <Alert tone="danger">{errorMessage(failure, t)}</Alert> : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                form.reset();
                change.reset();
                setOpen(false);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={change.isPending}>
              {t('profile.changePassword')}
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" className="mt-4" onClick={() => setOpen(true)}>
          <KeyRound /> {t('profile.changePassword')}
        </Button>
      )}
    </Card>
  );
}
