import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/client';
import { meQueryKey } from '@/shared/auth/api';
import { clearGoogleIntent } from '@/shared/auth/google-intent';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Me, OrgType } from '@/shared/auth/types';
import type { Language } from '@/shared/i18n';

/**
 * Contract of POST /api/v1/auth/register (backend auth/schemas.py RegisterRequest): 202, no body (IAM-001).
 * `org_type`/`org_name` are the P01 §10 onboarding intent, stored on the user; no organization is created.
 */
export type RegisterPayload = {
  email: string;
  password: string;
  full_name: string;
  language: Language;
  org_type?: OrgType;
  org_name?: string;
};

export function useRegister() {
  return useMutation({
    mutationFn: (payload: RegisterPayload) => apiRequest<void>('/auth/register', { method: 'POST', body: payload }),
  });
}

/** POST /api/v1/auth/email/verify `{email, code}` (the 6-digit code from the email) → 204 (IAM-002). */
export function useVerifyEmail() {
  return useMutation({
    mutationFn: (payload: { email: string; code: string }) =>
      apiRequest<void>('/auth/email/verify', { method: 'POST', body: payload }),
  });
}

/** POST /api/v1/auth/email/resend `{email}` → 202 for every address; 429 carries Retry-After (P01 §6). */
export function useResendVerification() {
  return useMutation({
    mutationFn: (email: string) => apiRequest<void>('/auth/email/resend', { method: 'POST', body: { email } }),
  });
}

/** Contract of POST /api/v1/auth/login (F-1.2, IAM-004): `user` is the GET /me object. */
export type LoginResponse = { access_token: string; expires_in: number; user: Me };

/**
 * POST /api/v1/auth/password/reset/start `{email}` → 202 for every address (IAM-015: no enumeration);
 * 429 `rate_limited` (password_reset, 3 per hour per email) carries Retry-After.
 */
export function usePasswordResetStart() {
  return useMutation({
    mutationFn: (email: string) => apiRequest<void>('/auth/password/reset/start', { method: 'POST', body: { email } }),
  });
}

/** Contract of POST /api/v1/auth/password/reset/verify: a one-time reset authorization (10 minutes). */
export type PasswordResetAuthorization = { reset_token: string; expires_in: number };

/**
 * POST /api/v1/auth/password/reset/verify `{email, code}` (the 6-digit code from the email) → the reset
 * authorization. It is kept in memory only and spent by the completion step.
 */
export function usePasswordResetVerify() {
  return useMutation({
    mutationFn: (payload: { email: string; code: string }) =>
      apiRequest<PasswordResetAuthorization>('/auth/password/reset/verify', { method: 'POST', body: payload }),
  });
}

/**
 * POST /api/v1/auth/password/reset/complete `{token, new_password}` → 204. `token` is the authorization from the
 * verify step (never the code); success signs every device out, so the user signs in again.
 */
export function usePasswordResetComplete() {
  return useMutation({
    mutationFn: (payload: { token: string; new_password: string }) =>
      apiRequest<void>('/auth/password/reset/complete', { method: 'POST', body: payload }),
  });
}

/** Stores a session answer (login or Google): the user is cached as /me, the access token kept in memory. */
function useStartSession() {
  const queryClient = useQueryClient();
  const setAccessToken = useSessionStore((state) => state.setAccessToken);
  return ({ access_token, user }: LoginResponse) => {
    queryClient.setQueryData(meQueryKey, user);
    setAccessToken(access_token);
  };
}

/**
 * Signs in. The refresh token arrives only as an httpOnly cookie (SEC-004) and the CSRF value as a readable
 * cookie (SEC-005); the access token is kept in memory. The user is cached as /me, so no extra request is needed.
 */
export function useLogin() {
  const startSession = useStartSession();
  return useMutation({
    mutationFn: (payload: { email: string; password: string }) =>
      apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: payload, authEndpoint: true }),
    onSuccess: startSession,
  });
}

/** Where "Continue with Google" starts: the backend redirects to Google with state, nonce and PKCE. */
export const GOOGLE_START_URL = '/api/v1/auth/google/start';

/** Leaves the app for Google (a full page navigation, so the backend can set its binding cookie). */
export function goToGoogle(): void {
  clearGoogleIntent(); // a plain sign-in: never let an abandoned "Connect Google" turn it into a link attempt
  window.location.assign(GOOGLE_START_URL);
}

/**
 * Finishes Continue with Google: the backend exchanges the code (the client secret never reaches the browser)
 * and answers exactly like login.
 */
export function useGoogleSignIn() {
  const startSession = useStartSession();
  return useMutation({
    mutationFn: (payload: { code: string; state: string }) =>
      apiRequest<LoginResponse>('/auth/google/callback', { method: 'POST', body: payload, authEndpoint: true }),
    onSuccess: startSession,
  });
}
