import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { mockApi, renderRoutes, type MockRoute } from '@/test/render';

const META = {
  version: '0.1.0',
  languages: ['tg', 'ru', 'en'],
  default_language: 'tg',
  currency: 'TJS',
  auth: { password_login: true, registration: true, password_reset: true, email_verification: true, google: false },
};
const AUTHORIZATION = 'rEsEt_' + 'k'.repeat(37);
const START_OK: MockRoute = { method: 'POST', path: '/auth/password/reset/start', status: 202 };
const VERIFY_OK: MockRoute = { method: 'POST', path: '/auth/password/reset/verify', body: { reset_token: AUTHORIZATION, expires_in: 600 } };

function apiError(code: string, details: Record<string, unknown> = {}) {
  return { error: { code, message: code, details, request_id: 'r' } };
}

function authCalls<T extends { path: string }>(calls: T[]) {
  return calls.filter((call) => call.path.startsWith('/api/v1/auth/'));
}

async function requestCode(email = '  Nigina@Example.TJ ') {
  await userEvent.type(screen.getByLabelText(/^email/i), email);
  await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));
  await screen.findByLabelText('Verification code');
}

async function enterCode(code = '482913') {
  await userEvent.type(screen.getByLabelText('Verification code'), code);
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

async function choosePassword(password = 'Khujand2027new', confirm = password) {
  await userEvent.type(await screen.findByLabelText(/create a password/i), password);
  await userEvent.type(screen.getByLabelText(/repeat the password/i), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
}

describe('forgot password with a 6-digit code (IAM-015)', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null, restoring: false }));

  it('email → code → new password, with the exact API contract and no secret in the URL', async () => {
    const { calls } = mockApi([
      { path: '/meta', body: META },
      START_OK,
      VERIFY_OK,
      { method: 'POST', path: '/auth/password/reset/complete', status: 204 },
    ]);
    const { current } = renderRoutes(routes, '/forgot-password');

    await requestCode();
    // Phase D: the destination is named so a typo is visible, but the local part is masked (maskEmail).
    expect(screen.getByText(/if an account exists for n••••a@example\.tj, we've sent a 6-digit code/i)).toBeInTheDocument();
    expect(screen.queryByText(/nigina@example\.tj/)).not.toBeInTheDocument();
    await enterCode();
    await choosePassword();

    expect(await screen.findByText('Password changed')).toBeInTheDocument();
    expect(authCalls(calls)).toEqual([
      expect.objectContaining({ path: '/api/v1/auth/password/reset/start', body: { email: 'nigina@example.tj' } }),
      expect.objectContaining({ path: '/api/v1/auth/password/reset/verify', body: { email: 'nigina@example.tj', code: '482913' } }),
      expect.objectContaining({
        path: '/api/v1/auth/password/reset/complete',
        body: { token: AUTHORIZATION, new_password: 'Khujand2027new' },
      }),
    ]);
    expect(current.location?.pathname).toBe('/forgot-password');
    expect(current.location?.search).toBe('');
    expect(document.body.textContent).not.toContain(AUTHORIZATION);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('code input takes digits only, at most six, with one-time-code hints', async () => {
    mockApi([{ path: '/meta', body: META }, START_OK]);
    renderRoutes(routes, '/forgot-password');
    await requestCode();
    const input = screen.getByLabelText('Verification code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');

    await userEvent.type(input, 'ab12 3-4c5678');

    expect(input).toHaveValue('123456');
  });

  it('rejects a short code on the client without sending it', async () => {
    const { calls } = mockApi([{ path: '/meta', body: META }, START_OK]);
    renderRoutes(routes, '/forgot-password');
    await requestCode();
    await enterCode('12345');

    expect(await screen.findByText('Enter the 6-digit code.')).toBeInTheDocument();
    expect(authCalls(calls).map((call) => call.path)).toEqual(['/api/v1/auth/password/reset/start']);
  });

  it.each([
    ['email_token_invalid', "That code isn't right or was already used. Check the email or send a new code."],
    ['email_token_expired', 'This code has expired. Send a new code.'],
  ])('keeps a %s code on the code step', async (code, text) => {
    mockApi([
      { path: '/meta', body: META },
      START_OK,
      { method: 'POST', path: '/auth/password/reset/verify', status: 422, body: apiError(code) },
    ]);
    renderRoutes(routes, '/forgot-password');
    await requestCode();
    await enterCode();

    expect(await screen.findByText("Couldn't check the code")).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByLabelText(/create a password/i)).not.toBeInTheDocument();
  });

  it('waits out too many wrong codes using Retry-After', async () => {
    mockApi([
      { path: '/meta', body: META },
      START_OK,
      { method: 'POST', path: '/auth/password/reset/verify', status: 429, body: apiError('rate_limited', { retry_after: 900 }) },
    ]);
    renderRoutes(routes, '/forgot-password');
    await requestCode();
    await enterCode();

    expect(await screen.findByText('Too many attempts. Please wait and try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again in (899|900) s/i })).toBeDisabled();
  });

  it('resends the code after the cooldown and keeps the flow on the code step', async () => {
    const { calls } = mockApi([{ path: '/meta', body: META }, START_OK]);
    renderRoutes(routes, '/forgot-password');
    await requestCode('nigina@example.tj');

    // A code was just sent: the resend button starts in its cooldown.
    expect(screen.getByRole('button', { name: /send a new code in (59|60) s/i })).toBeDisabled();
    expect(authCalls(calls)).toHaveLength(1);
  });

  it('can go back and use a different email', async () => {
    mockApi([{ path: '/meta', body: META }, START_OK]);
    renderRoutes(routes, '/forgot-password');
    await requestCode();
    await userEvent.click(screen.getByRole('button', { name: 'Use a different email' }));

    expect(await screen.findByRole('button', { name: 'Send code' })).toBeInTheDocument();
  });

  it('waits out the password_reset limit on the email step using Retry-After', async () => {
    mockApi([
      { path: '/meta', body: META },
      { method: 'POST', path: '/auth/password/reset/start', status: 429, body: apiError('rate_limited', { retry_after: 1200 }) },
    ]);
    renderRoutes(routes, '/forgot-password');
    await userEvent.type(screen.getByLabelText(/^email/i), 'nigina@example.tj');
    await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));

    expect(await screen.findByText('Too many attempts. Please wait and try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again in (1199|1200) s/i })).toBeDisabled();
    expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument();
  });

  it('explains a failed email delivery without details', async () => {
    mockApi([
      { path: '/meta', body: META },
      { method: 'POST', path: '/auth/password/reset/start', status: 503, body: apiError('service_unavailable') },
    ]);
    renderRoutes(routes, '/forgot-password');
    await userEvent.type(screen.getByLabelText(/^email/i), 'nigina@example.tj');
    await userEvent.click(await screen.findByRole('button', { name: 'Send code' }));

    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(within(alert).getByText("Couldn't send the code")).toBeInTheDocument();
  });

  it('shows weak_password on the password field and keeps the step', async () => {
    mockApi([
      { path: '/meta', body: META },
      START_OK,
      VERIFY_OK,
      {
        method: 'POST',
        path: '/auth/password/reset/complete',
        status: 422,
        body: apiError('weak_password', { fields: [{ field: 'new_password', code: 'password_too_common' }] }),
      },
    ]);
    renderRoutes(routes, '/forgot-password');
    await requestCode();
    await enterCode();
    await choosePassword('Password123');

    expect(await screen.findByText('This password is too common. Choose another one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save new password' })).toBeEnabled();
  });

  it('sends the user back for a new code when the authorization has expired', async () => {
    mockApi([
      { path: '/meta', body: META },
      START_OK,
      VERIFY_OK,
      { method: 'POST', path: '/auth/password/reset/complete', status: 422, body: apiError('email_token_expired') },
    ]);
    renderRoutes(routes, '/forgot-password');
    await requestCode();
    await enterCode();
    await choosePassword();

    expect(await screen.findByText(/this reset step has expired or was already used/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save new password' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Request a new code' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send code' })).toBeInTheDocument());
  });

  it('checks the repeat before sending the new password', async () => {
    const { calls } = mockApi([{ path: '/meta', body: META }, START_OK, VERIFY_OK]);
    renderRoutes(routes, '/forgot-password');
    await requestCode();
    await enterCode();
    await choosePassword('Khujand2027new', 'Different2027x');

    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    expect(authCalls(calls).map((call) => call.path)).not.toContain('/api/v1/auth/password/reset/complete');
  });
});
