import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import { markGoogleLink } from '@/shared/auth/google-intent';

/** Contract of GET /api/v1/auth/google/link and POST /api/v1/auth/google/link/callback. */
export type GoogleLinkState = {
  connected: boolean;
  status: 'linked' | 'already_linked' | null;
  email: string | null;
  linked_at: string | null;
};

export const googleLinkQueryKey = ['google-link'] as const;

export function useGoogleLinkState() {
  return useQuery({ queryKey: googleLinkQueryKey, queryFn: () => apiRequest<GoogleLinkState>('/auth/google/link') });
}

/** Starts linking while signed in: the server binds the flow to this user and browser, then we leave for Google. */
export function useStartGoogleLink() {
  return useMutation({
    mutationFn: () => apiRequest<{ authorization_url: string }>('/auth/google/link/start', { method: 'POST' }),
    onSuccess: ({ authorization_url }) => {
      markGoogleLink();
      window.location.assign(authorization_url);
    },
  });
}

/** Finishes linking on return from Google (needs the restored session: the Bearer token proves the TezFarmo side). */
export function useCompleteGoogleLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { code: string; state: string }) =>
      apiRequest<GoogleLinkState>('/auth/google/link/callback', { method: 'POST', body: payload }),
    onSuccess: (state) => queryClient.setQueryData(googleLinkQueryKey, state),
  });
}
