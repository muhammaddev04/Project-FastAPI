import { Mail } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { StandaloneLayout } from '@/app/shell/standalone-layout';
import { errorMessage } from '@/shared/api/errors';
import { AccountMenu } from '@/shared/auth/account-menu';
import { areaFor, areaHome } from '@/shared/auth/context';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Me, Membership } from '@/shared/auth/types';
import { Alert, Badge, Button, Card, ConfirmDialog, DataTable, DateText, PageHeader, toast } from '@/shared/ui';
import { type Invitation, useInvitations, useMyInvitations, useRespondInvitation, useTeamAction } from './api';

export function InvitationsBadge() {
  const { t } = useTranslation();
  const invitations = useMyInvitations();
  return (
    <Link
      to="/invitations"
      className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-full border bg-surface/50 focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t('teamActions.inbox')}
    >
      <Mail className="size-5" aria-hidden="true" />
      {invitations.data && invitations.data.count > 0 ? (
        <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-micro text-primary-foreground">
          {invitations.data.count}
        </span>
      ) : null}
    </Link>
  );
}

export function InvitationsInbox({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const invitations = useMyInvitations(offset);
  const respond = useRespondInvitation();
  const [selected, setSelected] = useState<{ invitation: Invitation; accept: boolean } | null>(null);
  if (compact && !invitations.data?.count && !invitations.isError) return null;
  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <h2 className="font-display text-lg font-semibold">{t('teamActions.inbox')}</h2>
      <DataTable<Invitation>
        caption={t('teamActions.inbox')}
        rows={invitations.data?.results}
        loading={invitations.isLoading}
        rowKey={(invitation) => invitation.id}
        error={invitations.isError ? errorMessage(invitations.error, t) : undefined}
        onRetry={() => void invitations.refetch()}
        empty={{ title: t('teamActions.inboxEmpty') }}
        pagination={invitations.data ? { offset, limit: 20, count: invitations.data.count, onChange: setOffset } : undefined}
        columns={[
          {
            key: 'org',
            header: t('teamActions.organization'),
            primary: true,
            cell: (invitation) => <span className="font-semibold">{invitation.org_name}</span>,
          },
          { key: 'role', header: t('team.columns.role'), cell: (invitation) => t(`roles.${invitation.role}`) },
          { key: 'expires', header: t('teamActions.expires'), cell: (invitation) => <DateText value={invitation.expires_at} dateOnly /> },
          {
            key: 'actions',
            header: t('teamActions.actions'),
            cell: (invitation) => (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    respond.reset();
                    setSelected({ invitation, accept: true });
                  }}
                >
                  {t('teamActions.accept')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    respond.reset();
                    setSelected({ invitation, accept: false });
                  }}
                >
                  {t('teamActions.decline')}
                </Button>
              </div>
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={t(selected?.accept ? 'teamActions.accept' : 'teamActions.decline')}
        description={selected?.invitation.org_name}
        confirmLabel={t('common.confirm')}
        loading={respond.isPending}
        onConfirm={async () => {
          if (!selected) return;
          try {
            const result = await respond.mutateAsync({ id: selected.invitation.id, accept: selected.accept });
            if (selected.accept) {
              const membership = result as Membership;
              useSessionStore.getState().setActiveOrg(membership.organization_id);
              navigate(areaHome(areaFor(membership)));
            }
            toast({ tone: 'success', title: t(selected.accept ? 'teamActions.accepted' : 'teamActions.declined') });
            setSelected(null);
          } catch {
            /* Server error remains visible in the confirmation. */
          }
        }}
      >
        {respond.isError ? <Alert tone="danger">{errorMessage(respond.error, t)}</Alert> : null}
      </ConfirmDialog>
    </Card>
  );
}

export function InvitationsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  return (
    <StandaloneLayout actions={<AccountMenu me={me} compact />}>
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <PageHeader title={t('teamActions.inbox')} />
        <InvitationsInbox />
      </div>
    </StandaloneLayout>
  );
}

export function TeamInvitations({ membership }: { membership: Membership }) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Invitation | null>(null);
  const invitations = useInvitations(membership.organization_id, offset);
  const revoke = useTeamAction(membership.organization_id);
  return (
    <Card className="p-4 sm:p-6">
      <DataTable<Invitation>
        caption={t('teamActions.sentInvitations')}
        rowKey={(invitation) => invitation.id}
        rows={invitations.data?.results}
        loading={invitations.isPending}
        error={invitations.isError ? errorMessage(invitations.error, t) : undefined}
        onRetry={() => void invitations.refetch()}
        empty={{ title: t('teamActions.sentEmpty') }}
        pagination={invitations.data ? { offset, limit: 20, count: invitations.data.count, onChange: setOffset } : undefined}
        columns={[
          { key: 'email', header: t('auth.fields.email'), primary: true, cell: (invitation) => invitation.email },
          { key: 'role', header: t('team.columns.role'), cell: (invitation) => t(`roles.${invitation.role}`) },
          {
            key: 'status',
            header: t('team.columns.status'),
            cell: (invitation) => <Badge>{t(`teamActions.statuses.${invitation.status}`)}</Badge>,
          },
          { key: 'expires', header: t('teamActions.expires'), cell: (invitation) => <DateText value={invitation.expires_at} dateOnly /> },
          {
            key: 'actions',
            header: t('teamActions.actions'),
            cell: (invitation) =>
              membership.permissions.includes('members.invite') &&
              invitation.status === 'PENDING' &&
              Date.parse(invitation.expires_at) > Date.now() ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    revoke.reset();
                    setSelected(invitation);
                  }}
                >
                  {t('teamActions.revokeInvitation')}
                </Button>
              ) : null,
          },
        ]}
      />
      <ConfirmDialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        tone="danger"
        title={t('teamActions.revokeInvitation')}
        description={selected?.email}
        confirmLabel={t('common.confirm')}
        loading={revoke.isPending}
        onConfirm={async () => {
          if (!selected) return;
          try {
            await revoke.mutateAsync({ id: selected.id, action: 'revoke-invitation' });
            setSelected(null);
            toast({ tone: 'success', title: t('teamActions.updated') });
          } catch {
            /* Display the error below. */
          }
        }}
      >
        {revoke.isError ? <Alert tone="danger">{errorMessage(revoke.error, t)}</Alert> : null}
      </ConfirmDialog>
    </Card>
  );
}
