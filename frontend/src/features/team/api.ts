import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import { createSubmissionKey } from '@/shared/api/idempotency';
import { meQueryKey } from '@/shared/auth/api';
import type { Member, Membership, Page, Role } from '@/shared/auth/types';
import { useSessionStore } from '@/shared/auth/session-store';

export type Invitation = {
  id: string;
  organization_id: string;
  org_name: string;
  org_type: string;
  email: string;
  role: Role;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
  invited_by: string;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
};

const scope = (orgId: string) => ({ headers: { 'X-Org-Id': orgId } });

export function useInvitations(orgId: string | null, offset = 0) {
  return useQuery({
    queryKey: ['team-invitations', orgId, offset],
    queryFn: () => apiRequest<Page<Invitation>>(`/members/invitations?limit=20&offset=${offset}`, scope(orgId!)),
    enabled: Boolean(orgId),
  });
}

export function useMyInvitations(offset = 0) {
  const token = useSessionStore((state) => state.accessToken);
  return useQuery({
    queryKey: ['my-invitations', offset],
    queryFn: () => apiRequest<Page<Invitation>>(`/me/invitations?limit=20&offset=${offset}`),
    enabled: Boolean(token),
  });
}

export function useCreateInvitation(orgId: string) {
  const client = useQueryClient();
  const key = useMemo(createSubmissionKey, []);
  return useMutation({
    mutationFn: (payload: { email: string; role: Role }) =>
      apiRequest<Invitation>('/members/invitations', {
        ...scope(orgId),
        method: 'POST',
        body: payload,
        idempotencyKey: key.forPayload({ orgId, ...payload }),
      }),
    onSuccess: async () => {
      key.complete();
      await client.invalidateQueries({ queryKey: ['team-invitations', orgId] });
    },
  });
}

export type TeamAction = {
  id: string;
  action: 'role' | 'suspend' | 'reactivate' | 'revoke' | 'revoke-invitation';
  role?: Role;
  version?: number;
  reason?: string;
};

export function useTeamAction(orgId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, role, version, reason }: TeamAction) => {
      const path =
        action === 'revoke-invitation' ? `/members/invitations/${id}/revoke` : `/members/${id}${action === 'role' ? '' : `/${action}`}`;
      return apiRequest<Member | Invitation>(path, {
        ...scope(orgId),
        method: action === 'role' ? 'PATCH' : 'POST',
        body: action === 'role' ? { role, version } : reason === undefined ? undefined : { reason },
      });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['members', orgId] }),
        client.invalidateQueries({ queryKey: ['team-invitations', orgId] }),
        client.invalidateQueries({ queryKey: meQueryKey }),
      ]);
    },
  });
}

export function useRespondInvitation() {
  const client = useQueryClient();
  const key = useMemo(createSubmissionKey, []);
  return useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      apiRequest<Membership | Invitation>(`/me/invitations/${id}/${accept ? 'accept' : 'decline'}`, {
        method: 'POST',
        idempotencyKey: accept ? key.forPayload({ id }) : undefined,
      }),
    onSuccess: async () => {
      key.complete();
      await Promise.all([client.invalidateQueries({ queryKey: ['my-invitations'] }), client.invalidateQueries({ queryKey: meQueryKey })]);
    },
  });
}

export function useLeaveOrganization() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) => apiRequest<void>('/members/leave', { ...scope(orgId), method: 'POST' }),
    onSuccess: async (_, orgId) => {
      if (useSessionStore.getState().activeOrgId === orgId) useSessionStore.getState().setActiveOrg(null);
      await client.invalidateQueries({ queryKey: meQueryKey });
      client.removeQueries({ queryKey: ['members', orgId] });
    },
  });
}
