import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import { useState } from 'react';
import { createSubmissionKey } from '@/shared/api/idempotency';

/** P02 §1.1/1.2 organization verification status (on the organization). */
export type OrgVerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
/** P02 §1.4 status of one verification request. */
export type RequestStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
export type DocType = 'REGISTRATION_CERTIFICATE' | 'TAX_CERTIFICATE' | 'OTHER';

export type StoredFileOut = {
  id: string;
  display_name: string;
  size_bytes: number;
  content_type: string;
  category: string;
  created_at: string;
};
export type VerificationDocument = { id: string; doc_type: DocType; file: StoredFileOut };

export type VerificationRequestOut = {
  id: string;
  status: RequestStatus;
  submitted_at: string;
  review_started_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  documents: VerificationDocument[];
};

/** Contract of GET /api/v1/verification (backend verification/schemas.py VerificationState). */
export type VerificationState = {
  verification_status: OrgVerificationStatus;
  verified_at: string | null;
  required_documents: DocType[];
  can_submit: boolean;
  latest_request: VerificationRequestOut | null;
};

/** Contract of GET /api/v1/organization (backend organizations/schemas.py OrganizationProfile; org.view). */
export type OrganizationProfile = {
  id: string;
  type: 'COMPANY' | 'STORE';
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';
  legal_name: string;
  tax_identifier: string | null;
  /** Company only: the code stores use to request a partnership (P02 §1.1). */
  public_code: string | null;
  phone: string;
  email: string | null;
  city: string;
  address: string;
  /** Store only. */
  latitude: string | null;
  longitude: string | null;
  verification_status: OrgVerificationStatus;
  verified_at: string | null;
  legal_locked: boolean;
  version: number;
  /** CR-003: 5-minute signed URL of the company logo (COMPANY) or store image (STORE); null when there is none. */
  logo_url?: string | null;
};

export const verificationQueryKey = (orgId: string | null) => ['verification', orgId] as const;
export const organizationQueryKey = (orgId: string | null) => ['organization', orgId] as const;

export function useOrganizationProfile(orgId: string | null) {
  return useQuery({
    queryKey: organizationQueryKey(orgId),
    queryFn: () => apiRequest<OrganizationProfile>('/organization', { headers: { 'X-Org-Id': orgId! } }),
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });
}

export function useVerification(orgId: string | null) {
  return useQuery({
    queryKey: verificationQueryKey(orgId),
    queryFn: () => apiRequest<VerificationState>('/verification', { headers: { 'X-Org-Id': orgId! } }),
    enabled: Boolean(orgId),
  });
}

/** POST /api/v1/files (multipart, category VERIFICATION): OWNER only; PDF/JPEG/PNG up to 10 MB (VER-002). */
export function useUploadVerificationFile(orgId: string) {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('category', 'VERIFICATION');
      return apiRequest<StoredFileOut>('/files', { method: 'POST', body: form, headers: { 'X-Org-Id': orgId }, timeoutMs: 120_000 });
    },
  });
}

/** POST /api/v1/verification `{documents: [{doc_type, file_id}]}` (VER-001, VER-003). */
export function useSubmitVerification(orgId: string | null) {
  const [submission] = useState(createSubmissionKey);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documents: { doc_type: DocType; file_id: string }[]) =>
      apiRequest<VerificationState>('/verification', {
        method: 'POST',
        body: { documents },
        headers: { 'X-Org-Id': orgId! },
        idempotencyKey: submission.forPayload({ orgId, documents }),
      }),
    onSuccess: (state) => {
      submission.complete();
      queryClient.setQueryData(verificationQueryKey(orgId), state);
      void queryClient.invalidateQueries({ queryKey: organizationQueryKey(orgId) });
    },
  });
}

/** VER-002 client-side pre-check (the server checks again, including magic bytes). */
export const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
