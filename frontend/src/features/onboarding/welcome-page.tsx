import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Building2, ClipboardCheck, LocateFixed } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '@/shared/api/client';
import { errorMessage, fieldErrorMap } from '@/shared/api/errors';
import { AccountMenu } from '@/shared/auth/account-menu';
import { areaFor, areaHome, isUsable } from '@/shared/auth/context';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Me, OrgType } from '@/shared/auth/types';
import { StandaloneLayout } from '@/app/shell/standalone-layout';
import { Alert, Avatar, Badge, Button, Card, CardHeader, FormField, InfoRow, Input, PageHeader, SectionHeader } from '@/shared/ui';
import { useCreateOrganization, type OrganizationPayload } from './api';
import { OrgTypeChoice } from './org-type-choice';

const optional = (value: string) => (value.trim() ? value.trim() : undefined);
const coordinate = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((value) => !value || (/^-?\d{1,3}(\.\d{1,6})?$/.test(value) && Number(value) >= min && Number(value) <= max), 'validation.coordinate');

/** P02 §1: the same rules the server applies (it validates again). */
const schema = z
  .object({
    type: z.enum(['COMPANY', 'STORE']),
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
  })
  .superRefine((values, ctx) => {
    crossFieldErrors(values).forEach(([path, message]) => ctx.addIssue({ code: 'custom', path: [path], message }));
  });
type FormValues = z.infer<typeof schema>;
type Field = Exclude<keyof FormValues, 'type'>;

/** Rules that depend on the organization type (tax id required for a Company; Store coordinates in pairs). */
function crossFieldErrors(values: Pick<FormValues, 'type' | 'tax_identifier' | 'latitude' | 'longitude'>): [Field, string][] {
  const found: [Field, string][] = [];
  if (values.type === 'COMPANY' && !values.tax_identifier.trim()) found.push(['tax_identifier', 'validation.required']);
  if (values.type === 'STORE' && Boolean(values.latitude.trim()) !== Boolean(values.longitude.trim())) {
    found.push([values.latitude.trim() ? 'longitude' : 'latitude', 'validation.coordinatesBoth']);
  }
  return found;
}

function toPayload(values: FormValues): OrganizationPayload {
  const payload: OrganizationPayload = {
    name: values.name.trim(),
    legal_name: values.legal_name.trim(),
    tax_identifier: optional(values.tax_identifier),
    phone: values.phone.replace(/[\s()-]/g, ''),
    email: optional(values.email),
    city: values.city.trim(),
    address: values.address.trim(),
  };
  if (values.type === 'STORE') {
    payload.latitude = optional(values.latitude);
    payload.longitude = optional(values.longitude);
  }
  return payload;
}

/**
 * /welcome (ORG-001/002, P02 §8): details → review → create. The organization starts NOT_SUBMITTED and is not
 * verified by filling this form; the next page asks for the verification documents a TezFarmo administrator checks.
 */
export function WelcomePage({ me, fixedType }: { me: Me; fixedType?: OrgType }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveOrg = useSessionStore((state) => state.setActiveOrg);
  const create = useCreateOrganization();
  const [reviewing, setReviewing] = useState(false);
  const [locating, setLocating] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: fixedType ?? 'COMPANY',
      // The organization name given at registration, when this is the type chosen there.
      name: fixedType && me.onboarding?.org_type === fixedType ? (me.onboarding.org_name ?? '') : '',
      legal_name: '',
      tax_identifier: '',
      phone: '+992',
      email: '',
      city: '',
      address: '',
      latitude: '',
      longitude: '',
    },
  });
  const selected = form.watch('type');
  const existing = me.memberships.filter(isUsable);
  const serverFields = fieldErrorMap(create.error);
  const errors = form.formState.errors;
  const message = (field: Field) => {
    const key = errors[field]?.message;
    return key ? t(key) : serverFields[field];
  };
  const showGeneralError = create.isError && !(create.error instanceof ApiError && create.error.code === 'validation_error');

  // Zod skips object-level rules while another field is invalid; show them together with the field errors.
  const showCrossFieldErrors = () =>
    crossFieldErrors(form.getValues()).forEach(([name, message]) => {
      if (!form.formState.errors[name]) form.setError(name, { message });
    });
  const toReview = form.handleSubmit(() => setReviewing(true), showCrossFieldErrors);
  const onCreate = form.handleSubmit(async (values) => {
    const result = await create.mutateAsync({ type: values.type, payload: toPayload(values) }).catch(() => null);
    if (!result) {
      setReviewing(false);
      return;
    }
    setActiveOrg(result.organization.id);
    // Straight to the documents step: nothing here makes the organization verified.
    navigate(`${areaHome(areaFor(result.membership))}/settings/verification`, { replace: true });
  });

  const fillMyLocation = () => {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        form.setValue('latitude', position.coords.latitude.toFixed(6), { shouldValidate: true });
        form.setValue('longitude', position.coords.longitude.toFixed(6), { shouldValidate: true });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const field = (name: Field, label: string, props: Record<string, unknown> = {}, hint?: string) => (
    <FormField label={label} hint={hint} error={message(name)}>
      <Input {...props} {...form.register(name)} />
    </FormField>
  );
  const values = form.getValues();
  const summary: [string, string | undefined][] = [
    [selected === 'COMPANY' ? t('onboarding.companyName') : t('onboarding.storeName'), values.name],
    [t('onboarding.fields.legalName'), values.legal_name],
    [t('onboarding.fields.taxIdentifier'), optional(values.tax_identifier) ?? t('onboarding.notProvided')],
    [t('onboarding.fields.phone'), values.phone],
    [t('onboarding.fields.email'), optional(values.email) ?? t('onboarding.notProvided')],
    [t('onboarding.fields.city'), values.city],
    [t('onboarding.fields.address'), values.address],
  ];
  if (selected === 'STORE') {
    summary.push([t('onboarding.fields.coordinates'), values.latitude ? `${values.latitude}, ${values.longitude}` : t('onboarding.notProvided')]);
  }

  return (
    <StandaloneLayout actions={<AccountMenu me={me} compact />}>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="animate-fade-in">
          <PageHeader
            eyebrow={t('onboarding.eyebrow')}
            title={t('onboarding.title', { name: me.full_name.split(' ')[0] })}
            description={t('onboarding.subtitle')}
          />
        </div>

        {existing.length > 0 ? (
          <Card className="mt-8 overflow-hidden">
            <CardHeader icon={<Building2 />} title={t('onboarding.existingTitle')} />
            <ul className="divide-y">
              {existing.map((membership) => (
                <li key={membership.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-primary/[0.04]"
                    onClick={() => {
                      setActiveOrg(membership.organization_id);
                      navigate(areaHome(areaFor(membership)));
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar kind={membership.org_type === 'STORE' ? 'store' : 'company'} size="md" className="rounded-xl" />
                      <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{membership.org_name}</span>
                      <span className="text-[0.8125rem] text-muted-foreground">{t(`roles.${membership.role}`)}</span>
                      </span>
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

        <form onSubmit={reviewing ? onCreate : toReview} noValidate className="mt-8 space-y-6">
          {reviewing ? null : fixedType ? (
            <div className="flex items-center gap-3">
              <Avatar kind={fixedType === 'COMPANY' ? 'company' : 'store'} size="lg" />
              <h2 className="font-display text-xl font-bold">{fixedType === 'COMPANY' ? t('onboarding.setupCompany') : t('onboarding.setupStore')}</h2>
            </div>
          ) : (
            <OrgTypeChoice selected={selected} field={form.register('type')} legend={t('onboarding.typeLegend')} />
          )}

          <Alert tone="info" title={t('onboarding.verifyTitle')}>
            {t('onboarding.verifyText')}
          </Alert>

          {reviewing ? (
            <Card className="p-5 sm:p-6">
              <SectionHeader icon={ClipboardCheck} title={t('onboarding.reviewTitle')} />
              <dl className="mt-3 divide-y">
                {summary.map(([label, value]) => (
                  <InfoRow key={label} label={label} value={value} />
                ))}
              </dl>
              {showGeneralError ? (
                <Alert tone="danger" className="mt-4">
                  {errorMessage(create.error, t)}
                </Alert>
              ) : null}
              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" onClick={() => setReviewing(false)}>
                  {t('onboarding.edit')}
                </Button>
                <Button type="submit" variant="brand" size="lg" loading={create.isPending} className="sm:min-w-48">
                  {selected === 'COMPANY' ? t('onboarding.createCompany') : t('onboarding.createStore')}
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="space-y-4 p-5 sm:p-6">
              {field('name', selected === 'COMPANY' ? t('onboarding.companyName') : t('onboarding.storeName'), { autoComplete: 'organization', maxLength: 200 }, t('onboarding.nameHint'))}
              {field('legal_name', t('onboarding.fields.legalName'), { maxLength: 255 }, t('onboarding.fields.legalNameHint'))}
              {field(
                'tax_identifier',
                selected === 'COMPANY' ? t('onboarding.fields.taxIdentifier') : `${t('onboarding.fields.taxIdentifier')} (${t('onboarding.optional')})`,
                { inputMode: 'numeric', maxLength: 12 },
                t('onboarding.fields.taxIdentifierHint'),
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {field('phone', t('onboarding.fields.phone'), { type: 'tel', autoComplete: 'tel', maxLength: 20 })}
                {field('email', `${t('onboarding.fields.email')} (${t('onboarding.optional')})`, { type: 'email', autoComplete: 'email', maxLength: 254 })}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {field('city', t('onboarding.fields.city'), { autoComplete: 'address-level2', maxLength: 100 })}
                <div className="sm:col-span-2">{field('address', t('onboarding.fields.address'), { autoComplete: 'street-address', maxLength: 500 })}</div>
              </div>
              {selected === 'STORE' ? (
                <div className="space-y-2">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field('latitude', `${t('onboarding.fields.latitude')} (${t('onboarding.optional')})`, { inputMode: 'decimal', maxLength: 11 })}
                    {field('longitude', `${t('onboarding.fields.longitude')} (${t('onboarding.optional')})`, { inputMode: 'decimal', maxLength: 11 })}
                  </div>
                  <Button type="button" variant="secondary" size="sm" loading={locating} onClick={fillMyLocation}>
                    <LocateFixed aria-hidden="true" /> {t('onboarding.myLocation')}
                  </Button>
                </div>
              ) : null}
              {showGeneralError ? <Alert tone="danger">{errorMessage(create.error, t)}</Alert> : null}
              <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[0.8125rem] text-muted-foreground">{t('onboarding.ownerNote')}</p>
                <Button type="submit" className="sm:min-w-44">
                  {t('onboarding.review')}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </div>
            </Card>
          )}
        </form>
      </div>
    </StandaloneLayout>
  );
}
