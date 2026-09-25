import { ChevronLeft, ChevronRight, Search, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAreaContext } from '@/app/shell/use-area-context';
import { errorMessage } from '@/shared/api/errors';
import { useMembers } from '@/shared/auth/api';
import { RequirePermission } from '@/shared/auth/guards';
import type { MembershipStatus, Role } from '@/shared/auth/types';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, SkeletonRows } from '@/shared/ui';

const PAGE_SIZE = 20;
const ROLES: Record<'COMPANY' | 'STORE', Role[]> = {
  COMPANY: ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'COURIER'],
  STORE: ['OWNER', 'SELLER'],
};
const STATUS_TONE: Record<MembershipStatus, 'success' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  REVOKED: 'neutral',
};

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function formatDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'medium', timeZone: 'Asia/Dushanbe' }).format(
    new Date(value),
  );
}

/** P01 §10 Team page: members of the active organization (members.view). Invitations and role changes come later. */
export function TeamPage() {
  const { t, i18n } = useTranslation();
  const { membership } = useAreaContext();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState<MembershipStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const debouncedSearch = useDebounced(search.trim());

  useEffect(() => setOffset(0), [debouncedSearch, role, status]);

  const members = useMembers(membership.organization_id, {
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
          eyebrow={membership.org_name}
          title={t('team.title')}
          description={t('team.description')}
          actions={
            membership.permissions.includes('members.invite') ? (
              <Button variant="secondary" disabled title={t('team.inviteLater')}>
                <UserPlus /> {t('team.invite')}
              </Button>
            ) : undefined
          }
        />

        <Card>
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
            <Input
              className="sm:max-w-xs"
              leading={<Search />}
              placeholder={t('team.searchPlaceholder')}
              aria-label={t('team.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select aria-label={t('team.roleFilter')} value={role} onChange={(event) => setRole(event.target.value as Role | '')} className="sm:w-44">
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
              className="sm:w-44"
            >
              <option value="">{t('team.allStatuses')}</option>
              {(['ACTIVE', 'SUSPENDED', 'REVOKED'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`team.statuses.${value}`)}
                </option>
              ))}
            </Select>
          </div>

          {members.isPending ? (
            <div className="p-5">
              <SkeletonRows rows={4} label={t('common.loading')} />
            </div>
          ) : members.isError ? (
            <ErrorState message={errorMessage(members.error, t)} onRetry={() => void members.refetch()} />
          ) : page && page.results.length === 0 ? (
            <EmptyState title={t('team.emptyTitle')} description={t('team.emptyText')} />
          ) : page ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-[0.8125rem]">
                  <thead className="border-b bg-subtle text-2xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-5 py-2.5 font-semibold">{t('team.columns.member')}</th>
                      <th scope="col" className="px-5 py-2.5 font-semibold">{t('team.columns.role')}</th>
                      <th scope="col" className="px-5 py-2.5 font-semibold">{t('team.columns.status')}</th>
                      <th scope="col" className="px-5 py-2.5 font-semibold">{t('team.columns.joined')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {page.results.map((member) => (
                      <tr key={member.id} className="transition-colors hover:bg-subtle/60">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={member.full_name} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{member.full_name}</p>
                              <p className="text-muted-foreground">{member.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3">{t(`roles.${member.role}`)}</td>
                        <td className="px-5 py-3">
                          <Badge tone={STATUS_TONE[member.status]}>{t(`team.statuses.${member.status}`)}</Badge>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{formatDate(member.joined_at, i18n.language)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t px-5 py-3 text-[0.8125rem] text-muted-foreground">
                <span>
                  {t('team.range', {
                    from: page.count ? page.offset + 1 : 0,
                    to: page.offset + page.results.length,
                    total: page.count,
                  })}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    aria-label={t('team.previous')}
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={offset + PAGE_SIZE >= page.count}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    aria-label={t('team.next')}
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </Card>
      </div>
    </RequirePermission>
  );
}
