import { useMutation, useQueryClient } from '@tanstack/react-query';
import { organizationQueryKey, type OrganizationProfile } from '@/features/verification/api';
import { apiRequest } from '@/shared/api/client';
import { meQueryKey } from '@/shared/auth/api';

/** PATCH /api/v1/organization body: only changed fields plus the `version` read (optimistic concurrency). */
export type OrganizationChanges = Partial<
  Pick<OrganizationProfile, 'name' | 'legal_name' | 'tax_identifier' | 'phone' | 'email' | 'city' | 'address' | 'latitude' | 'longitude'>
> & { version: number };

/** ORG-005/006: the server decides what this role may change (org.edit_contacts / org.edit_legal until APPROVED). */
export function useUpdateOrganization(orgId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: OrganizationChanges) =>
      apiRequest<OrganizationProfile>('/organization', { method: 'PATCH', body: changes, orgScoped: true }),
    onSuccess: (profile) => {
      queryClient.setQueryData(organizationQueryKey(orgId), profile);
      // The organization name also appears in /me memberships (switcher, headers).
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}