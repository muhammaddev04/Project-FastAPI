import { Ban, KeyRound, ShieldCheck, Store, UserCog } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Feedback } from '@/features/catalog/shared';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  toast,
  type Column,
} from '@/shared/ui';
import {
  PAGE_SIZE,
  useAdminDashboard,
  useAdminOrganization,
  useAdminOrganizations,
  useAdminUser,
  useAdminUsers,
  useOrganizationAction,
  useOrganizationOrders,
  useSupportStatement,
  useUserAction,
  type AdminOrganization,
  type AdminUser,
} from './platform-api';

const MIN_REASON = 10;

/**
 * §3: no admin change is accepted without a reason, so the reason is asked for in the dialog that performs
 * the action rather than afterwards. The server refuses a short one with `override_reason_required`; the
 * dialog keeps the button disabled until the text is long enough, so that refusal stays rare.
 */
export function ReasonDialog({
  open,
  title,
  description,
  pending,
  onCancel,
  onConfirm,
  children,
  confirmLabel,
}: {
  open: boolean;
  title: string;
  description?: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
  confirmLabel?: string;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader title={title} description={description} />
        {children}
        <label className="grid gap-2 text-sm">
          {t('admin.reason')}
          <Textarea value={reason} rows={3} onChange={(event) => setReason(event.target.value)} placeholder={t('admin.reasonHint')} />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={reason.trim().length < MIN_REASON || pending} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminDashboardPage() {
  const { t } = useTranslation();
  const dashboard = useAdminDashboard();
  const data = dashboard.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.admin.dashboard')} description={t('admin.dashboard.description')} />
      <Feedback error={dashboard.error} />
      {dashboard.isLoading ? (
        <Skeleton className="h-40" />
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ['mrr', `${data.mrr} TJS`],
                ['verifications_pending', data.verifications_pending],
                ['outbox_failed', data.outbox_failed],
                ['reconciliation_issues', data.reconciliation_issues],
                ['notifications_failed_24h', data.notifications_failed_24h],
              ] as const
            ).map(([key, value]) => (
              <Card key={key} className="p-4">
                <p className="text-sm text-muted-foreground">{t(`admin.dashboard.${key}`)}</p>
                <strong className="text-xl tabular-nums">{value}</strong>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-2 p-5">
              <h2 className="font-semibold">{t('admin.dashboard.organizations')}</h2>
              {Object.entries(data.organizations).map(([key, count]) => (
                <p key={key} className="flex items-center justify-between text-sm">
                  <span>{t(`admin.dashboard.org.${key}`, key)}</span>
                  <strong className="tabular-nums">{count}</strong>
                </p>
              ))}
            </Card>
            <Card className="space-y-2 p-5">
              <h2 className="font-semibold">{t('admin.dashboard.subscriptions')}</h2>
              {Object.entries(data.subscriptions).map(([key, count]) => (
                <p key={key} className="flex items-center justify-between text-sm">
                  <span>{t(`subscription.statuses.${key}`, key)}</span>
                  <strong className="tabular-nums">{count}</strong>
                </p>
              ))}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function AdminUsersPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const users = useAdminUsers({ search: search.trim() || undefined, status: status || undefined }, offset);

  const columns: Column<AdminUser>[] = [
    { key: 'full_name', header: t('admin.users.name'), primary: true, cell: (row) => row.full_name },
    { key: 'email', header: t('admin.users.email'), cell: (row) => row.email },
    { key: 'phone', header: t('admin.users.phone'), cell: (row) => row.phone ?? '—' },
    {
      key: 'status',
      header: t('admin.users.status'),
      cell: (row) => <Badge tone={row.status === 'ACTIVE' ? 'success' : 'danger'}>{t(`admin.users.statuses.${row.status}`)}</Badge>,
    },
    {
      key: 'last_login_at',
      header: t('admin.users.lastLogin'),
      cell: (row) => (row.last_login_at ? new Date(row.last_login_at).toLocaleString() : '—'),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.admin.users')} description={t('admin.users.description')} />
      <Feedback error={users.error} />
      <DataTable
        columns={columns}
        rows={users.data?.results}
        rowKey={(row) => row.id}
        caption={t('nav.admin.users')}
        density="compact"
        loading={users.isLoading}
        error={users.error ? <Feedback error={users.error} /> : undefined}
        onRetry={() => void users.refetch()}
        onRowClick={(row) => setSelected(row.id)}
        selectedKey={selected ?? undefined}
        toolbar={
          <div className="flex flex-wrap gap-2">
            <Input
              value={search}
              placeholder={t('admin.users.search')}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">{t('admin.users.anyStatus')}</option>
              <option value="ACTIVE">{t('admin.users.statuses.ACTIVE')}</option>
              <option value="BLOCKED">{t('admin.users.statuses.BLOCKED')}</option>
            </Select>
          </div>
        }
        pagination={{
          offset,
          limit: PAGE_SIZE,
          count: users.data?.count ?? 0,
          onChange: setOffset,
        }}
        empty={{ title: t('admin.users.empty') }}
      />
      <UserDetail userId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function UserDetail({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const detail = useAdminUser(userId);
  const action = useUserAction(userId ?? '');
  const [pending, setPending] = useState<'block' | 'unblock' | 'logout-all' | null>(null);
  const user = detail.data;

  return (
    <>
      <Dialog open={Boolean(userId)} onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent>
          <DialogHeader title={user?.full_name ?? t('nav.admin.users')} description={user?.email} />
          <Feedback error={detail.error ?? action.error} />
          {user ? (
            <div className="space-y-3 text-sm">
              <p>
                <Badge tone={user.status === 'ACTIVE' ? 'success' : 'danger'}>{t(`admin.users.statuses.${user.status}`)}</Badge>
              </p>
              <ul className="space-y-1">
                {user.memberships.map((membership) => (
                  <li key={`${membership.organization_id}-${membership.role}`} className="flex justify-between gap-3">
                    <span>{membership.organization_name}</span>
                    <span className="text-muted-foreground">
                      {t(`roles.${membership.role}`, membership.role)} · {membership.status}
                    </span>
                  </li>
                ))}
                {user.memberships.length === 0 ? <li className="text-muted-foreground">{t('admin.users.noMemberships')}</li> : null}
              </ul>
              <div className="flex flex-wrap gap-2">
                {user.status === 'ACTIVE' ? (
                  <Button variant="outline" onClick={() => setPending('block')}>
                    <Ban />
                    {t('admin.users.block')}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setPending('unblock')}>
                    <ShieldCheck />
                    {t('admin.users.unblock')}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setPending('logout-all')}>
                  <KeyRound />
                  {t('admin.users.logoutAll')}
                </Button>
              </div>
            </div>
          ) : (
            <Skeleton className="h-24" />
          )}
        </DialogContent>
      </Dialog>
      <ReasonDialog
        key={pending ?? 'closed'}
        open={pending !== null}
        title={pending ? t(`admin.users.${pending === 'logout-all' ? 'logoutAll' : pending}`) : ''}
        description={t('admin.reasonRequired')}
        pending={action.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => {
          if (!pending) return;
          action.mutate(
            { action: pending, reason },
            {
              onSuccess: () => {
                toast({ tone: 'success', title: t('admin.done') });
                setPending(null);
              },
            },
          );
        }}
      />
    </>
  );
}

const ORG_ACTIONS = ['suspend', 'block', 'activate'] as const;

export function AdminOrganizationsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const organizations = useAdminOrganizations(
    { search: search.trim() || undefined, type: type || undefined, status: status || undefined },
    offset,
  );

  const columns: Column<AdminOrganization>[] = [
    { key: 'name', header: t('admin.orgs.name'), primary: true, cell: (row) => row.name },
    { key: 'legal_name', header: t('admin.orgs.legalName'), cell: (row) => row.legal_name ?? '—' },
    {
      key: 'type',
      header: t('admin.orgs.type'),
      cell: (row) => <Badge tone="neutral">{t(`orgTypes.${row.type}`, row.type)}</Badge>,
    },
    {
      key: 'status',
      header: t('admin.orgs.status'),
      cell: (row) => (
        <Badge tone={row.status === 'ACTIVE' ? 'success' : row.status === 'SUSPENDED' ? 'warning' : 'danger'}>
          {t(`admin.orgs.statuses.${row.status}`)}
        </Badge>
      ),
    },
    {
      key: 'verification_status',
      header: t('admin.orgs.verification'),
      cell: (row) => (row.verification_status ? t(`verification.statuses.${row.verification_status}`, row.verification_status) : '—'),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.admin.organizations')} description={t('admin.orgs.description')} />
      <Feedback error={organizations.error} />
      <DataTable
        columns={columns}
        rows={organizations.data?.results}
        rowKey={(row) => row.id}
        caption={t('nav.admin.organizations')}
        density="compact"
        loading={organizations.isLoading}
        error={organizations.error ? <Feedback error={organizations.error} /> : undefined}
        onRetry={() => void organizations.refetch()}
        onRowClick={(row) => setSelected(row.id)}
        selectedKey={selected ?? undefined}
        toolbar={
          <div className="flex flex-wrap gap-2">
            <Input
              value={search}
              placeholder={t('admin.orgs.search')}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
            <Select
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">{t('admin.orgs.anyType')}</option>
              <option value="COMPANY">{t('orgTypes.COMPANY', 'COMPANY')}</option>
              <option value="STORE">{t('orgTypes.STORE', 'STORE')}</option>
            </Select>
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">{t('admin.orgs.anyStatus')}</option>
              {['ACTIVE', 'SUSPENDED', 'BLOCKED'].map((value) => (
                <option key={value} value={value}>
                  {t(`admin.orgs.statuses.${value}`)}
                </option>
              ))}
            </Select>
          </div>
        }
        pagination={{ offset, limit: PAGE_SIZE, count: organizations.data?.count ?? 0, onChange: setOffset }}
        empty={{ title: t('admin.orgs.empty') }}
      />
      <OrganizationDetail key={selected ?? 'closed'} organizationId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function OrganizationDetail({ organizationId, onClose }: { organizationId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const detail = useAdminOrganization(organizationId);
  const action = useOrganizationAction(organizationId ?? '');
  const [pending, setPending] = useState<string | null>(null);
  const [successor, setSuccessor] = useState('');
  const [previousOwnerRole, setPreviousOwnerRole] = useState('MANAGER');
  const [legalName, setLegalName] = useState('');
  const [taxIdentifier, setTaxIdentifier] = useState('');
  const [ordersReason, setOrdersReason] = useState('');
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [partnershipId, setPartnershipId] = useState('');
  const statement = useSupportStatement();
  const orders = useOrganizationOrders(organizationId, ordersReason, ordersOpen);
  const organization = detail.data;

  const confirm = (reason: string) => {
    if (!pending) return;
    const body: Record<string, unknown> = { reason };
    if (pending === 'transfer-ownership') {
      body.user_id = successor;
      body.previous_owner_role = previousOwnerRole;
    }
    if (pending === 'legal') {
      body.legal_name = legalName;
      if (taxIdentifier.trim()) body.tax_identifier = taxIdentifier.trim();
      body.version = organization?.version;
    }
    action.mutate(
      { action: pending, body },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: t('admin.done') });
          setPending(null);
        },
      },
    );
  };

  return (
    <>
      <Dialog open={Boolean(organizationId)} onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent>
          <DialogHeader title={organization?.name ?? ''} description={organization?.legal_name ?? undefined} />
          <Feedback error={detail.error ?? action.error ?? orders.error ?? statement.error} />
          {organization ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge tone={organization.status === 'ACTIVE' ? 'success' : organization.status === 'SUSPENDED' ? 'warning' : 'danger'}>
                  {t(`admin.orgs.statuses.${organization.status}`)}
                </Badge>
                <Badge tone="neutral">{t(`orgTypes.${organization.type}`, organization.type)}</Badge>
                {organization.subscription ? (
                  <Badge tone="info">
                    {organization.subscription.plan_code} ·{' '}
                    {t(`subscription.statuses.${organization.subscription.status}`, organization.subscription.status)}
                  </Badge>
                ) : null}
              </div>
              <dl className="grid gap-1">
                {(
                  [
                    ['tax_identifier', organization.tax_identifier],
                    ['phone', organization.phone],
                    ['city', organization.city],
                    ['address', organization.address],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t(`admin.orgs.${key}`)}</dt>
                    <dd>{value ?? '—'}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t('admin.orgs.partnerships')}</dt>
                  <dd className="tabular-nums">{organization.partnerships}</dd>
                </div>
              </dl>
              <ul className="space-y-1">
                {organization.members.map((member) => (
                  <li key={member.user_id} className="flex justify-between gap-3">
                    <span>
                      {member.full_name} · {t(`roles.${member.role}`, member.role)}
                    </span>
                    <span className="text-muted-foreground">{member.status}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {ORG_ACTIONS.filter((value) => value !== organization.status.toLowerCase()).map((value) => (
                  <Button key={value} variant="outline" onClick={() => setPending(value)}>
                    <Store />
                    {t(`admin.orgs.actions.${value}`)}
                  </Button>
                ))}
                <Button variant="outline" onClick={() => setPending('transfer-ownership')}>
                  <UserCog />
                  {t('admin.orgs.actions.transfer')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setLegalName(organization.legal_name ?? '');
                    setTaxIdentifier(organization.tax_identifier ?? '');
                    setPending('legal');
                  }}
                >
                  {t('admin.orgs.actions.legal')}
                </Button>
              </div>
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="font-medium">{t('admin.orgs.supportRead')}</p>
                <p className="text-muted-foreground">{t('admin.orgs.supportReadHint')}</p>
                <Input value={ordersReason} placeholder={t('admin.reasonHint')} onChange={(event) => setOrdersReason(event.target.value)} />
                <Button size="sm" variant="outline" disabled={ordersReason.trim().length < MIN_REASON} onClick={() => setOrdersOpen(true)}>
                  {t('admin.orgs.showOrders')}
                </Button>
                {ordersOpen && orders.data ? (
                  <ul className="space-y-1">
                    {orders.data.results.map((order) => (
                      <li key={order.id} className="flex justify-between gap-3">
                        <span>{order.order_number}</span>
                        <span className="text-muted-foreground">
                          {order.status} · {order.total ?? '—'} TJS
                        </span>
                      </li>
                    ))}
                    {orders.data.results.length === 0 ? <li className="text-muted-foreground">—</li> : null}
                  </ul>
                ) : null}
                <label className="grid gap-2">
                  {t('admin.orgs.partnershipId')}
                  <Input
                    value={partnershipId}
                    onChange={(event) => {
                      setPartnershipId(event.target.value);
                      statement.reset();
                    }}
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    ordersReason.trim().length < MIN_REASON ||
                    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(partnershipId) ||
                    statement.isPending
                  }
                  onClick={() => statement.mutate({ partnershipId, reason: ordersReason.trim() })}
                >
                  {t('admin.orgs.showStatement')}
                </Button>
                {statement.data ? (
                  <div className="space-y-2">
                    <p>
                      {t('admin.orgs.closingBalance')}: {statement.data.closing_balance} TJS
                    </p>
                    <ul className="space-y-1">
                      {statement.data.entries.map((entry) => (
                        <li key={entry.id} className="flex flex-wrap justify-between gap-3">
                          <span>{entry.description}</span>
                          <span>
                            {entry.direction} · {entry.amount} {entry.currency}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <Skeleton className="h-32" />
          )}
        </DialogContent>
      </Dialog>
      <ReasonDialog
        key={pending ?? 'closed'}
        open={pending !== null}
        title={pending ? t(`admin.orgs.actions.${pending === 'transfer-ownership' ? 'transfer' : pending}`) : ''}
        description={t('admin.reasonRequired')}
        pending={
          action.isPending || (pending === 'transfer-ownership' && !successor) || (pending === 'legal' && legalName.trim().length < 2)
        }
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      >
        {pending === 'transfer-ownership' ? (
          <div className="space-y-3">
            <label className="grid gap-2 text-sm">
              {t('admin.orgs.newOwner')}
              <Select value={successor} onChange={(event) => setSuccessor(event.target.value)}>
                <option value="">—</option>
                {(organization?.members ?? [])
                  .filter((member) => member.status === 'ACTIVE' && member.role !== 'OWNER')
                  .map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.full_name} · {t(`roles.${member.role}`, member.role)}
                    </option>
                  ))}
              </Select>
            </label>
            <label className="grid gap-2 text-sm">
              {t('admin.orgs.previousOwner')}
              <Select value={previousOwnerRole} onChange={(event) => setPreviousOwnerRole(event.target.value)}>
                <option value="MANAGER">{t('admin.orgs.keepMembership')}</option>
                <option value="REVOKED">{t('admin.orgs.revokeMembership')}</option>
              </Select>
            </label>
          </div>
        ) : null}
        {pending === 'legal' ? (
          <div className="space-y-3">
            <label className="grid gap-2 text-sm">
              {t('admin.orgs.legalName')}
              <Input value={legalName} onChange={(event) => setLegalName(event.target.value)} />
            </label>
            <label className="grid gap-2 text-sm">
              {t('admin.orgs.tax_identifier')}
              <Input value={taxIdentifier} onChange={(event) => setTaxIdentifier(event.target.value)} />
            </label>
          </div>
        ) : null}
      </ReasonDialog>
    </>
  );
}
