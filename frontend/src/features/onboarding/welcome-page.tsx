import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Building2, Check, Store } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { errorMessage, fieldErrorMap } from '@/shared/api/errors';
import { AccountMenu } from '@/shared/auth/account-menu';
import { areaFor, areaHome, isUsable } from '@/shared/auth/context';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Me, OrgType } from '@/shared/auth/types';
import { LanguageSwitcher } from '@/shared/i18n/language-switcher';
import { cn } from '@/shared/lib/cn';
import { Alert, Badge, BrandMark, Button, Card, FormField, Input } from '@/shared/ui';
import { useCreateOrganization } from './api';

const schema = z.object({
  type: z.enum(['COMPANY', 'STORE']),
  name: z.string().trim().min(2, 'validation.nameTooShort').max(200, 'validation.tooLong'),
});
type FormValues = z.infer<typeof schema>;

const OPTIONS: { type: OrgType; icon: typeof Building2; key: 'company' | 'store' }[] = [
  { type: 'COMPANY', icon: Building2, key: 'company' },
  { type: 'STORE', icon: Store, key: 'store' },
];

export function WelcomePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveOrg = useSessionStore((state) => state.setActiveOrg);
  const create = useCreateOrganization();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { type: 'COMPANY', name: '' } });
  const selected = form.watch('type');
  const existing = me.memberships.filter(isUsable);
  const serverFields = fieldErrorMap(create.error);

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await create.mutateAsync(values).catch(() => null);
    if (!result) return;
    setActiveOrg(result.organization.id);
    navigate(areaHome(areaFor(result.membership)), { replace: true });
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b bg-surface px-4 py-3 sm:px-8">
        <BrandMark />
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <AccountMenu me={me} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <div className="animate-fade-in">
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-primary">{t('onboarding.eyebrow')}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
            {t('onboarding.title', { name: me.full_name.split(' ')[0] })}
          </h1>
          <p className="mt-2 max-w-xl text-[0.875rem] text-muted-foreground">{t('onboarding.subtitle')}</p>
        </div>

        {existing.length > 0 ? (
          <Card className="mt-8">
            <div className="border-b px-5 py-3 text-[0.8125rem] font-medium">{t('onboarding.existingTitle')}</div>
            <ul className="divide-y">
              {existing.map((membership) => (
                <li key={membership.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-subtle"
                    onClick={() => {
                      setActiveOrg(membership.organization_id);
                      navigate(areaHome(areaFor(membership)));
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{membership.org_name}</span>
                      <span className="text-[0.8125rem] text-muted-foreground">{t(`roles.${membership.role}`)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={membership.org_type === 'COMPANY' ? 'accent' : 'neutral'}>
                        {t(`orgTypes.${membership.org_type}`)}
                      </Badge>
                      <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <form onSubmit={onSubmit} noValidate className="mt-8 space-y-6">
          <fieldset>
            <legend className="mb-3 text-[0.8125rem] font-medium">{t('onboarding.typeLegend')}</legend>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
              {OPTIONS.map(({ type, icon: Icon, key }) => {
                const active = selected === type;
                return (
                  <label
                    key={type}
                    className={cn(
                      'relative flex cursor-pointer flex-col gap-3 rounded-lg border bg-surface p-4 shadow-card transition-all',
                      'focus-within:ring-2 focus-within:ring-ring',
                      active ? 'border-primary ring-1 ring-primary' : 'hover:border-input',
                    )}
                  >
                    <input type="radio" value={type} className="sr-only" {...form.register('type')} />
                    <span className="flex items-center justify-between">
                      <span
                        className={cn(
                          'flex size-9 items-center justify-center rounded-md border',
                          active ? 'border-primary/20 bg-primary-soft text-primary' : 'bg-subtle text-muted-foreground',
                        )}
                      >
                        <Icon className="size-[18px]" aria-hidden="true" />
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex size-5 items-center justify-center rounded-full border',
                          active ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                        )}
                      >
                        {active ? <Check className="size-3" /> : null}
                      </span>
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{t(`onboarding.${key}.title`)}</span>
                      <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                        {t(`onboarding.${key}.description`)}
                      </span>
                    </span>
                    <ul className="space-y-1 border-t pt-3 text-[0.8125rem] text-muted-foreground">
                      {(t(`onboarding.${key}.points`, { returnObjects: true }) as string[]).map((point) => (
                        <li key={point} className="flex gap-2">
                          <Check className="mt-1 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Card className="p-5">
            <FormField
              label={selected === 'COMPANY' ? t('onboarding.companyName') : t('onboarding.storeName')}
              hint={t('onboarding.nameHint')}
              error={
                form.formState.errors.name?.message ? t(form.formState.errors.name.message) : serverFields.name
              }
            >
              <Input autoComplete="organization" maxLength={200} {...form.register('name')} />
            </FormField>
            {create.isError && !serverFields.name ? (
              <Alert tone="danger" className="mt-4">
                {errorMessage(create.error, t)}
              </Alert>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[0.8125rem] text-muted-foreground">{t('onboarding.ownerNote')}</p>
              <Button type="submit" loading={create.isPending} className="sm:min-w-44">
                {selected === 'COMPANY' ? t('onboarding.createCompany') : t('onboarding.createStore')}
              </Button>
            </div>
          </Card>
        </form>
      </main>
    </div>
  );
}
