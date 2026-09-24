import { mockApi } from '@/test/render';
import { setLanguage } from '@/shared/i18n';
import { ApiError, apiRequest, configureApiSession } from './client';
import { errorMessage, fieldErrorMap } from './errors';
import { i18n } from '@/shared/i18n';

describe('API client (FND-034)', () => {
  beforeEach(() => {
    setLanguage('ru');
    configureApiSession({ getAccessToken: () => null, getOrgId: () => null, onUnauthorized: () => undefined });
  });

  it('sends language, request id, bearer token and org header', async () => {
    const { calls } = mockApi([{ path: '/members', body: { ok: true } }]);
    configureApiSession({ getAccessToken: () => 'token-1', getOrgId: () => 'org-1' });
    await apiRequest('/members', { orgScoped: true });
    const headers = calls[0]!.headers;
    expect(headers['Accept-Language']).toBe('ru');
    expect(headers['X-Request-Id']).toMatch(/^[a-z0-9]+$/);
    expect(headers.Authorization).toBe('Bearer token-1');
    expect(headers['X-Org-Id']).toBe('org-1');
  });

  it('does not send X-Org-Id for unscoped requests', async () => {
    const { calls } = mockApi([{ path: '/meta', body: {} }]);
    configureApiSession({ getOrgId: () => 'org-1' });
    await apiRequest('/meta');
    expect(calls[0]!.headers['X-Org-Id']).toBeUndefined();
  });

  it('parses the API-001 error envelope', async () => {
    mockApi([
      {
        path: '/thing',
        status: 422,
        body: {
          error: {
            code: 'validation_error',
            message: 'x',
            details: { fields: [{ field: 'phone', code: 'invalid_phone', message: 'Bad phone' }] },
            request_id: 'req-9',
          },
        },
      },
    ]);
    const error = await apiRequest('/thing').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe('validation_error');
    expect(apiError.requestId).toBe('req-9');
    expect(fieldErrorMap(apiError)).toEqual({ phone: 'Bad phone' });
  });

  it('reports network failures with a stable code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiRequest('/meta')).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('reports timeouts separately from network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })),
    );
    await expect(apiRequest('/meta', { timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('notifies the session layer on 401', async () => {
    mockApi([{ path: '/me', status: 401, body: { error: { code: 'token_expired', message: '', details: {}, request_id: 'r' } } }]);
    const onUnauthorized = vi.fn();
    configureApiSession({ onUnauthorized });
    await expect(apiRequest('/me')).rejects.toMatchObject({ code: 'token_expired' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('maps error codes to translated messages and hides unknown codes (FE-006)', () => {
    setLanguage('en');
    const t = i18n.t.bind(i18n);
    expect(errorMessage(new ApiError({ status: 403, code: 'permission_denied' }), t)).toBe(
      "You don't have permission for this action.",
    );
    expect(errorMessage(new ApiError({ status: 500, code: 'some_new_code' }), t)).toBe('Something went wrong. Please try again.');
    expect(errorMessage(new Error('boom'), t)).toBe('Something went wrong. Please try again.');
  });
});
