import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import type { OrgVerificationStatus, RequestStatus, VerificationDocument } from '@/features/verification/api';

/** Contracts of /api/v1/admin/verifications (SUPERADMIN only; no X-Org-Id). */
export type AdminRequestSummary = {
  id: string;
  organization_id: string;
  org_type: 'COMPANY' | 'STORE';
  org_name: string;
  status: RequestStatus;
  submitted_at: string;
  reviewer_id: string | null;
  reviewed_at: string | null;
};
export type AdminRequestPage = { count: number; limit: number; offset: number; results: AdminRequestSummary[] };
export type AdminRequestDetail = AdminRequestSummary & {
  submitted_by: string;
  review_started_at: string | null;
  rejection_reason: string | null;
  legal_snapshot: Record<string, string | null>;
  current_profile: Record<string, string | null>;
  org_verification_status: OrgVerificationStatus;
  documents: VerificationDocument[];
  history: { id: string; status: RequestStatus; submitted_at: string; reviewed_at: string | null; rejection_reason: string | null }[];
  version: number;
};
export type QueueFilter = { status?: RequestStatus | ''; org_type?: 'COMPANY' | 'STORE' | '' };
/** P02 §6: the queue's only ordering (API-003 whitelist); `submitted_at` (oldest first) is the server default. */
export type QueueOrdering = 'submitted_at' | '-submitted_at';
/** API-002 page: `limit` 1..100, `offset` >= 0. */
export type QueuePage = { ordering: QueueOrdering; offset: number };
export const QUEUE_PAGE_SIZE = 20;

const BASE = '/admin/verifications';

export function useVerificationQueue(filter: QueueFilter, page: QueuePage) {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.org_type) params.set('org_type', filter.org_type);
  params.set('ordering', page.ordering);
  params.set('limit', String(QUEUE_PAGE_SIZE));
  params.set('offset', String(page.offset));
  const query = params.toString();
  return useQuery({
    queryKey: ['admin-verifications', query],
    queryFn: () => apiRequest<AdminRequestPage>(`${BASE}?${query}`),
    placeholderData: keepPreviousData,
  });
}

export function useVerificationRequest(id: string | null) {
  return useQuery({
    queryKey: ['admin-verification', id],
    queryFn: () => apiRequest<AdminRequestDetail>(`${BASE}/${id}`),
    enabled: Boolean(id),
  });
}

/** start-review / approve / reject: the answer is the updated request; the queue is refreshed. */
export function useReviewAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, reason }: { action: 'start-review' | 'approve' | 'reject'; reason?: string }) =>
      apiRequest<AdminRequestDetail>(`${BASE}/${id}/${action}`, {
        method: 'POST',
        body: action === 'reject' ? { reason } : undefined,
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(['admin-verification', id], detail);
      void queryClient.invalidateQueries({ queryKey: ['admin-verifications'] });
    },
  });
}

/** VER-004: a 5-minute signed URL; the server audits every call. */
export function fetchDocumentUrl(requestId: string, documentId: string) {
  return apiRequest<{ url: string; expires_at: string }>(`${BASE}/${requestId}/documents/${documentId}/url`);
}
