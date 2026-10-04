import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import { createSubmissionKey } from '@/shared/api/idempotency';
import type { components } from '@/shared/api/schema';

export type Plan = components['schemas']['PlanOut'];
export type Subscription = components['schemas']['SubscriptionOut'];
export type SubscriptionDetail = components['schemas']['SubscriptionDetail'];
export type Payment = components['schemas']['PaymentOut'];
export type PlanRequest = components['schemas']['PlanRequestDetail'];
export type Page<T> = { results: T[]; count: number; limit: number; offset: number };
export const statuses = ['TRIAL', 'ACTIVE', 'GRACE', 'SOFT_BLOCK', 'FULL_BLOCK', 'CANCELLED'] as const;
export type Access = { status: string; allowed_actions: string[] };

export function useBillingQuery<T>(path: string, orgId?: string | null) {
  return useQuery({
    queryKey: ['billing', path, orgId],
    queryFn: ({ signal }) => apiRequest<T>(path, { signal, headers: orgId ? { 'X-Org-Id': orgId } : undefined }),
    enabled: orgId !== null,
    refetchInterval: 60_000,
  });
}

export function useBillingMutation<T>(path: string, orgId?: string, idempotent = false, method: 'POST' | 'PATCH' = 'POST') {
  const cache = useQueryClient();
  const [key] = useState(createSubmissionKey);
  return useMutation({
    mutationFn: (body: unknown) =>
      apiRequest<T>(path, {
        method,
        body,
        headers: orgId ? { 'X-Org-Id': orgId } : undefined,
        idempotencyKey: idempotent ? key.forPayload({ path, orgId, body }) : undefined,
      }),
    onSuccess: (result) => {
      key.complete();
      if (orgId && path === '/subscription/cancel-at-period-end') {
        cache.setQueryData(['billing', '/subscription', orgId], result);
      }
      void cache.invalidateQueries({ queryKey: ['billing'] });
    },
  });
}

/** UTC calendar arithmetic matches SUB-004, including month-end clamping. */
export function previewPaymentPeriod(subscription: Subscription, months: number, now = new Date()) {
  const current = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
  const start = subscription.status === 'ACTIVE' && current && current > now ? current : now;
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return { start, end };
}
