import { useState } from 'react';
import { useAreaContext } from '@/app/shell/use-area-context';
import { useBillingQuery, type Access } from '@/features/subscriptions/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import { createSubmissionKey } from '@/shared/api/idempotency';
import type { components } from '@/shared/api/schema';

export type Product = components['schemas']['ProductOut'];
export type Category = components['schemas']['CategoryOut'];
export type Unit = components['schemas']['UnitOut'];
export type PriceList = components['schemas']['PriceListOut'];
export type MatrixRow = components['schemas']['MatrixOut'];
export type Price = components['schemas']['PriceOut'];
export type ImportJob = components['schemas']['ImportOut'];
export type ImportRow = components['schemas']['ImportRowOut'];
export type ImportError = components['schemas']['ImportErrorOut'];
export type Page<T> = { count: number; limit: number; offset: number; results: T[] };

export function useCatalogAccess(permission = 'catalog.manage') {
  const { membership } = useAreaContext();
  const orgId = membership.organization_id;
  const query = useBillingQuery<Access>('/subscription/access', orgId);
  return {
    membership,
    orgId,
    writable:
      membership.permissions.includes(permission) &&
      membership.org_status === 'ACTIVE' &&
      !!query.data?.allowed_actions.includes('CATALOG_WRITE'),
  };
}

export function useCatalogQuery<T>(path: string, orgId: string, enabled = true, poll?: number, revision?: string) {
  return useQuery({
    queryKey: ['catalog', orgId, path, revision],
    queryFn: ({ signal }) => apiRequest<T>(path, { headers: { 'X-Org-Id': orgId }, signal }),
    enabled,
    refetchInterval: poll,
  });
}

export function useCatalogMutation<T>(
  path: string,
  orgId: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST',
  idempotent = false,
) {
  const cache = useQueryClient();
  const [key] = useState(createSubmissionKey);
  return useMutation({
    mutationKey: ['catalog', orgId],
    mutationFn: (body?: unknown) =>
      apiRequest<T>(path, {
        method,
        body,
        headers: { 'X-Org-Id': orgId },
        idempotencyKey: idempotent ? key.forPayload({ path, orgId, body }) : undefined,
      }),
    onSuccess: () => {
      key.complete();
      void cache.invalidateQueries({ queryKey: ['catalog', orgId] });
      void cache.invalidateQueries({ queryKey: ['billing'] });
    },
  });
}

export async function downloadTemplate(kind: string, orgId: string) {
  const blob = await apiRequest<Blob>(`/imports/templates/${kind}`, { headers: { 'X-Org-Id': orgId }, responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${kind.toLowerCase()}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function priceDifference(before: string | null | undefined, after: string) {
  const oldPrice = Number(before);
  return oldPrice > 0 ? (((Number(after) - oldPrice) / oldPrice) * 100).toFixed(1) : null;
}
