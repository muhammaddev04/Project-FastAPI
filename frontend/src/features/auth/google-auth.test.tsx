import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';

const META = {
  version: '0.1.0',
  languages: ['tg', 'ru', 'en'],
  default_language: 'tg',
  currency: 'TJS',
  auth: { password_login: true, registration: true, password_reset: false, email_verification: true, google: true },
};
const USER = meFixture([], { email: 'nigina@gmail.com', full_name: 'Nigina Karimova' });
const CODE = '4/0Abc-google-code';
const STATE = 'state-' + 'x'.repeat(40);

function apiError(code: string) {
  return { error: { code, message: code, details: {}, request_id: 'r' } };
}

function googleCalls<T extends { path: string }>(calls: T[]) {
  return calls.filter((call) => call.path === '/api/v1/auth/google/callback');
}

describe('Continue with Google (F-1.9)', () => {
  const originalLocation = window.location;

  beforeEach(() => useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null, restoring: false }));
  afterEach(() => Object.defineProperty(window, 'location', { configurable: true, value: originalLocation }));

  it('leaves for the backend start endpoint when clicked, showing progress', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
    mockApi([{ path: '/meta', body: META }]);
    renderRoutes(routes, '/login');

    const button = await screen.findByRole('button', { name: /continue with google/i });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    expect(assign).toHaveBeenCalledWith('/api/v1/auth/google/start');
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('is offered on registration too and starts the very same backend flow', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
    mockApi([{ path: '/meta', body: META }]);
    renderRoutes(routes, '/register');

    const button = await screen.findByRole('button', { name: /continue with google/i });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    expect(assign).toHaveBeenCalledWith('/api/v1/auth/google/start');
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('stays disabled while the server does not offer Google', async () => {
    mockApi([{ path: '/meta', body: { ...META, auth: { ...META.auth, google: false } } }]);
    renderRoutes(routes, '/login');
    expect(await screen.findByText('Not enabled on this server yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled();
  });

  it('hands code and state to the backend once, signs in and enters the app', async () => {
    const { calls } = mockApi([
      { path: '/meta', body: META },
      { method: 'POST', path: '/auth/google/callback', body: { access_token: 'google-access', expires_in: 900, user: USER } },
    ]);
    const { current } = renderRoutes(routes, `/auth/google/callback?state=${STATE}&code=${CODE}&scope=email`);

    await waitFor(() => expect(current.location?.pathname).toBe('/welcome'));
    const [call] = googleCalls(calls);
    expect(call).toMatchObject({ method: 'POST', body: { code: CODE, state: STATE } });
    expect(call!.headers.Authorization).toBeUndefined();
    expect(googleCalls(calls)).toHaveLength(1);
    expect(useSessionStore.getState()).toMatchObject({ accessToken: 'google-access', endedReason: null });
  });

  it('removes the code from the address bar', async () => {
    mockApi([
      { path: '/meta', body: META },
      { method: 'POST', path: '/auth/google/callback', status: 400, body: apiError('oauth_state_invalid') },
    ]);
    const { current } = renderRoutes(routes, `/auth/google/callback?state=${STATE}&code=${CODE}`);
    await waitFor(() => expect(current.location?.search).toBe(''));
    expect(document.body.textContent).not.toContain(CODE);
  });

  // Phase D: a conflict is not a failure, so it is a warning that names the cause and offers the route that works.
  it('explains an existing password account and offers only the way back to sign in', async () => {
    mockApi([
      { path: '/meta', body: META },
      { method: 'POST', path: '/auth/google/callback', status: 409, body: apiError('oauth_account_exists') },
    ]);
    const { current } = renderRoutes(routes, `/auth/google/callback?state=${STATE}&code=${CODE}`);

    // The waiting row is also role="status", so wait for the outcome itself rather than for the first status.
    const title = await screen.findByText('This email already has a password account');
    expect(title.closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getByText(/already exists for this address, created with a password/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Google again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in with email' })).toHaveAttribute('href', '/login');
    expect(current.location?.pathname).toBe('/auth/google/callback');
    expect(useSessionStore.getState().accessToken).toBeNull();
  });

  it('offers another try when the sign-in expired', async () => {
    mockApi([
      { path: '/meta', body: META },
      { method: 'POST', path: '/auth/google/callback', status: 400, body: apiError('oauth_state_invalid') },
    ]);
    renderRoutes(routes, `/auth/google/callback?state=${STATE}&code=${CODE}`);
    expect(await screen.findByText('This Google sign-in has expired. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Google again' })).toBeInTheDocument();
  });

  it('does not call the backend for a callback without code and state', async () => {
    const { calls } = mockApi([{ path: '/meta', body: META }]);
    renderRoutes(routes, '/auth/google/callback');
    expect(await screen.findByText("Google sign-in didn't complete. Please try again.")).toBeInTheDocument();
    expect(googleCalls(calls)).toHaveLength(0);
  });

  it('signs in with Google again after signing out (same account, new session)', async () => {
    document.cookie = 'csrf_token=csrf-1; path=/';
    const { calls } = mockApi([
      { path: '/meta', body: META },
      { path: '/me', body: USER },
      { method: 'POST', path: '/auth/google/callback', body: { access_token: 'google-access', expires_in: 900, user: USER } },
      { method: 'POST', path: '/auth/logout', status: 204 },
    ]);
    const first = renderRoutes(routes, `/auth/google/callback?state=${STATE}&code=${CODE}`);
    await waitFor(() => expect(first.current.location?.pathname).toBe('/welcome'));

    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }));
    await waitFor(() => expect(first.current.location?.pathname).toBe('/login'));
    expect(useSessionStore.getState().accessToken).toBeNull();
    first.unmount();

    const second = renderRoutes(routes, `/auth/google/callback?state=${STATE}&code=${CODE}-2`);
    await waitFor(() => expect(second.current.location?.pathname).toBe('/welcome'));
    expect(useSessionStore.getState().accessToken).toBe('google-access');
    expect(googleCalls(calls).map((call) => (call.body as { code: string }).code)).toEqual([CODE, `${CODE}-2`]);
    expect(calls.filter((call) => call.path === '/api/v1/auth/logout')).toHaveLength(1);
  });
});
