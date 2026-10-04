import { Search, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { errorMessage } from '@/shared/api/errors';
import { useMembers } from '@/shared/auth/api';
import { RequirePermission } from '@/shared/auth/guards';
import type { Member, MembershipStatus, Role } from '@/shared/auth/types';
import { Avatar, Badge, Button, DataTable, DateText, Input, PageHeader, Select, StatusBadge } from '@/shared/ui';
import { InviteDialog, MemberActions } from './team-actions';
import { TeamInvitations } from './invitations';
import { useBillingQuery, type Access } from '@/features/subscriptions/api';

const PAGE_SIZE = 20;
const ROLES: Record<'COMPANY' | 'STORE', Role[]> = {
  COMPANY: ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'COURIER'],
  STORE: ['OWNER', 'SELLER'],
};
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** P01 team management and invitation history, scoped to the active organization. */
export function TeamPage() {
  const { t } = useTranslation();
  const { membership, me } = useAreaContext();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState<MembershipStatus | ''>('');
  const debouncedSearch = useDebounced(search.trim());
  // The offset belongs to one combination of filters: when they change it reads as 0 in the same render, so no request
  // is ever sent with the previous filters' page (which could be past the end of the new result).
  const filterKey = JSON.stringify([debouncedSearch, role, status]);
  const [paging, setPaging] = useState({ filterKey, offset: 0 });
  if (paging.filterKey !== filterKey) setPaging({ filterKey, offset: 0 }); // adjusted during render, before any effect
  const offset = paging.filterKey === filterKey ? paging.offset : 0;
  const setOffset = (next: number) => setPaging({ filterKey, offset: next });

  // Without members.view the page shows "no access" and must not ask the API (which would answer 403).
  const canView = membership.permissions.includes('members.view');
  const access = useBillingQuery<Access>('/subscription/access', membership.org_type === 'COMPANY' ? membership.organization_id : null);
  const members = useMembers(canView ? membership.organization_id : null, {
    search: debouncedSearch || undefined,
    role: role || undefined,
    status: status || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const page = members.data;

  return (
    <RequirePermission membership={membership} code="members.view">
      <div className="space-y-6">
        <PageHeader
          title={t('team.title')}
          description={t('team.description')}
          actions={
            membership.permissions.includes('members.invite') ? (
              <Button
                variant="secondary"
                disabled={membership.org_type === 'COMPANY' && (!access.data || !access.data.allowed_actions.includes('MEMBER_INVITE'))}
                onClick={() => setInviteOpen(true)}
              >
                <UserPlus /> {t('team.invite')}
              </Button>
            ) : undefined
          }
        />

        <DataTable<Member>
          caption={t('team.title')}
          rowKey={(member) => member.id}
          rows={page?.results}
          loading={members.isPending}
          error={members.isError ? errorMessage(members.error, t) : undefined}
          onRetry={() => void members.refetch()}
          empty={{ title: t('team.emptyTitle'), description: t('team.emptyText') }}
          pagination={page ? { offset, limit: PAGE_SIZE, count: page.count, onChange: setOffset } : undefined}
          busy={members.isFetching && !members.isPending}
          filters={{
            changed: search !== '' || role !== '' || status !== '',
            onReset: () => {
              setSearch('');
              setRole('');
              setStatus('');
            },
          }}
          toolbar={
            <>
              <Input
                className="sm:min-w-0 sm:max-w-xs sm:flex-1"
                leading={<Search />}
                placeholder={t('team.searchPlaceholder')}
                aria-label={t('team.search')}
                maxLength={100}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Select
                aria-label={t('team.roleFilter')}
                value={role}
                onChange={(event) => setRole(event.target.value as Role | '')}
                className="sm:w-40"
              >
                <option value="">{t('team.allRoles')}</option>
                {ROLES[membership.org_type].map((value) => (
                  <option key={value} value={value}>
                    {t(`roles.${value}`)}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('team.statusFilter')}
                value={status}
                onChange={(event) => setStatus(event.target.value as MembershipStatus | '')}
                className="sm:w-40"
              >
                <option value="">{t('team.allStatuses')}</option>
                {(['ACTIVE', 'SUSPENDED', 'REVOKED'] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`team.statuses.${value}`)}
                  </option>
                ))}
              </Select>
            </>
          }
          columns={[
            {
              key: 'member',
              header: t('team.columns.member'),
              primary: true,
              cell: (member) => (
                <div className="flex items-center gap-3">
                  <Avatar name={member.full_name} size="md" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{member.full_name}</p>
                    <p className="truncate text-muted-foreground">{member.email}</p>
                  </div>
                </div>
              ),
            },
            { key: 'role', header: t('team.columns.role'), cell: (member) => <Badge tone="accent">{t(`roles.${member.role}`)}</Badge> },
            { key: 'status', header: t('team.columns.status'), cell: (member) => <StatusBadge kind="member" value={member.status} /> },
            {
              key: 'joined',
              header: t('team.columns.joined'),
              cell: (member) => <DateText value={member.joined_at} dateOnly className="text-muted-foreground" />,
            },
            {
              key: 'actions',
              header: t('teamActions.actions'),
              cell: (member) => (
                <MemberActions
                  member={member}
                  membership={membership}
                  userId={me.id}
                  subscriptionAllowed={membership.org_type !== 'COMPANY' || !!access.data?.allowed_actions.includes('MEMBER_INVITE')}
                />
              ),
            },
          ]}
        />
        <TeamInvitations key={membership.organization_id} membership={membership} />
        {inviteOpen ? (
          <InviteDialog key={membership.organization_id} membership={membership} open onClose={() => setInviteOpen(false)} />
        ) : null}
      </div>
    </RequirePermission>
  );
}
