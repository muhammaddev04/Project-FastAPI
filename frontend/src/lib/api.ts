import type { AuthResponse, User } from './types';

export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
};

const baseUrl = (globalThis as typeof globalThis & { __API_BASE_URL__?: string }).__API_BASE_URL__ ?? 'http://localhost:8000';

export function friendlyAuthError(error: unknown): string {
  if (!(error instanceof Error)) return 'Something went wrong. Please try again.';
  const messages: Record<string, string> = {
    invalid_credentials: 'That phone number or password is not correct.',
    phone_already_registered: 'This phone number is already registered. Try signing in.',
    invalid_code: 'The verification code is not correct.',
    rate_limit_exceeded: 'Too many attempts. Please wait a few minutes and try again.',
    google_oauth_not_configured: 'Google sign-in is not configured yet.',
    google_code_missing: 'Google sign-in was cancelled. Please try again.',
  };
  return messages[error.message] ?? error.message ?? 'Something went wrong. Please try again.';
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, accessToken?: string): Promise<T> {
  const language = typeof localStorage !== 'undefined' ? localStorage.getItem('tezfarmo.language') ?? 'tg' : 'tg';
  const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `req-${Date.now()}`;
  const res = await fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': language,
      'X-Request-Id': requestId,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const payload = typeof data === 'string' ? { message: data } : data;
    const apiError = payload?.detail ?? payload;
    const error = new Error(apiError?.code ?? apiError?.message ?? 'request_failed') as Error & { status?: number; apiError?: ApiError };
    error.status = res.status;
    error.apiError = apiError;
    throw error;
  }

  return data as T;
}

export async function apiFetchWithRefresh<T>(
  path: string,
  init: RequestInit,
  accessToken: string,
  refresh: () => Promise<string | null>,
): Promise<T> {
  try {
    return await apiFetch<T>(path, init, accessToken);
  } catch (cause) {
    if (!(cause instanceof Error) || (cause as Error & { status?: number }).status !== 401) throw cause;
    const nextAccessToken = await refresh();
    if (!nextAccessToken) throw cause;
    return apiFetch<T>(path, init, nextAccessToken);
  }
}

export type MeResponse = User;
export type LoginResponse = AuthResponse;
