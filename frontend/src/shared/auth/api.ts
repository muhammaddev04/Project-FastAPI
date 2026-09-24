import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import type { Language, Me, Member, Page, Role } from './types';
import { useSessionStore } from './session-store';

export const meQueryKey = ['me'] as const;

export function useMe() {
  const accessToken = useSessionStore((state) => state.accessToken);
  return useQuery({
    queryKey: meQueryKey,
    queryFn: () => apiRequest<Me>('/me'),
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  });
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { full_name?: string; language?: Language }) =>
      apiRequest<Me>('/me', { method: 'PATCH', body: payload }),
    onSuccess: (me) => queryClient.setQueryData(meQueryKey, me),
  });
}

export type MembersFilter = { role?: Role; status?: string; search?: string; limit?: number; offset?: number };

export function useMembers(orgId: string | null, filter: MembersFilter = {}) {
  const params = new URLSearchParams();
  Object.entries(filter).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const query = params.toString();
  return useQuery({
    queryKey: ['members', orgId, query],
    queryFn: () => apiRequest<Page<Member>>(`/members${query ? `?${query}` : ''}`, { orgScoped: true }),
    enabled: Boolean(orgId),
    placeholderData: keepPreviousData,
  });
}
