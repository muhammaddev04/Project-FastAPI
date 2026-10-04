import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/shared/api/errors';
import type { Membership } from '@/shared/auth/types';
import { Alert, Button, ConfirmDialog, toast } from '@/shared/ui';
import { useLeaveOrganization } from './api';

export function LeaveMembership({ membership }: { membership: Membership }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const leave = useLeaveOrganization();
  if (membership.role === 'OWNER' || membership.status !== 'ACTIVE') return null;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          leave.reset();
          setOpen(true);
        }}
      >
        {t('teamActions.leave')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title={t('teamActions.leave')}
        description={t('teamActions.leaveHint', { name: membership.org_name })}
        confirmLabel={t('common.confirm')}
        loading={leave.isPending}
        onConfirm={async () => {
          try {
            await leave.mutateAsync(membership.organization_id);
            setOpen(false);
            toast({ tone: 'success', title: t('teamActions.left') });
          } catch {
            /* The error remains visible. */
          }
        }}
      >
        {leave.isError ? <Alert tone="danger">{errorMessage(leave.error, t)}</Alert> : null}
      </ConfirmDialog>
    </>
  );
}
