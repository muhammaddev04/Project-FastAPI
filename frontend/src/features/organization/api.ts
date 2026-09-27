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

/**
 * CR-003 `PUT|DELETE /organization/logo`: the company logo or store image of the *active* organization (X-Org-Id),
 * `org.edit_branding` (OWNER). One endpoint for both organization types; the server enforces the permission.
 */
function useImageCacheUpdate(orgId: string | null) {
  const queryClient = useQueryClient();
  return (profile: OrganizationProfile) => {
    queryClient.setQueryData(organizationQueryKey(orgId), profile);
    // The picture also appears in /me memberships (switcher, profile list) as `logo_url`.
    void queryClient.invalidateQueries({ queryKey: meQueryKey });
  };
}

export function useUploadOrganizationImage(orgId: string | null) {
  const onSuccess = useImageCacheUpdate(orgId);
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiRequest<OrganizationProfile>('/organization/logo', { method: 'PUT', body: form, orgScoped: true, timeoutMs: 120_000 });
    },
    onSuccess,
  });
}

export function useRemoveOrganizationImage(orgId: string | null) {
  const onSuccess = useImageCacheUpdate(orgId);
  return useMutation({
    mutationFn: () => apiRequest<OrganizationProfile>('/organization/logo', { method: 'DELETE', orgScoped: true }),
    onSuccess,
  });
}
