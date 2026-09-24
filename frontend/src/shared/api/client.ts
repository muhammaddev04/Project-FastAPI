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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Send X-Org-Id for organization-scoped endpoints (IAM-010). */
  orgScoped?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
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
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
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
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
  let response = await send(path, options, hooks.getAccessToken());

  if (response.status === 401 && hooks.refreshAccessToken && hooks.getAccessToken()) {
    const renewed = await hooks.refreshAccessToken();
    if (renewed) response = await send(path, options, renewed);
  }

  if (!response.ok) {
    const error = await parseError(response);
    if (error.status === 401) hooks.onUnauthorized(error);
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
