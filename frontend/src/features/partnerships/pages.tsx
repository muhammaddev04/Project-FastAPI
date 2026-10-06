import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { useCatalogMutation, useCatalogQuery, type Page } from '@/features/catalog/api';
import { useBillingQuery, type Access } from '@/features/subscriptions/api';
import { Feedback, Field } from '@/features/catalog/shared';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogHeader,
  ForbiddenState,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from '@/shared/ui';
import { errorMessage } from '@/shared/api/errors';
import { formatDateTime } from '@/shared/lib/datetime';
import { canAct, statuses, type Lookup, type Partnership, type Terms } from './api';
import { TermsForm, TermsSummary } from './terms';

function useAccess() {
  const { membership } = useAreaContext();
  const side = membership.org_type === 'STORE' ? 'STORE' : 'COMPANY';
  const company = side === 'COMPANY';
  const orgId = membership.organization_id;
  const access = useBillingQuery<Access>('/subscription/access', company ? orgId : null);
  return {
    membership,
    side,
    company,
    orgId,
    base: company ? '/company/partners' : '/store/suppliers',
    allowed: membership.permissions.includes('partners.view'),
    canNew: membership.permissions.includes('partners.manage') && (!company || !!access.data?.allowed_actions.includes('PARTNERSHIP_NEW')),
    canWrite: membership.permissions.includes('terms.manage') && !!access.data?.allowed_actions.includes('CATALOG_WRITE'),
    canCredit: membership.permissions.includes('terms.manage_credit'),
  } as const;
}

export function PartnersPage() {
  const { t } = useTranslation();
  const { orgId, company, allowed, canNew, base } = useAccess();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [create, setCreate] = useState(false);
  const invitations = params.get('tab') === 'invitations';
  const status = invitations ? 'PENDING' : (params.get('status') ?? '');
  const query = useCatalogQuery<Page<Partnership>>(
    `/partnerships?${new URLSearchParams({ limit: '20', offset: String(offset), search, ...(status ? { status } : {}), ...(invitations ? { initiated_by_side: 'COMPANY' } : {}) })}`,
    orgId,
    allowed,
  );
  const pending = useCatalogQuery<Page<Partnership>>(
    `/partnerships?status=PENDING&limit=1&initiated_by_side=${company ? 'STORE' : 'COMPANY'}`,
    orgId,
    allowed,
  );
  if (!allowed) return <ForbiddenState />;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t(company ? 'partnerships.clients' : 'partnerships.suppliers')}
        actions={
          canNew ? (
            <Button onClick={() => setCreate(true)}>{t(company ? 'partnerships.invite' : 'partnerships.request')}</Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('partnerships.status')}>
        <Button
          variant={!status ? 'primary' : 'outline'}
          onClick={() => {
            setParams({});
            setOffset(0);
          }}
        >
          {t('partnerships.all')}
        </Button>
        {statuses.map((value) => (
          <Button
            key={value}
            variant={status === value ? 'primary' : 'outline'}
            onClick={() => {
              setParams({ status: value });
              setOffset(0);
            }}
          >
            {t(`partnerships.statuses.${value}`)}
            {value === 'PENDING' && pending.data?.count ? ` (${pending.data.count})` : ''}
          </Button>
        ))}
        {!company && (
          <Button
            variant={invitations ? 'primary' : 'outline'}
            onClick={() => {
              setParams({ tab: 'invitations' });
              setOffset(0);
            }}
          >
            {t('partnerships.invitations')}
          </Button>
        )}
      </div>
      <Input
        aria-label={t('partnerships.search')}
        placeholder={t('partnerships.search')}
        value={search}
        maxLength={100}
        onChange={(e) => {
          setSearch(e.target.value);
          setOffset(0);
        }}
      />
      <Feedback error={query.error} />
      <DataTable
        rows={query.data?.results ?? []}
        loading={query.isLoading}
        rowKey={(row) => row.id}
        empty={{ title: t('partnerships.empty') }}
        columns={[
          {
            key: 'name',
            header: t('partnerships.partner'),
            primary: true,
            cell: (row) => (
              <Link className="font-medium text-primary" to={`${base}/${row.id}`}>
                {row.partner?.name}
              </Link>
            ),
          },
          { key: 'city', header: t('partnerships.city'), cell: (row) => row.partner?.city },
          { key: 'code', header: t('partnerships.customerCode'), cell: (row) => row.customer_code ?? '—' },
          {
            key: 'credit',
            header: t('partnerships.fields.credit_limit'),
            numeric: true,
            cell: (row) => row.current_terms?.credit_limit ?? '—',
          },
          { key: 'status', header: t('partnerships.status'), cell: (row) => t(`partnerships.statuses.${row.status}`) },
        ]}
      />
      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={offset === 0} onClick={() => setOffset((old) => Math.max(0, old - 20))}>
          {t('table.previous')}
        </Button>
        <span>{query.data?.count ?? 0}</span>
        <Button variant="outline" disabled={offset + 20 >= (query.data?.count ?? 0)} onClick={() => setOffset((old) => old + 20)}>
          {t('table.next')}
        </Button>
      </div>
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent>
          <DialogHeader title={t(company ? 'partnerships.invite' : 'partnerships.request')} />
          {create && (company ? <InviteForm onDone={() => setCreate(false)} /> : <RequestForm onDone={() => setCreate(false)} />)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { orgId, canCredit } = useAccess();
  const [kind, setKind] = useState('phone');
  const [key, setKey] = useState('');
  const [lookupKey, setLookupKey] = useState('');
  const [store, setStore] = useState<Lookup | null>(null);
  const [code, setCode] = useState('');
  const lookup = useCatalogQuery<Lookup[]>(`/partnerships/store-lookup?${lookupKey}`, orgId, !!lookupKey);
  const invite = useCatalogMutation<Partnership>('/partnerships/invite', orgId, 'POST', true);
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">{t('partnerships.exactLookup')}</p>
      <Field label={t('partnerships.lookupBy')}>
        <Select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setStore(null);
            setLookupKey('');
          }}
        >
          <option value="phone">{t('partnerships.phone')}</option>
          <option value="tax_identifier">{t('partnerships.taxIdentifier')}</option>
        </Select>
      </Field>
      <Field label={t(kind === 'phone' ? 'partnerships.phone' : 'partnerships.taxIdentifier')}>
        <Input
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setStore(null);
          }}
        />
      </Field>
      <Button
        variant="outline"
        disabled={!key.trim()}
        onClick={() => {
          setStore(null);
          setLookupKey(new URLSearchParams({ [kind]: key.trim() }).toString());
        }}
      >
        {t('partnerships.lookup')}
      </Button>
      <Feedback error={lookup.error} />
      {lookup.isLoading && lookupKey && <Skeleton className="h-8" />}
      {lookup.data?.length === 0 && <p>{t('partnerships.notFound')}</p>}
      {lookup.data?.map((row) => (
        <Button key={row.id} variant={store?.id === row.id ? 'primary' : 'outline'} onClick={() => setStore(row)}>
          {row.name} · {row.city}
        </Button>
      ))}
      {store && (
        <>
          <Field label={t('partnerships.customerCode')}>
            <Input maxLength={32} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <TermsForm
            key={store.id}
            orgId={orgId}
            canCredit={canCredit}
            pending={invite.isPending}
            error={invite.error}
            buttonLabel={t('partnerships.invite')}
            onSubmit={(terms) => invite.mutate({ store_id: store.id, customer_code: code.trim() || null, terms }, { onSuccess: onDone })}
          />
        </>
      )}
    </div>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { orgId } = useAccess();
  const [code, setCode] = useState('');
  const request = useCatalogMutation<Partnership>('/partnerships/request', orgId, 'POST', true);
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        request.mutate({ company_public_code: code }, { onSuccess: onDone });
      }}
    >
      <Field label={t('partnerships.publicCode')}>
        <Input
          required
          minLength={8}
          maxLength={8}
          pattern="[A-HJ-NP-Z2-9]{8}"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </Field>
      <Feedback error={request.error} />
      <Button type="submit" loading={request.isPending}>
        {t('partnerships.request')}
      </Button>
    </form>
  );
}

export function PartnerDetailPage() {
  const { t } = useTranslation();
  const { partnershipId } = useParams();
  const { orgId, company, side, membership, allowed, base, canWrite, canCredit } = useAccess();
  const query = useCatalogQuery<Partnership>(`/partnerships/${partnershipId}`, orgId, allowed, 60_000);
  const history = useCatalogQuery<Terms[]>(`/partnerships/${partnershipId}/terms`, orgId, allowed);
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [newTerms, setNewTerms] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const mutate = useCatalogMutation<Partnership>(`/partnerships/${partnershipId}/${action}`, orgId, 'POST', action === 'accept');
  const append = useCatalogMutation<Terms>(`/partnerships/${partnershipId}/terms`, orgId, 'POST', true);
  const patch = useCatalogMutation<Partnership>(`/partnerships/${partnershipId}`, orgId, 'PATCH');
  if (!allowed) return <ForbiddenState />;
  if (query.isLoading) return <Skeleton className="h-64" />;
  if (!query.data) return <Alert tone="danger">{errorMessage(query.error, t)}</Alert>;
  const partner = query.data;
  const profile = partner.partner;
  const needsTerms = action === 'accept' && company && !partner.current_terms && !partner.future_terms?.length;
  const reasonRequired = action === 'suspend' || action === 'terminate';
  const finish = () => {
    setAction('');
    setReason('');
    setName('');
    mutate.reset();
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title={profile?.name ?? t('partnerships.partner')}
        actions={
          <Button asChild variant="outline">
            <Link to={base}>{t(company ? 'partnerships.clients' : 'partnerships.suppliers')}</Link>
          </Button>
        }
      />
      <p className="font-medium">{t(`partnerships.statuses.${partner.status}`)}</p>
      <Card className="grid gap-3 p-5 sm:grid-cols-2">
        {profile && (
          <>
            <div>{profile.phone}</div>
            <div>{profile.city}</div>
            <div className="break-words">{profile.address}</div>
            <div>{t(`verification.status.${profile.verification_status}`, { defaultValue: profile.verification_status })}</div>
            {profile.email && <div>{profile.email}</div>}
            {profile.tax_identifier && <div>{profile.tax_identifier}</div>}
            {profile.latitude != null && profile.longitude != null && (
              <a
                className="text-primary"
                href={`https://www.google.com/maps?q=${encodeURIComponent(`${profile.latitude},${profile.longitude}`)}`}
                target="_blank"
                rel="noreferrer"
              >
                {t('partnerships.openMap')}
              </a>
            )}
          </>
        )}
      </Card>
      {company && membership.permissions.includes('partners.manage') && (
        <Card className="space-y-3 p-5">
          <Field label={t('partnerships.customerCode')}>
            <Input maxLength={32} value={code ?? partner.customer_code ?? ''} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Button
            loading={patch.isPending}
            onClick={() =>
              patch.mutate(
                { customer_code: (code ?? partner.customer_code ?? '').trim() || null, version: partner.version },
                { onSuccess: () => setCode(null) },
              )
            }
          >
            {t('common.save')}
          </Button>
          <Feedback error={patch.error} success={patch.isSuccess} />
        </Card>
      )}
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">{t('partnerships.currentTerms')}</h2>
        {partner.current_terms ? <TermsSummary terms={partner.current_terms} /> : <p>{t('partnerships.noTerms')}</p>}
        {canWrite && ['PENDING', 'ACTIVE', 'SUSPENDED'].includes(partner.status) && (
          <Button onClick={() => setNewTerms(true)}>{t('partnerships.newTerms')}</Button>
        )}
      </Card>
      {!!partner.future_terms?.length && (
        <Card className="space-y-4 p-5">
          <h2 className="font-semibold">{t('partnerships.futureTerms')}</h2>
          {partner.future_terms.map((terms) => (
            <div key={terms.id}>
              <h3 className="mb-3 font-medium">
                {t('partnerships.version', { version: terms.version_no })} · {formatDateTime(terms.effective_from)}
              </h3>
              <TermsSummary terms={terms} />
            </div>
          ))}
        </Card>
      )}
      <div className="flex flex-wrap gap-2">
        {['accept', 'decline', 'cancel', 'suspend', 'reactivate', 'terminate']
          .filter((value) => canAct(partner, side, membership.permissions, value))
          .map((value) => (
            <Button
              key={value}
              variant={value === 'terminate' ? 'danger' : 'outline'}
              onClick={() => {
                mutate.reset();
                setAction(value);
                setReason('');
                setName('');
              }}
            >
              {t(`partnerships.actions.${value}`)}
            </Button>
          ))}
      </div>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">{t('partnerships.history')}</h2>
        <Feedback error={history.error} />
        {history.data?.map((terms, index) => (
          <details key={terms.id}>
            <summary className="cursor-pointer font-medium">
              {t('partnerships.version', { version: terms.version_no })} · {formatDateTime(terms.effective_from)}
            </summary>
            <div className="mt-3">
              <TermsSummary terms={terms} previous={history.data?.[index - 1]} />
            </div>
          </details>
        ))}
      </Card>
      <ConfirmDialog
        open={!!action && !needsTerms}
        onOpenChange={(open) => {
          if (!open) finish();
        }}
        title={t(`partnerships.actions.${action || 'accept'}`)}
        description={t('partnerships.confirmAction', { name: profile?.name })}
        confirmLabel={t('common.confirm')}
        loading={mutate.isPending}
        tone={action === 'terminate' ? 'danger' : 'primary'}
        confirmDisabled={(reasonRequired && !reason.trim()) || (action === 'terminate' && name !== profile?.name)}
        onConfirm={() => mutate.mutate(action === 'accept' ? {} : { reason: reason.trim() || null }, { onSuccess: finish })}
      >
        <div className="space-y-4">
          {action === 'accept' && (partner.current_terms ?? partner.future_terms?.[0]) && (
            <TermsSummary terms={(partner.current_terms ?? partner.future_terms?.[0])!} />
          )}
          {['suspend', 'terminate', 'decline'].includes(action) && (
            <Field label={t('partnerships.reason')}>
              <Input maxLength={5000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          {action === 'terminate' && (
            <Field label={t('partnerships.confirmName', { name: profile?.name })}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          <Feedback error={mutate.error} />
        </div>
      </ConfirmDialog>
      <Dialog
        open={needsTerms}
        onOpenChange={(open) => {
          if (!open) finish();
        }}
      >
        <DialogContent>
          <DialogHeader title={t('partnerships.actions.accept')} />
          {needsTerms && (
            <TermsForm
              orgId={orgId}
              canCredit={canCredit}
              pending={mutate.isPending}
              error={mutate.error}
              buttonLabel={t('partnerships.actions.accept')}
              onSubmit={(terms) => mutate.mutate({ terms }, { onSuccess: finish })}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={newTerms}
        onOpenChange={(open) => {
          if (!append.isPending) setNewTerms(open);
        }}
      >
        <DialogContent>
          <DialogHeader title={t('partnerships.newTerms')} />
          {newTerms && (
            <TermsForm
              orgId={orgId}
              current={partner.current_terms ?? partner.future_terms?.[0]}
              canCredit={canCredit}
              pending={append.isPending}
              error={append.error}
              buttonLabel={t('common.confirm')}
              onSubmit={(terms) => append.mutate(terms, { onSuccess: () => setNewTerms(false) })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
