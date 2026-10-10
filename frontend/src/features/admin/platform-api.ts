import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import type { components } from '@/shared/api/schema';

/** Contracts of the P12 §3.1 platform endpoints (SUPERADMIN only; no X-Org-Id, and every change has a reason). */
export type AdminDashboard = components['schemas']['AdminDashboardOut'];
export type AdminUser = components['schemas']['AdminUserOut'];
export type AdminUserDetail = components['schemas']['AdminUserDetail'];
export type AdminOrganization = components['schemas']['AdminOrganizationOut'];
export type AdminOrganizationDetail = components['schemas']['AdminOrganizationDetail'];
export type AdminOrder = components['schemas']['AdminOrderOut'];
export type AuditLog = components['schemas']['AuditLogOut'];
export type OutboxEvent = components['schemas']['OutboxEventOut'];
export type NotificationFailure = components['schemas']['NotificationFailureOut'];
export type ReconciliationIssue = components['schemas']['ReconciliationOut'];
export type Statement = components['schemas']['StatementOut'];
export type AdminExport = components['schemas']['ExportOut'];

export const PAGE_SIZE = 20;
export type PageOf<T> = { count: number; limit: number; offset: number; results: T[] };

function listQuery(filters: Record<string, string | undefined>, offset: number): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return params.toString();
}

function useList<T>(key: string, path: string, filters: Record<string, string | undefined>, offset: number) {
  const query = listQuery(filters, offset);
  return useQuery({
    queryKey: [key, query],
    queryFn: ({ signal }) => apiRequest<PageOf<T>>(`${path}?${query}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAdminDashboard() {
  return useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: ({ signal }) => apiRequest<AdminDashboard>('/admin/dashboard', { signal }),
    refetchInterval: 60_000,
  });
}

export function useAdminUsers(filters: { search?: string; status?: string }, offset = 0) {
  return useList<AdminUser>('admin-users', '/admin/users', filters, offset);
}

export function useAdminUser(userId: string | null) {
  return useQuery({
    queryKey: ['admin-user', userId],
    queryFn: ({ signal }) => apiRequest<AdminUserDetail>(`/admin/users/${userId}`, { signal }),
    enabled: Boolean(userId),
  });
}

/** IAM-009 block / unblock / logout-all: the reason travels with the command and lands in the audit log. */
export function useUserAction(userId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ action, reason }: { action: 'block' | 'unblock' | 'logout-all'; reason: string }) =>
      apiRequest<AdminUserDetail>(`/admin/users/${userId}/${action}`, { method: 'POST', body: { reason } }),
    onSuccess: (detail) => {
      cache.setQueryData(['admin-user', userId], detail);
      void cache.invalidateQueries({ queryKey: ['admin-users'] });
      void cache.invalidateQueries({ queryKey: ['admin-dashboard'] });
    },
  });
}

export function useAdminOrganizations(filters: { search?: string; type?: string; status?: string }, offset = 0) {
  return useList<AdminOrganization>('admin-organizations', '/admin/organizations', filters, offset);
}

export function useAdminOrganization(organizationId: string | null) {
  return useQuery({
    queryKey: ['admin-organization', organizationId],
    queryFn: ({ signal }) => apiRequest<AdminOrganizationDetail>(`/admin/organizations/${organizationId}`, { signal }),
    enabled: Boolean(organizationId),
  });
}

export function useOrganizationAction(organizationId: string) {
  const cache = useQueryClient();
  const refresh = (detail: AdminOrganizationDetail) => {
    cache.setQueryData(['admin-organization', organizationId], detail);
    void cache.invalidateQueries({ queryKey: ['admin-organizations'] });
    void cache.invalidateQueries({ queryKey: ['admin-dashboard'] });
  };
  return useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown> }) =>
      apiRequest<AdminOrganizationDetail>(`/admin/organizations/${organizationId}/${action}`, {
        method: action === 'legal' ? 'PATCH' : 'POST',
        body,
      }),
    onSuccess: refresh,
  });
}

/** ADM-010: reading a tenant's orders is audited, so the reason is part of the request. */
export function useOrganizationOrders(organizationId: string | null, reason: string, enabled: boolean) {
  return useQuery({
    queryKey: ['admin-organization-orders', organizationId, reason],
    queryFn: ({ signal }) =>
      apiRequest<PageOf<AdminOrder>>(
        `/admin/organizations/${organizationId}/orders?limit=${PAGE_SIZE}&reason=${encodeURIComponent(reason)}`,
        { signal },
      ),
    enabled: enabled && Boolean(organizationId) && reason.trim().length >= 10,
    gcTime: 0,
  });
}

export type AuditFilters = {
  org_id?: string;
  actor_id?: string;
  action?: string;
  entity_type?: string;
  entity_id?: string;
  date_from?: string;
  date_to?: string;
};

export function useSupportStatement() {
  return useMutation({
    mutationFn: ({ partnershipId, reason }: { partnershipId: string; reason: string }) =>
      apiRequest<Statement>(`/admin/partnerships/${encodeURIComponent(partnershipId)}/statement?reason=${encodeURIComponent(reason)}`),
    gcTime: 0,
  });
}

export function useAuditLogs(filters: AuditFilters, offset = 0) {
  return useList<AuditLog>('admin-audit', '/admin/audit-logs', filters, offset);
}

export function useAuditExport() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (filters: { format: 'CSV' | 'XLSX'; date_from?: string; date_to?: string }) => {
      const params = new URLSearchParams({ format: filters.format });
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      return apiRequest<AdminExport>(`/admin/audit-logs/export?${params}`, {
        method: 'POST',
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ['admin-audit'] }),
  });
}

export function useAdminExportDownload() {
  return useMutation({
    mutationFn: (exportId: string) => apiRequest<{ url: string; expires_at: string }>(`/admin/exports/${exportId}/download`),
    gcTime: 0,
  });
}

export function useOutbox(status: string | undefined, offset = 0) {
  return useList<OutboxEvent>('admin-outbox', '/admin/outbox', { status }, offset);
}

export function useRetryOutbox() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiRequest<OutboxEvent>(`/admin/outbox/${id}/retry`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['admin-outbox'] });
      void cache.invalidateQueries({ queryKey: ['admin-dashboard'] });
    },
  });
}

export function useNotificationFailures(offset = 0) {
  return useList<NotificationFailure>('admin-notification-failures', '/admin/notification-failures', {}, offset);
}

export function useReconciliationIssues(offset = 0) {
  return useList<ReconciliationIssue>('admin-reconciliation', '/admin/reconciliation-issues', {}, offset);
}

export function useResolveIssue() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      apiRequest<ReconciliationIssue>(`/admin/reconciliation-issues/${id}/resolve`, { method: 'POST', body: { note } }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['admin-reconciliation'] });
      void cache.invalidateQueries({ queryKey: ['admin-dashboard'] });
    },
  });
}
