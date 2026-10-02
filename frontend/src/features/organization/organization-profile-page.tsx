import { zodResolver } from '@hookform/resolvers/zod';
import { FileText, Hash, KeyRound, Lock, MapPin, Phone, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { useAreaContext } from '@/app/shell/use-area-context';
import { useOrganizationProfile, useVerification, type OrganizationProfile } from '@/features/verification/api';
import { ApiError } from '@/shared/api/client';
import { errorMessage } from '@/shared/api/errors';
import { formatDate } from '@/shared/lib/datetime';
import { useMembers } from '@/shared/auth/api';
import { areaFor } from '@/shared/auth/context';
import { Alert, Avatar, Badge, Button, Card, ErrorState, FormField, InfoRow, Input, MetaChip, Pill, PlannedPanel, ProfileHeader, SectionHeader, Skeleton, StatCard, StatusBadge } from '@/shared/ui';
import { ImagePicker } from '@/shared/images/image-picker';
import { useRemoveOrganizationImage, useUpdateOrganization, useUploadOrganizationImage, type OrganizationChanges } from './api';
import { SettingsTabs } from './settings-tabs';

const coordinate = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((value) => !value || (/^-?\d{1,3}(\.\d{1,6})?$/.test(value) && Number(value) >= min && Number(value) <= max), 'validation.coordinate');

const schema = z.object({
  name: z.string().trim().min(2, 'validation.nameTooShort').max(200, 'validation.tooLong'),
  legal_name: z.string().trim().min(2, 'validation.nameTooShort').max(255, 'validation.tooLong'),
  tax_identifier: z.string().trim().refine((value) => !value || /^\d{9,12}$/.test(value), 'validation.taxIdentifier'),
  phone: z
    .string()
    .trim()
    .refine((value) => /^\+[1-9]\d{7,14}$/.test(value.replace(/[\s()-]/g, '')), 'validation.phone'),
  email: z.string().trim().refine((value) => !value || z.string().email().safeParse(value).success, 'validation.email'),
  city: z.string().trim().min(2, 'validation.nameTooShort').max(100, 'validation.tooLong'),
  address: z.string().trim().min(3, 'validation.addressTooShort').max(500, 'validation.tooLong'),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
});
type Values = z.infer<typeof schema>;
type Field = keyof Values;
/** ORG-005 locks these after verification; the display `name` stays editable by the owner. */
const LEGAL: Field[] = ['legal_name', 'tax_identifier'];
const CONTACTS: Field[] = ['phone', 'email', 'city', 'address', 'latitude', 'longitude'];

function toValues(profile: OrganizationProfile): Values {
  return {
    name: profile.name,
    legal_name: profile.legal_name,
    tax_identifier: profile.tax_identifier ?? '',
    phone: profile.phone,
    email: profile.email ?? '',
    city: profile.city,
    address: profile.address,
    latitude: profile.latitude ?? '',
    longitude: profile.longitude ?? '',
  };
}

/** Only what changed, in the server's shape (empty optional values become null). */
function changesOf(profile: OrganizationProfile, values: Values, editable: Set<Field>): OrganizationChanges {
  const before = toValues(profile);
  const changes: OrganizationChanges = { version: profile.version };
  for (const field of Object.keys(values) as Field[]) {
    if (!editable.has(field)) continue;
    const value = field === 'phone' ? values.phone.replace(/[\s()-]/g, '') : values[field].trim();
    if (value === before[field].trim()) continue;
    (changes as Record<string, unknown>)[field] = value === '' ? null : value;
  }
  return changes;
}

/** Owner of the organization from GET /members (members.view), shown as the responsible person. */
function ResponsiblePerson() {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  const canView = membership.permissions.includes('members.view');
  const owners = useMembers(canView ? membership.organization_id : null, { role: 'OWNER', limit: 1 });
  if (!canView) return null;
  const owner = owners.data?.results[0];
  return (
    <div className="h-full rounded-2xl border bg-surface/70 p-4 dark:bg-subtle/40">
      <p className="text-micro font-bold uppercase tracking-[0.1em] text-primary">{t('orgProfile.responsible')}</p>
      {owners.isPending ? (
        <Skeleton className="mt-3 h-10" />
      ) : owner ? (
        <div className="mt-3 flex items-center gap-3">
          <Avatar name={owner.full_name} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{owner.full_name}</p>
            <p className="truncate text-caption text-muted-foreground">{t('roles.OWNER')}</p>
            <p className="truncate text-caption text-muted-foreground">{owner.email}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-label text-muted-foreground">—</p>
      )}
    </div>
  );
}

function TeamSize() {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  const canView = membership.permissions.includes('members.view');
  const members = useMembers(canView ? membership.organization_id : null, { limit: 1 });
  if (!canView) return null;
  return <StatCard icon={Users} label={t('entity.team')} value={members.data ? members.data.count : '…'} />;
}

/**
 * P02 §8 `/company|store/settings/profile`: the organization itself (not the user). Legal fields are editable by the
 * OWNER (`org.edit_legal`) until verification locks them (ORG-005); contacts by OWNER/MANAGER (`org.edit_contacts`).
 * The server enforces every rule; this page only mirrors them.
 */
export function OrganizationProfilePage() {
  const { t } = useTranslation();
  const { membership } = useAreaContext();
  const orgId = membership.organization_id;
  const area = areaFor(membership);
  const profile = useOrganizationProfile(orgId);
  const canViewVerification = membership.permissions.includes('verification.view');
  const verification = useVerification(canViewVerification ? orgId : null);
  const update = useUpdateOrganization(orgId);
  const uploadImage = useUploadOrganizationImage(orgId);
  const removeImage = useRemoveOrganizationImage(orgId);
  const [saved, setSaved] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: profile.data ? toValues(profile.data) : undefined });
  const errors = form.formState.errors;

  useEffect(() => {
    if (profile.data) form.reset(toValues(profile.data));
  }, [profile.data, form]);

  if (profile.isPending) {
    return (
      <div className="space-y-5">
        <SettingsTabs />
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }
  if (profile.isError) return <ErrorState message={errorMessage(profile.error, t)} onRetry={() => void profile.refetch()} />;

  const data = profile.data;
  const isStore = data.type === 'STORE';
  const perms = membership.permissions;
  const canLegal = perms.includes('org.edit_legal') && !data.legal_locked;
  const canContacts = perms.includes('org.edit_contacts');
  const editable = new Set<Field>([
    ...(perms.includes('org.edit_legal') ? (['name'] as Field[]) : []),
    ...(canLegal ? LEGAL : []), ...(canContacts ? CONTACTS.filter((f) => isStore || (f !== 'latitude' && f !== 'longitude')) : [])]);
  const date = (value: string | null) => formatDate(value) ?? '—';
  const message = (field: Field) => {
    const key = errors[field]?.message;
    return key ? (key.startsWith('validation.') ? t(key) : key) : undefined;
  };
  const failure = update.error instanceof ApiError && update.error.code === 'validation_error' ? null : update.error;

  const onSubmit = form.handleSubmit(async (values) => {
    setSaved(false);
    // Mirrors the server: a company keeps its INN, and a store has both coordinates or neither.
    if (!isStore && editable.has('tax_identifier') && !values.tax_identifier.trim()) {
      form.setError('tax_identifier', { message: 'validation.required' }, { shouldFocus: true });
      return;
    }
    if (isStore && Boolean(values.latitude.trim()) !== Boolean(values.longitude.trim())) {
      form.setError(values.latitude.trim() ? 'longitude' : 'latitude', { message: 'validation.coordinatesBoth' }, { shouldFocus: true });
      return;
    }
    const changes = changesOf(data, values, editable);
    if (Object.keys(changes).length === 1) return; // only `version`: nothing changed
    try {
      await update.mutateAsync(changes);
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'version_conflict') void profile.refetch();
      if (error instanceof ApiError && error.code === 'validation_error') {
        error.fieldErrors.forEach((field) => {
          if (field.field in values) form.setError(field.field as Field, { message: field.message || t('errors.validation_error') });
        });
      }
    }
  });

  const field = (name: Field, label: string, props: Record<string, unknown> = {}) => (
    <FormField label={label} error={message(name)}>
      <Input {...props} readOnly={!editable.has(name)} aria-readonly={!editable.has(name)} {...form.register(name)} />
    </FormField>
  );

  return (
    <div className="space-y-6">
      <ProfileHeader
        mark={
          <Avatar
            kind={isStore ? 'store' : 'company'}
            size="xl"
            verified={data.verification_status === 'APPROVED'}
            src={data.logo_url}
            alt={t(isStore ? 'images.storeImage.alt' : 'images.companyLogo.alt', { name: data.name })}
          />
        }
        eyebrow={
          <>
            <Pill>{t(`orgTypes.${data.type}`)}</Pill>
            <StatusBadge kind="verification" value={data.verification_status} />
          </>
        }
        title={data.name}
        subtitle={t(isStore ? 'orgProfile.storeTitle' : 'orgProfile.companyTitle')}
        chips={
          <>
            <MetaChip icon={MapPin}>
              {data.city}, {data.address}
            </MetaChip>
            <MetaChip icon={Phone}>
              <span className="font-data">{data.phone}</span>
            </MetaChip>
          </>
        }
        stats={
          <>
            <StatCard icon={KeyRound} label={t('entity.yourRole')} value={t(`roles.${membership.role}`)} />
            <TeamSize />
            <StatCard
              icon={FileText}
              label={t('entity.verification')}
              value={t(`verification.status.${data.verification_status}`)}
              hint={data.verification_status === 'APPROVED' ? date(data.verified_at) : undefined}
            />
            {data.public_code ? (
              <StatCard icon={Hash} label={t('orgProfile.publicCode')} value={<span className="font-data tracking-widest">{data.public_code}</span>} />
            ) : null}
          </>
        }
        aside={<ResponsiblePerson />}
      />

      <SettingsTabs />

      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={onSubmit} noValidate className="space-y-6 lg:col-span-2">
          <Card className="space-y-4 p-5 sm:p-6">
            <SectionHeader
              icon={FileText}
              title={t('orgProfile.requisites')}
              subtitle={t('orgProfile.requisitesHint')}
              chip={data.legal_locked ? <Badge tone="neutral"><Lock className="size-3" aria-hidden="true" /> {t('orgProfile.locked')}</Badge> : null}
            />
            {data.legal_locked ? (
              <Alert tone="info">{t(data.verification_status === 'APPROVED' ? 'orgProfile.lockedApproved' : 'orgProfile.lockedPending')}</Alert>
            ) : !perms.includes('org.edit_legal') ? (
              <Alert tone="info">{t('orgProfile.legalOwnerOnly')}</Alert>
            ) : null}
            {field('name', isStore ? t('onboarding.storeName') : t('onboarding.companyName'), { maxLength: 200 })}
            {field('legal_name', t('onboarding.fields.legalName'), { maxLength: 255 })}
            {field('tax_identifier', t('onboarding.fields.taxIdentifier'), { inputMode: 'numeric', maxLength: 12 })}
          </Card>

          <Card className="space-y-4 p-5 sm:p-6">
            <SectionHeader icon={Phone} title={t('orgProfile.contacts')} subtitle={canContacts ? t('orgProfile.contactsHint') : t('orgProfile.readOnly')} />
            <div className="grid gap-4 sm:grid-cols-2">
              {field('phone', t('onboarding.fields.phone'), { type: 'tel', maxLength: 20 })}
              {field('email', t('onboarding.fields.email'), { type: 'email', maxLength: 254 })}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {field('city', t('onboarding.fields.city'), { maxLength: 100 })}
              <div className="sm:col-span-2">{field('address', t('onboarding.fields.address'), { maxLength: 500 })}</div>
            </div>
            {isStore ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {field('latitude', t('onboarding.fields.latitude'), { inputMode: 'decimal', maxLength: 11 })}
                {field('longitude', t('onboarding.fields.longitude'), { inputMode: 'decimal', maxLength: 11 })}
              </div>
            ) : null}
          </Card>

          {saved ? <Alert tone="success">{t('orgProfile.saved')}</Alert> : null}
          {failure ? (
            <Alert tone="danger">
              {failure instanceof ApiError && failure.code === 'version_conflict' ? t('orgProfile.conflict') : errorMessage(failure, t)}
            </Alert>
          ) : null}
          {editable.size > 0 ? (
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => form.reset(toValues(data))}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={update.isPending} className="sm:min-w-44">
                {t('orgProfile.save')}
              </Button>
            </div>
          ) : null}
        </form>

        <div className="space-y-6">
          {/* CR-003: company logo / store image - one endpoint; editing needs org.edit_branding (OWNER), viewing org.view. */}
          <ImagePicker
            subject={isStore ? 'storeImage' : 'companyLogo'}
            name={data.name}
            src={data.logo_url}
            canEdit={perms.includes('org.edit_branding')}
            onUpload={(file) => uploadImage.mutateAsync(file)}
            onRemove={() => removeImage.mutateAsync()}
          />

          {canViewVerification ? (
            <Card className="p-5 sm:p-6">
              <SectionHeader icon={FileText} title={t('orgProfile.documents')} chip={<StatusBadge kind="verification" value={data.verification_status} />} />
              {verification.isPending ? (
                <Skeleton className="mt-4 h-16" />
              ) : verification.data?.latest_request?.documents.length ? (
                <ul className="mt-4 space-y-2">
                  {verification.data.latest_request.documents.map((document) => (
                    <li key={document.id} className="flex items-center gap-3 rounded-xl border bg-subtle/40 px-3 py-2.5">
                      <FileText className="size-4 shrink-0 text-danger" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate text-label font-medium">{t(`verification.docTypes.${document.doc_type}`)}</p>
                        <p className="truncate text-caption text-muted-foreground">{document.file.display_name}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-label text-muted-foreground">{t('orgProfile.documentsEmpty')}</p>
              )}
              <Button asChild variant="secondary" block className="mt-4">
                <Link to={`/${area}/settings/verification`}>{t('orgProfile.openVerification')}</Link>
              </Button>
            </Card>
          ) : null}

          {isStore ? (
            <Card className="p-5 sm:p-6">
              <SectionHeader icon={MapPin} title={t('orgProfile.location')} />
              <dl className="mt-3 divide-y">
                <InfoRow label={t('onboarding.fields.address')} value={`${data.city}, ${data.address}`} />
                <InfoRow label={t('onboarding.fields.coordinates')} value={data.latitude ? `${data.latitude}, ${data.longitude}` : t('onboarding.notProvided')} />
              </dl>
              {data.latitude && data.longitude ? (
                <Button asChild variant="secondary" block className="mt-3">
                  <a href={`https://www.google.com/maps/search/?api=1&query=${data.latitude},${data.longitude}`} target="_blank" rel="noopener noreferrer">
                    {t('orgProfile.openMap')}
                  </a>
                </Button>
              ) : null}
            </Card>
          ) : (
            <Card className="p-5 sm:p-6">
              <SectionHeader icon={Hash} title={t('orgProfile.publicCode')} />
              <p className="mt-3 font-data text-2xl font-semibold tracking-[0.3em] text-primary">{data.public_code}</p>
              <p className="mt-2 text-label text-muted-foreground">{t('orgProfile.publicCodeHint')}</p>
            </Card>
          )}

          <PlannedPanel icon={Users} title={t('orgProfile.partners')} description={t('orgProfile.partnersText')} phase="P06" />
        </div>
      </div>
    </div>
  );
}
