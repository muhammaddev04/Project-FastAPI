import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import { useState } from 'react';
import { createSubmissionKey } from '@/shared/api/idempotency';
import { meQueryKey } from '@/shared/auth/api';
import type { Membership, OrgType } from '@/shared/auth/types';

/** Contract of POST /api/v1/organizations/{companies|stores} (backend organizations/schemas.py). */
export type OrganizationCreated = {
  organization: { id: string; type: OrgType; name: string; status: string };
  membership: Membership;
};

/**
 * P02 §1 profile fields (backend organizations/schemas.py): who the business is and how to reach and locate it.
 * `tax_identifier` (ИНН, 9-12 digits) is required for a Company and optional for a Store; coordinates are Store-only.
 */
export type OrganizationPayload = {
  name: string;
  legal_name: string;
  tax_identifier?: string;
  phone: string;
  email?: string;
  city: string;
  address: string;
  latitude?: string;
  longitude?: string;
};

export function useCreateOrganization() {
  const [submission] = useState(createSubmissionKey);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ type, payload }: { type: OrgType; payload: OrganizationPayload }) =>
      apiRequest<OrganizationCreated>(`/organizations/${type === 'COMPANY' ? 'companies' : 'stores'}`, {
        method: 'POST',
        body: payload,
        idempotencyKey: submission.forPayload({ type, payload }),
      }),
    onSuccess: () => {
      submission.complete();
      return queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}
