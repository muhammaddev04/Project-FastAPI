import { currentLanguage } from '@/shared/i18n';

export const API_BASE = '/api/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

export type ApiErrorDetails = Record<string, unknown>;
export type FieldError = { field: string; code: string; message: string };

/** Parsed API-001 error; `code` is stable and maps to the `errors.<code>` translation key (FE-006). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetails;
  readonly requestId: string | null;

  constructor(init: { status: number; code: string; message?: string; details?: ApiErrorDetails; requestId?: string | null }) {
    super(init.message ?? init.code);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
  }

  get fieldErrors(): FieldError[] {
    const fields = this.details.fields;
    return Array.isArray(fields) ? (fields as FieldError[]) : [];
  }

  get retryAfterSeconds(): number | null {
    const value = this.details.retry_after;
    return typeof value === 'number' ? value : null;
  }
}

/**
 * Session integration points. P01 registers these; until the deferred session work lands, only
 * `getAccessToken`/`getOrgId`/`onUnauthorized` are wired and no token is ever fabricated here.
 */
type SessionHooks = {
  getAccessToken: () => string | null;
  getOrgId: () => string | null;
  onUnauthorized: (error: ApiError) => void;
  /** FE-008: exchange the refresh cookie for a new access token once; null when unavailable. */
  refreshAccessToken?: () => Promise<string | null>;
};

let hooks: SessionHooks = {
  getAccessToken: () => null,
  getOrgId: () => null,
  onUnauthorized: () => undefined,
};

export function configureApiSession(next: Partial<SessionHooks>): void {
  hooks = { ...hooks, ...next };
}

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}`;
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Send X-Org-Id for organization-scoped endpoints (IAM-010). */
  orgScoped?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra request headers, e.g. `X-CSRF-Token` for the cookie-based auth endpoints (SEC-005). */
  headers?: Record<string, string>;
  /**
   * P01 login/refresh: their 401 is an answer about the credentials, not a lost session, so it neither triggers
   * the FE-008 refresh retry nor ends the current session.
   */
  authEndpoint?: boolean;
  responseType?: 'blob';
};

async function parseError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('x-request-id');
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string; details?: ApiErrorDetails; request_id?: string } };
    if (body?.error?.code) {
      return new ApiError({
        status: response.status,
        code: body.error.code,
        message: body.error.message,
        details: body.error.details,
        requestId: body.error.request_id ?? requestId,
      });
    }
  } catch {
    /* non-JSON body: fall through to a status-based code */
  }
  return new ApiError({ status: response.status, code: response.status >= 500 ? 'internal_error' : 'bad_request', requestId });
}

async function send(path: string, options: RequestOptions, accessToken: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': currentLanguage(),
    'X-Request-Id': newRequestId(),
  };
  const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
  // JSON by default; a FormData body (file upload) lets the browser set the multipart boundary itself.
  if (options.body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  Object.assign(headers, options.headers);
  if (options.orgScoped) {
    const orgId = hooks.getOrgId();
    if (orgId) headers['X-Org-Id'] = orgId;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  options.signal?.addEventListener('abort', () => controller.abort(options.signal?.reason), { once: true });
  try {
    return await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : multipart ? (options.body as FormData) : JSON.stringify(options.body),
      credentials: 'same-origin',
      signal: controller.signal,
    });
  } catch (cause) {
    if (controller.signal.aborted && controller.signal.reason === 'timeout') {
      throw new ApiError({ status: 0, code: 'timeout' });
    }
    if (options.signal?.aborted) throw cause;
    throw new ApiError({ status: 0, code: 'network' });
  } finally {
    clearTimeout(timeout);
  }
}

/** Typed JSON request against /api/v1 (FND-034). */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options, options.authEndpoint ? null : hooks.getAccessToken());

  // A 401 `invalid_credentials` (wrong current password on password change) is an answer, not a lost session.
  const sessionLost = async (res: Response) => res.status === 401 && (await parseError(res.clone())).code !== 'invalid_credentials';

  if (!options.authEndpoint && hooks.refreshAccessToken && hooks.getAccessToken() && (await sessionLost(response))) {
    const renewed = await hooks.refreshAccessToken();
    if (renewed) response = await send(path, options, renewed);
  }

  if (!response.ok) {
    const error = await parseError(response);
    if (error.status === 401 && !options.authEndpoint && error.code !== 'invalid_credentials') hooks.onUnauthorized(error);
    throw error;
  }
  if (options.responseType === 'blob') return (await response.blob()) as T;
  // 204, and the 202 of the P01 email endpoints, carry no body.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
