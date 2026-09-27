import { apiRequest } from '@/shared/api/client';
import { mockApi } from '@/test/render';
import { useSessionStore } from './session-store';

function expireCsrfCookie() {
  document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
}

describe('FE-008 access token refresh', () => {
  beforeEach(() => {
    useSessionStore.setState({ accessToken: 'expired', activeOrgId: null, endedReason: null });
    document.cookie = 'csrf_token=csrf-1; path=/';
  });
  afterEach(expireCsrfCookie);

  it('refreshes once with the CSRF cookie echoed, then repeats the request with the new token', async () => {
    const { calls, fetchMock } = mockApi([{ method: 'POST', path: '/auth/refresh', body: { access_token: 'fresh', expires_in: 900 } }]);
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (String(input).endsWith('/me')) {
        calls.push({ method: 'GET', path: '/api/v1/me', headers: { Authorization: auth ?? '' }, body: undefined });
        return auth === 'Bearer fresh'
          ? new Response(JSON.stringify({ ok: true }), { status: 200 })
          : new Response(JSON.stringify({ error: { code: 'token_expired', message: '', details: {} } }), { status: 401 });
      }
      return answer(input, init);
    });

    await expect(apiRequest('/me')).resolves.toEqual({ ok: true });

    const refresh = calls.filter((call) => call.path === '/api/v1/auth/refresh');
    expect(refresh).toHaveLength(1);
    expect(refresh[0]!.headers['X-CSRF-Token']).toBe('csrf-1');
    expect(refresh[0]!.headers.Authorization).toBeUndefined();
    expect(calls.filter((call) => call.path === '/api/v1/me').map((call) => call.headers.Authorization)).toEqual([
      'Bearer expired',
      'Bearer fresh',
    ]);
    expect(useSessionStore.getState()).toMatchObject({ accessToken: 'fresh', endedReason: null });
  });

  it('shares one refresh between concurrent 401s (a second refresh would look like reuse)', async () => {
    const { calls, fetchMock } = mockApi([{ method: 'POST', path: '/auth/refresh', body: { access_token: 'fresh', expires_in: 900 } }]);
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/auth/refresh')) return answer(input, init);
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer fresh'
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(JSON.stringify({ error: { code: 'token_expired', message: '', details: {} } }), { status: 401 });
    });

    await Promise.all([apiRequest('/a'), apiRequest('/b'), apiRequest('/c')]);

    expect(calls.filter((call) => call.path === '/api/v1/auth/refresh')).toHaveLength(1);
  });

  it('ends the session when the refresh is refused', async () => {
    mockApi([
      { path: '/me', status: 401, body: { error: { code: 'token_expired', message: '', details: {} } } },
      { method: 'POST', path: '/auth/refresh', status: 401, body: { error: { code: 'refresh_token_reused', message: '', details: {} } } },
    ]);

    await expect(apiRequest('/me')).rejects.toMatchObject({ code: 'token_expired' });
    expect(useSessionStore.getState()).toMatchObject({ accessToken: null, endedReason: 'token_expired' });
  });

  it('does not try to refresh without the CSRF cookie', async () => {
    expireCsrfCookie();
    const { calls } = mockApi([{ path: '/me', status: 401, body: { error: { code: 'token_expired', message: '', details: {} } } }]);

    await expect(apiRequest('/me')).rejects.toMatchObject({ code: 'token_expired' });
    expect(calls.map((call) => call.path)).toEqual(['/api/v1/me']);
    expect(useSessionStore.getState().accessToken).toBeNull();
  });
});
