import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Building2, CalendarDays, Clock, Link2, Mail, Phone, Store, Truck, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { errorMessage } from '@/shared/api/errors';
import { StandaloneLayout } from '@/app/shell/standalone-layout';
import { useUpdateMe } from '@/shared/auth/api';
import { AccountMenu } from '@/shared/auth/account-menu';
import { areaFor, areaHome, homePath, usableMemberships } from '@/shared/auth/context';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Me, Membership } from '@/shared/auth/types';
import { setLanguage } from '@/shared/i18n';
import { Alert, Avatar, Badge, Button, Card, FormField, Input, MetaChip, Pill, ProfileHeader, SectionHeader, Select, StatCard, StatusBadge } from '@/shared/ui';
import { ConnectedAccounts } from './connected-accounts';
import { useGoogleLinkState } from './google-link-api';
import { PasswordChangeCard } from './password-change-card';

const schema = z.object({
  full_name: z.string().trim().min(2, 'validation.nameTooShort').max(150, 'validation.tooLong'),
  language: z.enum(['tg', 'ru', 'en']),
});
type Values = z.infer<typeof schema>;

const AREA_ICON = { company: Building2, store: Store, courier: Truck } as const;

function MembershipsCard({ me }: { me: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  const setActiveOrg = useSessionStore((state) => state.setActiveOrg);
  const memberships = usableMemberships(me);
  const open = (membership: Membership) => {
    setActiveOrg(membership.organization_id);
    navigate(areaHome(areaFor(membership)));
  };
  return (
    <Card className="p-5 sm:p-6">
      <SectionHeader icon={Building2} title={t('profile.memberships.title')} subtitle={t('profile.memberships.subtitle')} />
      {memberships.length === 0 ? (
        <div className="mt-4 space-y-3">
          <p className="text-[0.8125rem] text-muted-foreground">{t('profile.memberships.empty')}</p>
          <Button asChild variant="secondary">
            <Link to={homePath(me, activeOrgId)}>{t('profile.memberships.create')}</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {memberships.map((membership) => {
            const Icon = AREA_ICON[areaFor(membership)];
            return (
              <li
                key={membership.id}
                className="flex flex-col gap-3 rounded-xl border bg-subtle/40 p-3 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {membership.org_type === 'STORE' || membership.org_type === 'COMPANY' ? (
                    <Avatar kind={membership.org_type === 'STORE' ? 'store' : 'company'} size="md" className="rounded-xl" />
                  ) : (
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{membership.org_name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone="accent">{t(`roles.${membership.role}`)}</Badge>
                      <Badge>{t(`orgTypes.${membership.org_type}`)}</Badge>
                      {membership.verification_status ? <StatusBadge kind="verification" value={membership.verification_status} /> : null}
                    </div>
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => open(membership)} aria-label={t('profile.memberships.openNamed', { name: membership.org_name })}>
                  {membership.organization_id === activeOrgId ? t('profile.memberships.current') : t('profile.memberships.open')}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/**
 * P01 §10 /profile: the person (not an organization). Name and language (PATCH /me), password change (IAM-008),
 * connected Google account and the organizations this user belongs to.
 */
export function ProfilePage({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  const update = useUpdateMe();
  const google = useGoogleLinkState();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: { full_name: me.full_name, language: me.language } });
  const errors = form.formState.errors;
  const date = (value: string | null) => (value ? new Date(value).toLocaleDateString(i18n.language) : '—');

  const onSubmit = form.handleSubmit(async (values) => {
    const saved = await update.mutateAsync(values).catch(() => null);
    if (!saved) return;
    setLanguage(saved.language);
    form.reset({ full_name: saved.full_name, language: saved.language });
  });

  return (
    <StandaloneLayout back={homePath(me, activeOrgId)} actions={<AccountMenu me={me} compact />}>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        <ProfileHeader
          mark={<Avatar name={me.full_name} size="xl" verified={me.email_verified} />}
          eyebrow={<Pill>{t('profile.eyebrow')}</Pill>}
          title={me.full_name}
          subtitle={t('profile.subtitle')}
          chips={
            <>
              <span className="inline-flex min-w-0 items-center gap-2">
                <MetaChip icon={Mail}>{me.email}</MetaChip>
                <Badge tone={me.email_verified ? 'success' : 'warning'}>{me.email_verified ? t('profile.verified') : t('profile.unverified')}</Badge>
              </span>
              <MetaChip icon={Phone}>
                <span className="font-data">{me.phone ?? '—'}</span>
              </MetaChip>
            </>
          }
          stats={
            <>
              <StatCard icon={Building2} label={t('profile.stats.organizations')} value={usableMemberships(me).length} />
              <StatCard icon={CalendarDays} label={t('profile.stats.memberSince')} value={date(me.created_at)} />
              <StatCard icon={Clock} label={t('profile.stats.lastSignIn')} value={date(me.last_login_at)} />
              <StatCard
                icon={Link2}
                label={t('profile.stats.google')}
                value={google.data ? (google.data.connected ? t('profile.stats.googleLinked') : t('profile.stats.googleNotLinked')) : '…'}
              />
            </>
          }
        />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card className="p-5 sm:p-6">
              <SectionHeader icon={UserRound} title={t('profile.details')} subtitle={t('profile.detailsHint')} />
              <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
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
                  <FormField label={t('auth.fields.email')} hint={t('profile.emailHint')}>
                    <Input value={me.email} readOnly aria-readonly />
                  </FormField>
                  <FormField label={t('auth.fields.phone')}>
                    <Input value={me.phone ?? '—'} readOnly aria-readonly />
                  </FormField>
                </div>
                {update.isError ? <Alert tone="danger">{errorMessage(update.error, t)}</Alert> : null}
                {update.isSuccess && !form.formState.isDirty ? <Alert tone="success">{t('profile.saved')}</Alert> : null}
                <div className="flex justify-end">
                  <Button type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
                    {t('common.save')}
                  </Button>
                </div>
              </form>
            </Card>

            <MembershipsCard me={me} />
          </div>

          <div className="space-y-6">
            <PasswordChangeCard />
            <ConnectedAccounts />
          </div>
        </div>
      </div>
    </StandaloneLayout>
  );
}
