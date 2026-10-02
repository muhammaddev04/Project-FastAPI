import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, LocateFixed, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { JourneyShell } from '@/app/shell/journey-shell';
import { AuthForm, AuthPage } from '@/features/auth/auth-layout';
import { ApiError } from '@/shared/api/client';
import { errorMessage, fieldErrorMap } from '@/shared/api/errors';
import { AccountMenu } from '@/shared/auth/account-menu';
import { areaFor, areaHome } from '@/shared/auth/context';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Me, OrgType } from '@/shared/auth/types';
import { Alert, Button, ConfirmDialog, FormField, InfoRow, Input } from '@/shared/ui';
import { useCreateOrganization, type OrganizationPayload } from './api';

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
 * Step 4 of 5: the organization (Phase D).
 *
 * The form asks for exactly the fields `CompanyCreate` / `StoreCreate` reject a request without: the trading
 * name, the legal name, a phone, a city and an address, plus the taxpayer number, which the backend requires
 * for a Company and treats as optional for a Store. Everything the server accepts but does not require (the
 * business email, a Store's taxpayer number, a Store's coordinates) now sits behind one disclosure instead of
 * standing in the main column, so the screen opens with five or six fields rather than nine.
 *
 * The verification documents are not here at all. They belong to step 5, which is a different decision made by
 * a different person: a TezFarmo administrator.
 *
 * The confirmation step is the FE-002 preview, moved from a full second screen into the confirm dialog. Creating
 * an organization locks its legal details, so it keeps a confirmation; it did not need a page of its own.
 */
export function BusinessSetupPage({ me, type }: { me: Me; type: OrgType }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveOrg = useSessionStore((state) => state.setActiveOrg);
  const create = useCreateOrganization();
  const [confirming, setConfirming] = useState(false);
  const [locating, setLocating] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const isCompany = type === 'COMPANY';
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type,
      // The organization name given at registration, when this is the type that was chosen there.
      name: me.onboarding?.org_type === type ? (me.onboarding.org_name ?? '') : '',
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
  const serverFields = fieldErrorMap(create.error);
  const errors = form.formState.errors;
  const message = (field: Field) => {
    const key = errors[field]?.message;
    return key ? t(key) : serverFields[field];
  };
  const showGeneralError = create.isError && !(create.error instanceof ApiError && create.error.code === 'validation_error');

  // Zod skips object-level rules while another field is invalid; show them together with the field errors.
  const showCrossFieldErrors = () =>
    crossFieldErrors(form.getValues()).forEach(([name, problem]) => {
      if (!form.formState.errors[name]) form.setError(name, { message: problem });
    });
  const toConfirm = form.handleSubmit(() => setConfirming(true), showCrossFieldErrors);
  const onCreate = async () => {
    const values = form.getValues();
    const result = await create.mutateAsync({ type, payload: toPayload(values) }).catch(() => null);
    setConfirming(false);
    if (!result) return;
    setActiveOrg(result.organization.id);
    // Straight to step 5: nothing on this screen makes the organization verified.
    navigate(`${areaHome(areaFor(result.membership))}/settings/verification`, { replace: true });
  };

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
    <FormField size="lg" label={label} hint={hint} error={message(name)}>
      <Input size="lg" {...props} {...form.register(name)} />
    </FormField>
  );

  const values = form.getValues();
  const summary: [string, string | undefined][] = [
    [isCompany ? t('onboarding.companyName') : t('onboarding.storeName'), values.name],
    [t('onboarding.fields.legalName'), values.legal_name],
    [t('onboarding.fields.taxIdentifier'), optional(values.tax_identifier) ?? t('onboarding.notProvided')],
    [t('onboarding.fields.phone'), values.phone],
    [t('onboarding.fields.city'), values.city],
    [t('onboarding.fields.address'), values.address],
  ];
  if (!isCompany) {
    summary.push([
      t('onboarding.fields.coordinates'),
      values.latitude ? `${values.latitude}, ${values.longitude}` : t('onboarding.notProvided'),
    ]);
  }
  if (optional(values.email)) summary.push([t('onboarding.fields.email'), values.email.trim()]);

  return (
    <JourneyShell step="setup" width="wide" actions={<AccountMenu me={me} compact />}>
      <AuthPage
        step="setup"
        title={isCompany ? t('onboarding.setupCompany') : t('onboarding.setupStore')}
        lead={t('onboarding.setup.lead')}
      >
        <AuthForm onSubmit={toConfirm}>
          {field('name', isCompany ? t('onboarding.companyName') : t('onboarding.storeName'), { autoComplete: 'organization', maxLength: 200 }, t('onboarding.nameHint'))}
          {field('legal_name', t('onboarding.fields.legalName'), { maxLength: 255 }, t('onboarding.fields.legalNameHint'))}
          {isCompany
            ? field('tax_identifier', t('onboarding.fields.taxIdentifier'), { inputMode: 'numeric', maxLength: 12 }, t('onboarding.fields.taxIdentifierHint'))
            : null}
          {field('phone', t('onboarding.fields.phone'), { type: 'tel', autoComplete: 'tel', maxLength: 20 })}
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            {field('city', t('onboarding.fields.city'), { autoComplete: 'address-level2', maxLength: 100 })}
            {field('address', t('onboarding.fields.address'), { autoComplete: 'street-address', maxLength: 500 })}
          </div>

          <div className="rounded-xl border bg-subtle/40">
            <button
              type="button"
              aria-expanded={showOptional}
              onClick={() => setShowOptional((open) => !open)}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left text-body font-semibold"
            >
              {t('onboarding.setup.optionalTitle')}
              <ChevronDown className={showOptional ? 'size-4 rotate-180 transition-transform' : 'size-4 transition-transform'} aria-hidden="true" />
            </button>
            {showOptional ? (
              <div className="space-y-5 border-t px-3.5 py-4">
                {field('email', t('onboarding.fields.email'), { type: 'email', autoComplete: 'email', maxLength: 254 }, t('onboarding.setup.emailHint'))}
                {isCompany
                  ? null
                  : field('tax_identifier', t('onboarding.fields.taxIdentifier'), { inputMode: 'numeric', maxLength: 12 }, t('onboarding.fields.taxIdentifierHint'))}
                {isCompany ? null : (
                  <div className="space-y-2.5">
                    <div className="grid gap-5 sm:grid-cols-2">
                      {field('latitude', t('onboarding.fields.latitude'), { inputMode: 'decimal', maxLength: 11 })}
                      {field('longitude', t('onboarding.fields.longitude'), { inputMode: 'decimal', maxLength: 11 })}
                    </div>
                    <Button type="button" variant="secondary" size="sm" loading={locating} onClick={fillMyLocation}>
                      <LocateFixed aria-hidden="true" /> {t('onboarding.myLocation')}
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <Alert tone="info" title={t('onboarding.verifyTitle')}>
            {t('onboarding.verifyText')}
          </Alert>
          {showGeneralError ? <Alert tone="danger">{errorMessage(create.error, t)}</Alert> : null}
          <Button type="submit" block size="xl">
            {isCompany ? t('onboarding.createCompany') : t('onboarding.createStore')}
          </Button>
          <p className="text-label text-muted-foreground">{t('onboarding.ownerNote')}</p>
        </AuthForm>

        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          icon={ShieldCheck}
          title={t('onboarding.reviewTitle')}
          description={t('onboarding.reviewText')}
          confirmLabel={isCompany ? t('onboarding.createCompany') : t('onboarding.createStore')}
          cancelLabel={t('onboarding.edit')}
          loading={create.isPending}
          onConfirm={() => void onCreate()}
        >
          <dl className="divide-y rounded-xl border">
            {summary.map(([label, value]) => (
              <InfoRow key={label} label={label} value={value} className="px-3.5" />
            ))}
          </dl>
        </ConfirmDialog>
      </AuthPage>
    </JourneyShell>
  );
}
