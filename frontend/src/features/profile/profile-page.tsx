import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, KeyRound, LogOut, Mail, Phone } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { errorMessage } from '@/shared/api/errors';
import { useUpdateMe } from '@/shared/auth/api';
import { homePath } from '@/shared/auth/context';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Me } from '@/shared/auth/types';
import { setLanguage } from '@/shared/i18n';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { Alert, Badge, BrandMark, Button, Card, CardBody, CardHeader, FormField, Input, Select } from '@/shared/ui';

const schema = z.object({
  full_name: z.string().trim().min(2, 'validation.nameTooShort').max(150, 'validation.tooLong'),
  language: z.enum(['tg', 'ru', 'en']),
});
type Values = z.infer<typeof schema>;

/** P01 §10 /profile: name and language (PATCH /me). Password change and logout-all come with the session work. */
export function ProfilePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  const update = useUpdateMe();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: { full_name: me.full_name, language: me.language } });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    const saved = await update.mutateAsync(values).catch(() => null);
    if (!saved) return;
    setLanguage(saved.language);
    form.reset({ full_name: saved.full_name, language: saved.language });
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b bg-surface px-4 py-3 sm:px-8">
        <Link to={homePath(me, activeOrgId)} className="inline-flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          <BrandMark />
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('profile.title')}</h1>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{t('profile.subtitle')}</p>
        </div>

        <Card>
          <CardHeader title={t('profile.details')} />
          <form onSubmit={onSubmit} noValidate>
            <CardBody className="space-y-4">
              <FormField label={t('auth.fields.fullName')} error={errors.full_name?.message && t(errors.full_name.message)}>
                <Input autoComplete="name" {...form.register('full_name')} />
              </FormField>
              <FormField label={t('auth.fields.language')} hint={t('profile.languageHint')}>
                <Select {...form.register('language')}>
                  <option value="tg">{t('languages.tg')}</option>
                  <option value="ru">{t('languages.ru')}</option>
                  <option value="en">{t('languages.en')}</option>
                </Select>
              </FormField>
              {update.isError ? <Alert tone="danger">{errorMessage(update.error, t)}</Alert> : null}
              {update.isSuccess && !form.formState.isDirty ? <Alert tone="success">{t('profile.saved')}</Alert> : null}
            </CardBody>
            <div className="flex justify-end border-t px-5 py-3">
              <Button type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader title={t('profile.contacts')} />
          <CardBody className="space-y-3 text-[0.8125rem]">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Phone className="size-4" aria-hidden="true" /> {t('auth.fields.phone')}
              </span>
              <span className="flex items-center gap-2 font-medium">
                {me.phone} <Badge tone="success">{t('profile.verified')}</Badge>
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Mail className="size-4" aria-hidden="true" /> {t('auth.fields.email')}
              </span>
              <span className="flex items-center gap-2 font-medium">
                {me.email ?? '—'}
                {me.email ? <Badge tone={me.email_verified ? 'success' : 'warning'}>{me.email_verified ? t('profile.verified') : t('profile.unverified')}</Badge> : null}
              </span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('profile.security')} description={t('profile.securityPending')} />
          <CardBody className="flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" disabled>
              <KeyRound /> {t('profile.changePassword')}
            </Button>
            <Button variant="secondary" disabled>
              <LogOut /> {t('profile.logoutAll')}
            </Button>
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
