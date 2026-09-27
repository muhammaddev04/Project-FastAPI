import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { isGoogleLinkReturn, markGoogleLink } from '@/shared/auth/google-intent';
import { resetSessionRestoreForTests, restoreSession, useSessionStore } from '@/shared/auth/session-store';
import { meFixture } from '@/test/fixtures';
import { mockApi, renderRoutes, type MockRoute } from '@/test/render';

const META = {
  version: '0.1.0',
  languages: ['tg', 'ru', 'en'],
  default_language: 'tg',
  currency: 'TJS',
  auth: { password_login: true, registration: true, password_reset: true, email_verification: true, google: true },
};
const USER = meFixture([], { email: 'nigina@gmail.com', full_name: 'Nigina Karimova' });
const NOT_CONNECTED = { connected: false, status: null, email: null, linked_at: null };
const CONNECTED = { connected: true, status: 'linked', email: 'nigina@gmail.com', linked_at: '2026-09-27T08:00:00Z' };
const STATE = 'state-' + 'y'.repeat(40);

function signedIn(extra: MockRoute[]) {
  useSessionStore.setState({ accessToken: 'access-1', activeOrgId: null, endedReason: null, restoring: false });
  return mockApi([{ path: '/meta', body: META }, { path: '/me', body: USER }, ...extra]);
}

function apiError(code: string) {
  return { error: { code, message: code, details: {}, request_id: 'r' } };
}

describe('Connect Google on /profile', () => {
  const originalLocation = window.location;
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    sessionStorage.clear();
    document.cookie = 'csrf_token=; Max-Age=0; path=/';
  });

  it('shows Google as not connected and starts the link flow while signed in', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
    const { calls } = signedIn([
      { path: '/auth/google/link', body: NOT_CONNECTED },
      { method: 'POST', path: '/auth/google/link/start', body: { authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' } },
    ]);
    renderRoutes(routes, '/profile');

    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /connect google/i }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'));
    const start = calls.find((call) => call.path === '/api/v1/auth/google/link/start');
    expect(start?.headers.Authorization).toBe('Bearer access-1');
    expect(isGoogleLinkReturn()).toBe(true);
  });

  it('finishes the link on return (even though the user is signed in) and shows it as connected', async () => {
    markGoogleLink();
    const { calls } = signedIn([
      { method: 'POST', path: '/auth/google/link/callback', body: CONNECTED },
      { path: '/auth/google/link', body: CONNECTED },
    ]);
    const { current } = renderRoutes(routes, `/auth/google/callback?state=${STATE}&code=code-1`);

    await waitFor(() => expect(current.location?.pathname).toBe('/profile'));
    expect(await screen.findByText(/your google account is now connected/i)).toBeInTheDocument();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    const link = calls.find((call) => call.path === '/api/v1/auth/google/link/callback');
    expect(link?.body).toEqual({ code: 'code-1', state: STATE });
    expect(link?.headers.Authorization).toBe('Bearer access-1');
    // A link return never signs anyone in through the login callback.
    expect(calls.some((call) => call.path === '/api/v1/auth/google/callback')).toBe(false);
    expect(isGoogleLinkReturn()).toBe(false);
  });

  it('restores the session after the trip to Google before finishing the link', async () => {
    markGoogleLink();
    resetSessionRestoreForTests();
    useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null, restoring: false });
    document.cookie = 'csrf_token=csrf-1; path=/';
    const { calls } = mockApi([
      { path: '/meta', body: META },
      { path: '/me', body: USER },
      { method: 'POST', path: '/auth/refresh', body: { access_token: 'restored', expires_in: 900 } },
      { method: 'POST', path: '/auth/google/link/callback', body: CONNECTED },
      { path: '/auth/google/link', body: CONNECTED },
    ]);

    void restoreSession();
    const { current } = renderRoutes(routes, `/auth/google/callback?state=${STATE}&code=code-1`);

    await waitFor(() => expect(current.location?.pathname).toBe('/profile'));
    expect(calls.find((call) => call.path === '/api/v1/auth/google/link/callback')?.headers.Authorization).toBe('Bearer restored');
  });

  it('shows a safe error when the Google account belongs to someone else', async () => {
    markGoogleLink();
    signedIn([{ method: 'POST', path: '/auth/google/link/callback', status: 409, body: apiError('oauth_identity_already_linked') }]);
    const { current } = renderRoutes(routes, `/auth/google/callback?state=${STATE}&code=code-1`);

    expect(await screen.findByText("Couldn't connect Google")).toBeInTheDocument();
    expect(screen.getByText('This Google account is already connected to another TezFarmo account.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to profile' })).toHaveAttribute('href', '/profile');
    expect(current.location?.pathname).toBe('/auth/google/callback');
    expect(current.location?.search).toBe(''); // no code or state left in the address bar
    await userEvent.click(screen.getByRole('link', { name: 'Back to profile' }));
    expect(isGoogleLinkReturn()).toBe(false);
  });

  it('returns to the profile unchanged when the user cancels on Google', async () => {
    markGoogleLink();
    const { calls } = signedIn([{ path: '/auth/google/link', body: NOT_CONNECTED }]);
    const { current } = renderRoutes(routes, '/auth/google/callback?error=access_denied');

    await waitFor(() => expect(current.location?.pathname).toBe('/profile'));
    expect(await screen.findByText(/connecting google was cancelled/i)).toBeInTheDocument();
    expect(calls.some((call) => call.path.includes('/link/callback'))).toBe(false);
  });

  it('keeps showing Google as connected after sign-out and sign-in again (the link lives on the server)', async () => {
    document.cookie = 'csrf_token=csrf-1; path=/';
    const { calls } = signedIn([
      { path: '/auth/google/link', body: CONNECTED },
      { method: 'POST', path: '/auth/logout', status: 204 },
    ]);
    const profile = renderRoutes(routes, '/profile');
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    profile.unmount();
    const first = renderRoutes(routes, '/welcome');
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }));
    await waitFor(() => expect(first.current.location?.pathname).toBe('/login'));
    first.unmount();

    useSessionStore.setState({ accessToken: 'access-2' });
    renderRoutes(routes, '/profile');
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(calls.filter((call) => call.path === '/api/v1/auth/logout')).toHaveLength(1);
  });

  it('signs in with the linked Google account through the normal login callback after logout', async () => {
    useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null, restoring: false });
    const { calls } = mockApi([
      { path: '/meta', body: META },
      { path: '/me', body: USER },
      { method: 'POST', path: '/auth/google/callback', body: { access_token: 'google-access', expires_in: 900, user: USER } },
    ]);
    const { current } = renderRoutes(routes, `/auth/google/callback?state=${STATE}&code=code-2`);

    await waitFor(() => expect(current.location?.pathname).toBe('/welcome'));
    expect(calls.some((call) => call.path === '/api/v1/auth/google/callback')).toBe(true);
    expect(calls.some((call) => call.path.includes('/link/'))).toBe(false);
    expect(useSessionStore.getState().accessToken).toBe('google-access');
  });
});
