import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Location } from 'react-router-dom';
import { resetSessionRestoreForTests, restoreSession, useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';
import { routes } from './router';

const META = {
  version: '0.1.0',
  languages: ['tg', 'ru', 'en'],
  default_language: 'tg',
  currency: 'TJS',
  auth: { password_login: true, registration: true, password_reset: true, email_verification: true, google: false },
};
const NO_ORG_USER = meFixture([], { email: 'nigina@example.tj', full_name: 'Nigina Karimova' });
const COMPANY_USER = meFixture([membershipFixture()]);

function setCsrfCookie() {
  document.cookie = 'csrf_token=csrf-1; path=/';
}

function csrfCookie(): string | null {
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith('csrf_token='));
  return entry ? entry.slice('csrf_token='.length) : null;
}

function pathOf<T extends { path: string }>(calls: T[], path: string) {
  return calls.filter((call) => call.path === `/api/v1${path}`);
}

/** Renders the real route table and records every pathname the app passes through. */
function renderAt(path: string) {
  const visited: string[] = [];
  const utils = renderRoutes(routes, path);
  const record = () => {
    const location = utils.current.location as Location | null;
    if (location && visited[visited.length - 1] !== location.pathname) visited.push(location.pathname);
  };
  const timer = setInterval(record, 5);
  record();
  return { ...utils, visited, stop: () => clearInterval(timer) };
}

describe('root route `/`', () => {
  beforeEach(() => {
    resetSessionRestoreForTests();
    useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null, restoring: false });
  });
  afterEach(() => {
    document.cookie = 'csrf_token=; Max-Age=0; path=/';
  });

  // Phase E: `/` is the public homepage for visitors. It renders; it does not redirect anywhere.
  it('shows the public homepage to a visitor and sends them nowhere', async () => {
    const { calls } = mockApi([{ path: '/meta', body: META }]);
    await restoreSession(); // no CSRF cookie: nothing to restore

    const page = renderAt('/');

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    // A marketing page repeats its actions by design, so scope to the header rather than counting them.
    const header = within(screen.getByRole('banner'));
    expect(header.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register');
    expect(header.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(within(screen.getByRole('navigation', { name: 'TezFarmo' })).getAllByRole('link')).toHaveLength(3);
    // No navigation at all is what makes a loop impossible for a guest.
    await new Promise((resolve) => setTimeout(resolve, 200));
    page.stop();
    expect(page.visited).toEqual(['/']);
    expect(pathOf(calls, '/auth/refresh')).toHaveLength(0);
    expect(pathOf(calls, '/me')).toHaveLength(0);
  });

  it('serves the other public pages without a session', async () => {
    mockApi([{ path: '/meta', body: META }]);
    await restoreSession();

    for (const path of ['/how-it-works', '/product']) {
      const page = renderAt(path);
      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
      page.stop();
      expect(page.visited).toEqual([path]);
      page.unmount();
    }
  });

  it('keeps an unauthenticated visitor on /login', async () => {
    mockApi([{ path: '/meta', body: META }]);
    const page = renderAt('/login');

    expect(await screen.findByRole('button', { name: 'Login now' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 200));
    page.stop();
    expect(page.visited).toEqual(['/login']);
  });

  it.each([
    ['a user without an organization', NO_ORG_USER, '/welcome'],
    ['a Company member', COMPANY_USER, '/company'],
  ])('sends %s to the same home the login uses', async (_who, me, home) => {
    mockApi([
      { path: '/meta', body: META },
      { path: '/me', body: me },
    ]);
    useSessionStore.setState({ accessToken: 'live-access' });

    const { current } = renderRoutes(routes, '/');

    await waitFor(() => expect(current.location?.pathname).toBe(home));
  });

  it('does not bounce a signed-in user between /login and /', async () => {
    const { calls } = mockApi([
      { path: '/meta', body: META },
      { path: '/me', body: NO_ORG_USER },
    ]);
    useSessionStore.setState({ accessToken: 'live-access' });
    const page = renderAt('/login');

    await waitFor(() => expect(page.current.location?.pathname).toBe('/welcome'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    page.stop();
    expect(page.visited).toEqual(['/login', '/welcome']);
    expect(pathOf(calls, '/me').length).toBeLessThanOrEqual(1);
  });

  it('never shows a signed-in user the public homepage at `/`', async () => {
    mockApi([
      { path: '/meta', body: META },
      { path: '/me', body: COMPANY_USER },
    ]);
    useSessionStore.setState({ accessToken: 'live-access' });
    const page = renderAt('/');

    await waitFor(() => expect(page.current.location?.pathname).toBe('/company'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    page.stop();
    // Straight there: `homePath` never returns `/`, so the signed-in branch cannot bounce back.
    expect(page.visited).toEqual(['/', '/company']);
    expect(screen.queryByRole('link', { name: 'Create account' })).not.toBeInTheDocument();
  });

  it('restores the session on a reload of `/` without passing through /login', async () => {
    setCsrfCookie();
    mockApi([
      { path: '/meta', body: META },
      { method: 'POST', path: '/auth/refresh', body: { access_token: 'restored', expires_in: 900 } },
      { path: '/me', body: NO_ORG_USER },
    ]);

    void restoreSession();
    const page = renderAt('/');

    await waitFor(() => expect(page.current.location?.pathname).toBe('/welcome'), { timeout: 3000 });
    page.stop();
    expect(page.visited).not.toContain('/login');
  });

  it('treats a refused restoration as a visitor: `/` settles on the public homepage', async () => {
    setCsrfCookie();
    mockApi([
      { path: '/meta', body: META },
      { method: 'POST', path: '/auth/refresh', status: 401, body: { error: { code: 'token_invalid', message: '', details: {} } } },
    ]);

    void restoreSession();
    const page = renderAt('/');

    // Someone with a stale cookie waits behind the loader rather than seeing the homepage and being moved off it.
    expect(await screen.findByRole('heading', { level: 1 }, { timeout: 3000 })).toBeInTheDocument();
    page.stop();
    expect(page.visited).toEqual(['/']);
    expect(screen.queryByText('You were signed out')).not.toBeInTheDocument();
  });

  it('signs out on the server, lands on /login, and a reload of `/` stays signed out', async () => {
    setCsrfCookie();
    const { calls } = mockApi([
      { path: '/meta', body: META },
      { path: '/me', body: NO_ORG_USER },
      { method: 'POST', path: '/auth/logout', status: 204 },
    ]);
    useSessionStore.setState({ accessToken: 'live-access' });
    const { current, unmount } = renderRoutes(routes, '/welcome');

    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }));

    await waitFor(() => expect(current.location?.pathname).toBe('/login'));
    const [logout] = pathOf(calls, '/auth/logout');
    expect(logout).toMatchObject({ method: 'POST' });
    expect(logout!.headers['X-CSRF-Token']).toBe('csrf-1');
    expect(logout!.headers.Authorization).toBeUndefined();
    expect(useSessionStore.getState()).toMatchObject({ accessToken: null, endedReason: null });
    expect(csrfCookie()).toBeNull();

    // "Reload": a new page load tries to restore the session and finds nothing to restore.
    unmount();
    resetSessionRestoreForTests();
    await restoreSession();
    const reloaded = renderAt('/');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    reloaded.stop();
    expect(reloaded.visited).toEqual(['/']);
    expect(pathOf(calls, '/auth/refresh')).toHaveLength(0);
  });

  it('still signs out locally when the logout request fails', async () => {
    setCsrfCookie();
    const { fetchMock } = mockApi([
      { path: '/meta', body: META },
      { path: '/me', body: NO_ORG_USER },
    ]);
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/auth/logout')) throw new TypeError('Failed to fetch');
      return answer(input, init);
    });
    useSessionStore.setState({ accessToken: 'live-access' });
    const { current } = renderRoutes(routes, '/welcome');

    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }));

    await waitFor(() => expect(current.location?.pathname).toBe('/login'));
    expect(useSessionStore.getState().accessToken).toBeNull();
    expect(csrfCookie()).toBeNull();
  });

  it('sends a guest from a protected page to /login?next=… after a reload', async () => {
    mockApi([{ path: '/meta', body: META }]);
    await restoreSession();

    const { current } = renderRoutes(routes, '/company');

    await waitFor(() => expect(current.location?.pathname).toBe('/login'));
    expect(current.location?.search).toBe(`?next=${encodeURIComponent('/company')}`);
  });
});
