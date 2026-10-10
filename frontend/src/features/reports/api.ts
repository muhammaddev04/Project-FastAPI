import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAreaContext } from '@/app/shell/use-area-context';
import { apiRequest } from '@/shared/api/client';
import { createSubmissionKey } from '@/shared/api/idempotency';
import type { components } from '@/shared/api/schema';

export type ReportInfo = components['schemas']['ReportInfoOut'];
export type Report = components['schemas']['ReportOut'];
export type ReportColumn = components['schemas']['ColumnOut'];
export type ColumnKind = ReportColumn['kind'];
export type Export = components['schemas']['ExportOut'];
export type ExportFormat = Export['format'];
export type ExportStatus = Export['status'];
export type Download = components['schemas']['DownloadOut'];
export type CompanyDashboard = components['schemas']['CompanyDashboardOut'];
export type StoreDashboard = components['schemas']['StoreDashboardOut'];
export type Dashboard = CompanyDashboard | StoreDashboard;
export type ExportPage = components['schemas']['Page_ExportOut_'];
export type ReportRow = Record<string, unknown>;

/** A report period is a pair of local Dushanbe dates (RPT-003); both are sent, so the answer is reproducible. */
export type Period = { date_from: string; date_to: string; group_by?: string };

export function dushanbeDate(offsetDays = 0): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function defaultPeriod(): { date_from: string; date_to: string } {
  return { date_from: dushanbeDate(-29), date_to: dushanbeDate() };
}

function query(period: Period): string {
  const search = new URLSearchParams({ date_from: period.date_from, date_to: period.date_to });
  if (period.group_by) search.set('group_by', period.group_by);
  return search.toString();
}

function useOrg() {
  const { membership } = useAreaContext();
  return { orgId: membership.organization_id, membership };
}

export function useDashboard() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ['dashboard', orgId],
    queryFn: ({ signal }) => apiRequest<Dashboard>('/dashboard', { headers: { 'X-Org-Id': orgId }, signal }),
    refetchInterval: 60_000,
  });
}

export function useReportList() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ['reports', orgId, 'list'],
    queryFn: ({ signal }) => apiRequest<ReportInfo[]>('/reports', { headers: { 'X-Org-Id': orgId }, signal }),
  });
}

export function useReport(code: string | undefined, period: Period, enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: ['reports', orgId, code, period],
    queryFn: ({ signal }) => apiRequest<Report>(`/reports/${code}?${query(period)}`, { headers: { 'X-Org-Id': orgId }, signal }),
    enabled: Boolean(code) && enabled,
  });
}

export function useExports(status?: ExportStatus, offset = 0) {
  const { orgId } = useOrg();
  const path = `/exports?limit=20&offset=${offset}${status ? `&status=${status}` : ''}`;
  return useQuery({
    queryKey: ['exports', orgId, status ?? 'all', offset],
    queryFn: ({ signal }) => apiRequest<ExportPage>(path, { headers: { 'X-Org-Id': orgId }, signal }),
    // EXP-001 answers 202: the row is polled until the worker has written the file.
    refetchInterval: (result) =>
      result.state.data?.results.some((row) => row.status === 'PENDING' || row.status === 'RUNNING') ? 3000 : false,
  });
}

export function useCreateExport() {
  const { orgId } = useOrg();
  const cache = useQueryClient();
  const [key] = useState(createSubmissionKey);
  return useMutation({
    mutationFn: (body: { kind: string; format: ExportFormat; params: Record<string, unknown> }) =>
      apiRequest<Export>('/exports', {
        method: 'POST',
        body,
        headers: { 'X-Org-Id': orgId },
        idempotencyKey: key.forPayload({ orgId, body }),
      }),
    onSuccess: () => {
      key.complete();
      void cache.invalidateQueries({ queryKey: ['exports', orgId] });
    },
  });
}

/** EXP-003: the signed URL is short-lived, so it is asked for at the moment of the download. */
export function useDownloadExport() {
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: (exportId: string) => apiRequest<Download>(`/exports/${exportId}/download`, { headers: { 'X-Org-Id': orgId } }),
    gcTime: 0,
  });
}
