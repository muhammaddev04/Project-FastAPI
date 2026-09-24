import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './client';

/** Contract of GET /api/v1/meta (backend app/core/health.py). */
export type AuthMethods = {
  password_login: boolean;
  registration: boolean;
  password_reset: boolean;
  email_verification: boolean;
  google: boolean;
};

export type PlatformMeta = {
  version: string;
  languages: string[];
  default_language: string;
  currency: string;
  auth: AuthMethods;
};

export const metaQueryKey = ['meta'] as const;

export function fetchMeta(): Promise<PlatformMeta> {
  return apiRequest<PlatformMeta>('/meta');
}

export function useMeta() {
  return useQuery({ queryKey: metaQueryKey, queryFn: fetchMeta, staleTime: 5 * 60_000 });
}
