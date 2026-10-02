import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Building2, CalendarDays, Clock, Link2, Mail, Phone, Store, Truck, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { StandaloneLayout } from '@/app/shell/standalone-layout';
import { useRemoveAvatar, useUpdateMe, useUploadAvatar } from '@/shared/auth/api';
import { AccountMenu } from '@/shared/auth/account-menu';
import { areaFor, areaHome, homePath, usableMemberships } from '@/shared/auth/context';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Me, Membership } from '@/shared/auth/types';
import { setLanguage } from '@/shared/i18n';
import { formatDate } from '@/shared/lib/datetime';
import { ImagePicker } from '@/shared/images/image-picker';
import { Alert, Avatar, Badge, Button, Card, FormField, Input, MetaChip, Pill, ProfileHeader, SectionHeader, Select, StatCard, StatusBadge } from '@/shared/ui';
import { ConnectedAccounts } from './connected-accounts';
import { useGoogleLinkState } from './google-link-api';
import { PasswordChangeCard } from './password-change-card';

/** Spaces, dashes, dots and brackets are dropped; the server normalises the same way and stays authoritative. */
const normalizePhone = (value: string) => value.replace(/[\s().-]/g, '');

const schema = z.object({
  full_name: z.string().trim().min(2, 'validation.nameTooShort').max(150, 'validation.tooLong'),
  language: z.enum(['tg', 'ru', 'en']),
  // CR-003: optional contact phone in E.164; empty clears it. Never a sign-in identifier (CR-001).
  phone: z.string().refine((value) => !normalizePhone(value) || /^\+[1-9]\d{7,14}$/.test(normalizePhone(value)), 'validation.phone'),
});
type Values = z.infer<typeof schema>;

const valuesOf = (me: Me): Values => ({ full_name: me.full_name, language: me.language, phone: me.phone ?? '' });

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
          <p className="text-label text-muted-foreground">{t('profile.memberships.empty')}</p>
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
                    <Avatar kind={membership.org_type === 'STORE' ? 'store' : 'company'} size="md" src={membership.logo_url} className="rounded-xl" />
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
  const { t } = useTranslation();
  const activeOrgId = useSessionStore((state) => state.activeOrgId);
  const update = useUpdateMe();
  const uploadAvatar = useUploadAvatar();
  const removeAvatar = useRemoveAvatar();
  const google = useGoogleLinkState();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: valuesOf(me) });
  const errors = form.formState.errors;
  const date = (value: string | null) => formatDate(value) ?? '—';
  // A phone problem the server reports (taken, or not E.164) belongs to the field, not to a generic alert.
  const phoneFailure =
    update.error instanceof ApiError &&
    (update.error.code === 'phone_taken' || (update.error.code === 'validation_error' && update.error.fieldErrors.some((f) => f.field === 'phone')));

  const onSubmit = form.handleSubmit(async (values) => {
    const phone = normalizePhone(values.phone);
    const payload = {
      full_name: values.full_name,
      language: values.language,
      // Only sent when changed: "" clears the phone (null), anything else is the normalised number.
      ...(phone !== (me.phone ?? '') ? { phone: phone || null } : {}),
    };
    const saved = await update.mutateAsync(payload).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'phone_taken') {
        form.setError('phone', { message: 'errors.phone_taken' }, { shouldFocus: true });
      } else if (error instanceof ApiError && error.fieldErrors.some((field) => field.field === 'phone')) {
        form.setError('phone', { message: 'validation.phone' }, { shouldFocus: true });
      }
      return null;
    });
    if (!saved) return;
    setLanguage(saved.language);
    form.reset(valuesOf(saved));
  });

  const phoneStatus = me.phone ? (
    <Badge tone={me.phone_verified_at ? 'success' : 'neutral'}>{me.phone_verified_at ? t('profile.verified') : t('profile.unverified')}</Badge>
  ) : null;

  return (
    <StandaloneLayout back={homePath(me, activeOrgId)} actions={<AccountMenu me={me} compact />}>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        <ProfileHeader
          mark={<Avatar name={me.full_name} size="xl" verified={me.email_verified} src={me.avatar_url} alt={t('images.avatar.alt', { name: me.full_name })} />}
          eyebrow={<Pill>{t('profile.eyebrow')}</Pill>}
          title={me.full_name}
          subtitle={t('profile.subtitle')}
          chips={
            <>
              <span className="inline-flex min-w-0 items-center gap-2">
                <MetaChip icon={Mail}>{me.email}</MetaChip>
                <Badge tone={me.email_verified ? 'success' : 'warning'}>{me.email_verified ? t('profile.verified') : t('profile.unverified')}</Badge>
              </span>
              <span className="inline-flex min-w-0 items-center gap-2">
                <MetaChip icon={Phone}>
                  <span className="font-data">{me.phone ?? '—'}</span>
                </MetaChip>
                {phoneStatus}
              </span>
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
                  <FormField
                    label={t('auth.fields.phone')}
                    hint={t('profile.phone.hint')}
                    error={errors.phone?.message && t(errors.phone.message)}
                    action={phoneStatus}
                  >
                    <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="+992 90 123 4567" maxLength={24} {...form.register('phone')} />
                  </FormField>
                </div>
                {update.isError && !phoneFailure ? <Alert tone="danger">{errorMessage(update.error, t)}</Alert> : null}
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
            <ImagePicker
              subject="avatar"
              name={me.full_name}
              src={me.avatar_url}
              canEdit
              onUpload={(file) => uploadAvatar.mutateAsync(file)}
              onRemove={() => removeAvatar.mutateAsync()}
            />
            <PasswordChangeCard />
            <ConnectedAccounts />
          </div>
        </div>
      </div>
    </StandaloneLayout>
  );
}
