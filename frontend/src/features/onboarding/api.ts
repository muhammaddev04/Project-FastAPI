import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import { meQueryKey } from '@/shared/auth/api';
import type { Membership, OrgType } from '@/shared/auth/types';

/** Contract of POST /api/v1/organizations/{companies|stores} (backend organizations/schemas.py). */
export type OrganizationCreated = {
  organization: { id: string; type: OrgType; name: string; status: string };
  membership: Membership;
};

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ type, name }: { type: OrgType; name: string }) =>
      apiRequest<OrganizationCreated>(`/organizations/${type === 'COMPANY' ? 'companies' : 'stores'}`, {
        method: 'POST',
        body: { name },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
  });
}
