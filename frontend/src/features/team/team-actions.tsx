import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/shared/api/errors';
import type { Member, Membership, Role } from '@/shared/auth/types';
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
  Select,
  Textarea,
  toast,
} from '@/shared/ui';
import { useCreateInvitation, useTeamAction } from './api';

const assignableRoles = (type: string): Role[] => (type === 'STORE' ? ['SELLER'] : ['MANAGER', 'OPERATOR', 'WAREHOUSE', 'COURIER']);

export function InviteDialog({ membership, open, onClose }: { membership: Membership; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const invite = useCreateInvitation(membership.organization_id);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(assignableRoles(membership.org_type)[0]!);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !invite.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader title={t('team.invite')} description={t('teamActions.inviteHint')} />
        <form
          className="mt-4 space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await invite.mutateAsync({ email: email.trim().toLowerCase(), role });
              toast({ tone: 'success', title: t('teamActions.invited') });
              onClose();
            } catch {
              /* The mutation error is rendered below. */
            }
          }}
        >
          <FormField label={t('auth.fields.email')}>
            <Input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
          </FormField>
          <FormField label={t('team.columns.role')}>
            <Select value={role} onChange={(event) => setRole(event.target.value as Role)}>
              {assignableRoles(membership.org_type).map((value) => (
                <option key={value} value={value}>
                  {t(`roles.${value}`)}
                </option>
              ))}
            </Select>
          </FormField>
          {invite.isError ? <Alert tone="danger">{errorMessage(invite.error, t)}</Alert> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={invite.isPending} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={invite.isPending}>
              {t('teamActions.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MemberActions({
  member,
  membership,
  userId,
  subscriptionAllowed = true,
}: {
  member: Member;
  membership: Membership;
  userId: string;
  subscriptionAllowed?: boolean;
}) {
  const { t } = useTranslation();
  const mutation = useTeamAction(membership.organization_id);
  const [action, setAction] = useState<'role' | 'suspend' | 'reactivate' | 'revoke' | null>(null);
  const [role, setRole] = useState<Role>(member.role);
  const [reason, setReason] = useState('');
  if (membership.role !== 'OWNER' || member.role === 'OWNER' || member.user_id === userId || member.status === 'REVOKED') return null;
  const needsReason = action === 'suspend' || action === 'revoke';
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={member.status === 'SUSPENDED' && !subscriptionAllowed}
          onClick={() => {
            mutation.reset();
            setRole(member.role);
            setAction('role');
          }}
        >
          {t('teamActions.role')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            mutation.reset();
            setReason('');
            setAction(member.status === 'SUSPENDED' ? 'reactivate' : 'suspend');
          }}
        >
          {t(`teamActions.${member.status === 'SUSPENDED' ? 'reactivate' : 'suspend'}`)}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            mutation.reset();
            setReason('');
            setAction('revoke');
          }}
        >
          {t('teamActions.revoke')}
        </Button>
      </div>
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={t(`teamActions.${action ?? 'role'}`)}
        description={member.full_name}
        confirmLabel={t('common.confirm')}
        loading={mutation.isPending}
        tone={action === 'revoke' ? 'danger' : 'primary'}
        confirmDisabled={(needsReason && !reason.trim()) || (action === 'reactivate' && !subscriptionAllowed)}
        onConfirm={async () => {
          if (!action) return;
          try {
            await mutation.mutateAsync({
              id: member.id,
              action,
              role: action === 'role' ? role : undefined,
              version: member.version ?? 1,
              reason: needsReason ? reason.trim() : undefined,
            });
            setAction(null);
            toast({ tone: 'success', title: t('teamActions.updated') });
          } catch {
            /* Keep the dialog and display the server error. */
          }
        }}
      >
        {action === 'role' ? (
          <FormField label={t('team.columns.role')}>
            <Select value={role} onChange={(event) => setRole(event.target.value as Role)}>
              {assignableRoles(membership.org_type).map((value) => (
                <option key={value} value={value}>
                  {t(`roles.${value}`)}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        {needsReason ? (
          <FormField label={t('teamActions.reason')}>
            <Textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} />
          </FormField>
        ) : null}
        {mutation.isError ? <Alert tone="danger">{errorMessage(mutation.error, t)}</Alert> : null}
      </ConfirmDialog>
    </>
  );
}
