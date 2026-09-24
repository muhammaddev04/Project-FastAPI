import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Never retry client errors (401/403/404/422); retry transient failures once.
        retry: (failureCount, error) =>
          failureCount < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
