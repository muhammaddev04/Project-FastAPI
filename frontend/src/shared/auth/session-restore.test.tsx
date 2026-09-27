import { screen, waitFor } from '@testing-library/react';
import { routes } from '@/app/router';
import { meFixture } from '@/test/fixtures';
import { mockApi, renderRoutes, type MockRoute } from '@/test/render';
import { resetSessionRestoreForTests, restoreSession, useSessionStore } from './session-store';

const META = {
  version: '0.1.0',
  languages: ['tg', 'ru', 'en'],
  default_language: 'tg',
  currency: 'TJS',
  auth: { password_login: true, registration: true, password_reset: false, email_verification: true, google: false },
};
const USER = meFixture([], { email: 'nigina@example.tj', full_name: 'Nigina Karimova' });
const REFRESHED = { access_token: 'restored', expires_in: 900 };
const REFUSED = { error: { code: 'refresh_token_reused', message: '', details: {}, request_id: 'r' } };

function setCsrfCookie() {
  document.cookie = 'csrf_token=csrf-1; path=/';
}

function refreshCalls<T extends { path: string }>(calls: T[]) {
  return calls.filter((call) => call.path === '/api/v1/auth/refresh');
}

/** A fresh page load: nothing in memory, the startup restoration not yet run. */
function pageLoad(extra: MockRoute[]) {
  return mockApi([{ path: '/meta', body: META }, ...extra]);
}

describe('session restoration on startup (SEC-004 + FE-008)', () => {
  beforeEach(() => {
    resetSessionRestoreForTests();
    useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null, restoring: false });
  });
  afterEach(() => {
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('restores a signed-in user on a protected page after a reload', async () => {
    setCsrfCookie();
    const { calls } = pageLoad([
      { method: 'POST', path: '/auth/refresh', body: REFRESHED },
      { path: '/me', body: USER },
    ]);

    void restoreSession();
    const { current } = renderRoutes(routes, '/profile');

    expect(await screen.findByText('nigina@example.tj', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(current.location?.pathname).toBe('/profile');
    const [refresh] = refreshCalls(calls);
    expect(refresh!.method).toBe('POST');
    expect(refresh!.headers['X-CSRF-Token']).toBe('csrf-1');
    expect(refresh!.headers.Authorization).toBeUndefined();
    // The user comes from the ordinary authenticated /me, sent with the restored token.
    expect(calls.find((call) => call.path === '/api/v1/me')!.headers.Authorization).toBe('Bearer restored');
    expect(useSessionStore.getState()).toMatchObject({ accessToken: 'restored', restoring: false, endedReason: null });
    expect(JSON.stringify({ ...localStorage })).not.toContain('restored');
  });

  it('keeps a restored user off /login', async () => {
    setCsrfCookie();
    pageLoad([
      { method: 'POST', path: '/auth/refresh', body: REFRESHED },
      { path: '/me', body: USER },
    ]);

    void restoreSession();
    const { current } = renderRoutes(routes, '/login');

    await waitFor(() => expect(current.location?.pathname).toBe('/welcome'));
  });

  it('does not decide "guest" while the restoration is still running', async () => {
    setCsrfCookie();
    let release: () => void = () => undefined;
    const { calls, fetchMock } = pageLoad([{ path: '/me', body: USER }]);
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith('/auth/refresh')) return answer(input, init);
      calls.push({ method: 'POST', path: '/api/v1/auth/refresh', headers: {}, body: undefined });
      await new Promise<void>((resolve) => (release = resolve));
      return new Response(JSON.stringify(REFRESHED), { status: 200 });
    });

    void restoreSession();
    const { current } = renderRoutes(routes, '/profile');

    await waitFor(() => expect(refreshCalls(calls)).toHaveLength(1));
    expect(useSessionStore.getState().restoring).toBe(true);
    expect(current.location?.pathname).toBe('/profile');
    expect(screen.getByRole('status')).toBeInTheDocument(); // the full-page loader

    release();
    expect(await screen.findByText('nigina@example.tj', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(current.location?.pathname).toBe('/profile');
  });

  it('treats a visitor without the CSRF cookie as a guest without sending anything', async () => {
    const { calls } = pageLoad([]);

    await restoreSession();
    const { current } = renderRoutes(routes, '/profile');

    await waitFor(() => expect(current.location?.pathname).toBe('/login'));
    expect(refreshCalls(calls)).toHaveLength(0);
    expect(screen.queryByText('You were signed out')).not.toBeInTheDocument();
  });

  it.each([
    ['revoked or reused', 401, REFUSED],
    ['missing refresh cookie', 401, { error: { code: 'not_authenticated', message: '', details: {}, request_id: 'r' } }],
    ['blocked user', 403, { error: { code: 'user_blocked', message: '', details: {}, request_id: 'r' } }],
    ['server trouble', 503, { error: { code: 'service_unavailable', message: '', details: {}, request_id: 'r' } }],
  ])('continues as a guest when the refresh is refused (%s), once and quietly', async (_case, status, body) => {
    setCsrfCookie();
    const { calls } = pageLoad([{ method: 'POST', path: '/auth/refresh', status, body }]);

    void restoreSession();
    const { current } = renderRoutes(routes, `/profile`);

    await waitFor(() => expect(current.location?.pathname).toBe('/login'));
    expect(current.location?.search).toBe(`?next=${encodeURIComponent('/profile')}`);
    expect(await screen.findByRole('button', { name: 'Login now' })).toBeInTheDocument();
    expect(screen.queryByText('You were signed out')).not.toBeInTheDocument();
    expect(useSessionStore.getState()).toMatchObject({ accessToken: null, endedReason: null, restoring: false });
    // No loop: the refused refresh is not tried again.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(refreshCalls(calls)).toHaveLength(1);
  });

  it('tries the restoration exactly once per page load', async () => {
    setCsrfCookie();
    const { calls } = pageLoad([
      { method: 'POST', path: '/auth/refresh', body: REFRESHED },
      { path: '/me', body: USER },
    ]);

    await Promise.all([restoreSession(), restoreSession(), restoreSession()]);
    await restoreSession();

    expect(refreshCalls(calls)).toHaveLength(1);
    expect(useSessionStore.getState().accessToken).toBe('restored');
  });

  it('does not refresh when a session is already in memory', async () => {
    setCsrfCookie();
    useSessionStore.setState({ accessToken: 'live' });
    const { calls } = pageLoad([]);

    await restoreSession();

    expect(refreshCalls(calls)).toHaveLength(0);
    expect(useSessionStore.getState().accessToken).toBe('live');
  });
});
