import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';

const META_DISABLED = {
  version: '0.1.0',
  languages: ['tg', 'ru', 'en'],
  default_language: 'tg',
  currency: 'TJS',
  auth: { password_login: false, registration: false, password_reset: false, email_verification: false, google: false },
};

const META_EMAIL = { ...META_DISABLED, auth: { ...META_DISABLED.auth, registration: true, email_verification: true } };
const REDIRECT_TIMEOUT = { timeout: 4000 };

function apiError(code: string, details: Record<string, unknown> = {}) {
  return { error: { code, message: code, details, request_id: 'r' } };
}

/** Step 1 asks for the account and nothing else: no role, no organization name (Phase D). */
async function fillRegistration(email = '  Nigina@Example.TJ ') {
  await userEvent.type(screen.getByLabelText(/full name/i), 'Nigina Karimova');
  await userEvent.type(screen.getByLabelText(/^email/i), email);
  await userEvent.type(screen.getByLabelText(/create a password/i), 'Dushanbe2026x');
  await userEvent.click(screen.getByRole('checkbox'));
}

function nonMetaCalls<T extends { path: string }>(calls: T[]) {
  return calls.filter((call) => call.path !== '/api/v1/meta' && call.path !== '/api/v1/me/invitations');
}

// The notice replaces the animated "checking" row once /meta has answered.
const NOTICE_TIMEOUT = { timeout: 3000 };

describe('auth screens (CR-001: email)', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null }));

  describe('login', () => {
    it('signs in with email and links to registration and forgot-password', () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/login');
      expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
      // The large mode buttons reflect the active route; existing form links still work.
      expect(screen.getByRole('button', { name: 'Log in' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Sign up' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
      expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register');
      expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
      // One support link is shown per viewport (the aside on desktop, the page footer on phones).
      expect(screen.getAllByRole('link', { name: /support/i })[0]).toHaveAttribute('href', 'https://t.me/tezfarmo_support');
    });

    it('states the lockout rule only once an attempt has actually been refused', async () => {
      mockApi([
        { path: '/meta', body: { ...META_DISABLED, auth: { ...META_DISABLED.auth, password_login: true } } },
        { method: 'POST', path: '/auth/login', status: 429, body: apiError('rate_limited', { retry_after: 90 }) },
      ]);
      renderRoutes(routes, '/login');
      expect(screen.queryByText(/brute-force protection/i)).not.toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Email'), 'nigina@example.tj');
      await userEvent.type(screen.getByLabelText('Password'), 'Dushanbe2026x');
      await userEvent.click(await screen.findByRole('button', { name: 'Login now' }));
      expect(await screen.findByText(/brute-force protection/i)).toBeInTheDocument();
    });

    it('explains that sign-in is not enabled and sends no credentials', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/login');
      expect(await screen.findByText("Sign-in isn't enabled yet", {}, NOTICE_TIMEOUT)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Login now' })).toBeDisabled();
      expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled();
      expect(nonMetaCalls(calls)).toHaveLength(0);
    });

    it('shows a loading state while sign-in options are checked', () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/login');
      expect(screen.getByText('Checking sign-in options…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Login now' })).toHaveAttribute('aria-busy', 'true');
    });

    it('validates the email format', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/login');
      const email = screen.getByLabelText('Email');
      await userEvent.type(email, 'not-an-email');
      await userEvent.tab();
      expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
      expect(email).toHaveAttribute('aria-invalid', 'true');
    });

    it('tells the user why their session ended', () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      useSessionStore.setState({ endedReason: 'token_expired' });
      renderRoutes(routes, '/login');
      expect(screen.getByText('You were signed out')).toBeInTheDocument();
      expect(screen.getByText('Your session has expired. Please sign in again.')).toBeInTheDocument();
    });

    it('shows a retryable error when sign-in options cannot be loaded', async () => {
      mockApi([
        { path: '/meta', status: 503, body: { error: { code: 'service_unavailable', message: '', details: {}, request_id: 'r' } } },
      ]);
      renderRoutes(routes, '/login');
      // One automatic retry for 5xx happens first (query-client.ts), so allow for its back-off.
      expect(await screen.findByText("Couldn't load sign-in options", {}, { timeout: 4000 })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });

  describe('registration', () => {
    it('asks only for the account: name, email, password, terms', () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toBeInTheDocument();
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^email/i)).toHaveAttribute('type', 'email');
      expect(screen.getByLabelText(/create a password/i)).toBeInTheDocument();
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
      // The business questions moved to steps 3 and 4, after the address is confirmed.
      expect(screen.queryByRole('radio', { name: /company|store/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/store name|company name/i)).not.toBeInTheDocument();
      expect(screen.getAllByRole('textbox')).toHaveLength(2);
      expect(screen.queryByLabelText(/mobile|phone|repeat the password|preferred language/i)).not.toBeInTheDocument();
    });

    it('switches from registration to login with the large mode buttons', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      expect(screen.getByRole('button', { name: 'Sign up' })).toHaveAttribute('aria-pressed', 'true');
      const login = screen.getByRole('button', { name: 'Log in' });
      expect(login).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(login);
      expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' }, { timeout: 2500 })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Log in' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('validates fields as the user leaves them', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      await userEvent.click(screen.getByLabelText(/full name/i));
      await userEvent.tab();
      expect(await screen.findByText('Enter at least 2 characters.')).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText(/^email/i), 'nope');
      await userEvent.tab();
      // The email hint animates out before its error animates in.
      expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    });

    it('shows password strength only once typing starts', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      expect(screen.queryByText('Password strength')).not.toBeInTheDocument();
      await userEvent.type(screen.getByLabelText(/create a password/i), 'short');
      expect(screen.getByText('Very weak')).toBeInTheDocument();
    });

    it('explains registration is not open and sends nothing', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      expect(await screen.findByText("Registration isn't open yet", {}, NOTICE_TIMEOUT)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
      expect(nonMetaCalls(calls)).toHaveLength(0);
    });
  });

  describe('forgot and reset password', () => {
    it('requests a reset code by email and explains it is not enabled yet', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/forgot-password');
      expect(screen.getByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument();
      expect(screen.getByText(/if an account exists for it/i)).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText(/^email/i), 'wrong');
      await userEvent.tab();
      expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
      expect(await screen.findByText("Password reset isn't enabled yet", {}, NOTICE_TIMEOUT)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send code' })).toBeDisabled();
      expect(nonMetaCalls(calls)).toHaveLength(0);
    });

    it('sends the old /reset path to /forgot-password', () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      const { current } = renderRoutes(routes, '/reset');
      expect(current.location?.pathname).toBe('/forgot-password');
    });

    it('sends an old /reset-password link (with or without a token) to /forgot-password', () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      const { current } = renderRoutes(routes, `/reset-password?token=${'a'.repeat(43)}`);
      expect(current.location?.pathname).toBe('/forgot-password');
      expect(current.location?.search).toBe('');
    });
  });

  describe('verify email', () => {
    // `/verify-email` is the pre-Phase-D address of step 2 and still renders it, for links already sent out.
    it('asks for the 6-digit code when opened without state', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/verify-email');
      expect(screen.getByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
      expect(screen.getByText(/we sent a 6-digit code to your email/i)).toBeInTheDocument();
      expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
      expect(await screen.findByText("Email verification isn't enabled yet", {}, NOTICE_TIMEOUT)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Verify email' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Send a new code' })).toBeDisabled();
    });

    it('ignores an old ?token= link and sends nothing on its own', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_EMAIL }]);
      renderRoutes(routes, `/verify-email?token=${'b'.repeat(43)}`);
      expect(await screen.findByRole('button', { name: 'Verify email' })).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(nonMetaCalls(calls)).toHaveLength(0);
      expect(document.body.textContent).not.toContain('b'.repeat(43));
    });
  });

  it('Google callback reports a cancelled sign-in without touching the code', async () => {
    const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
    renderRoutes(routes, '/auth/google/callback?error=access_denied');
    const alert = await screen.findByRole('status');
    expect(within(alert).getByText('Google sign-in was cancelled')).toBeInTheDocument();
    expect(nonMetaCalls(calls)).toHaveLength(0);
  });

  describe('email registration flow (IAM-001, IAM-002, P01 §6)', () => {
    it('submits a four-digit password while displaying advisory strength', async () => {
      const { calls } = mockApi([
        { path: '/meta', body: META_EMAIL },
        { method: 'POST', path: '/auth/register', status: 202 },
      ]);
      const { current } = renderRoutes(routes, '/register');
      await fillRegistration();
      const password = screen.getByLabelText(/create a password/i);
      await userEvent.clear(password);
      await userEvent.type(password, '1234');
      expect(screen.getByText('Very weak')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
      await waitFor(() => expect(current.location?.pathname).toBe('/register/verify'));
      expect(nonMetaCalls(calls)[0]!.body).toMatchObject({ password: '1234' });
    });

    it('registers with the IAM-001 fields only and continues to step 2', async () => {
      const { calls } = mockApi([
        { path: '/meta', body: META_EMAIL },
        { method: 'POST', path: '/auth/register', status: 202 },
      ]);
      const { current } = renderRoutes(routes, '/register');
      await fillRegistration();
      await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));

      await waitFor(() => expect(current.location?.pathname).toBe('/register/verify'));
      const [register] = nonMetaCalls(calls);
      expect(register).toMatchObject({ method: 'POST', path: '/api/v1/auth/register' });
      // Phase D: no org_type / org_name. Both are optional on RegisterRequest, and the Company/Store question
      // is step 3, where the answer creates the organization instead of being parked on the user record.
      expect(register!.body).toEqual({
        email: 'nigina@example.tj',
        password: 'Dushanbe2026x',
        full_name: 'Nigina Karimova',
        language: 'en',
      });
      // The destination is named, with the local part masked.
      expect(await screen.findByText(/we sent a 6-digit code to n••••a@example\.tj/i)).toBeInTheDocument();
      expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
      expect(screen.queryByText(/nigina@example\.tj/)).not.toBeInTheDocument();
      // Registration has just sent an email: the 60 s resend cooldown is already running.
      expect(screen.getByRole('button', { name: /send a new code in (59|60) s/i })).toBeDisabled();
      expect(screen.getByLabelText('Verification code')).toHaveValue('');
    });

    it('verifies the handed-over address without asking for it again, then signs in and continues to onboarding', async () => {
      const { calls } = mockApi([
        { path: '/meta', body: META_EMAIL },
        { method: 'POST', path: '/auth/register', status: 202 },
        { method: 'POST', path: '/auth/email/verify', body: { access_token: 'verified-access', expires_in: 900, user: meFixture([]) } },
      ]);
      const { current } = renderRoutes(routes, '/register');
      await fillRegistration();
      await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));
      await waitFor(() => expect(current.location?.pathname).toBe('/register/verify'));

      // Step 2 asks for the code and nothing else.
      const code = await screen.findByLabelText('Verification code');
      expect(screen.queryByLabelText(/^email/i)).not.toBeInTheDocument();
      await userEvent.type(code, '482913');
      await userEvent.click(screen.getByRole('button', { name: 'Verify email' }));

      await waitFor(() => expect(current.location?.pathname).toBe('/welcome'));
      expect(nonMetaCalls(calls)[1]).toMatchObject({
        path: '/api/v1/auth/email/verify',
        body: { email: 'nigina@example.tj', code: '482913' },
      });
      expect(useSessionStore.getState().accessToken).toBe('verified-access');
      expect(nonMetaCalls(calls).some((call) => call.path.endsWith('/auth/login'))).toBe(false);
    });

    it('sends one registration at a time', async () => {
      let release: () => void = () => undefined;
      const { calls, fetchMock } = mockApi([{ path: '/meta', body: META_EMAIL }]);
      const answer = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input).endsWith('/auth/register')) return answer(input, init);
        calls.push({ method: 'POST', path: '/api/v1/auth/register', headers: {}, body: undefined });
        await new Promise<void>((resolve) => (release = resolve));
        return new Response(null, { status: 202 });
      });
      renderRoutes(routes, '/register');
      await fillRegistration();
      const submit = await screen.findByRole('button', { name: 'Create account' });
      await userEvent.click(submit);
      await waitFor(() => expect(submit).toHaveAttribute('aria-busy', 'true'));
      await userEvent.click(submit);
      expect(nonMetaCalls(calls)).toHaveLength(1);
      release();
    });

    it('shows weak_password on the password field and stays on /register', async () => {
      mockApi([
        { path: '/meta', body: META_EMAIL },
        {
          method: 'POST',
          path: '/auth/register',
          status: 422,
          body: apiError('weak_password', { fields: [{ field: 'password', code: 'password_too_common' }] }),
        },
      ]);
      const { current } = renderRoutes(routes, '/register');
      await fillRegistration();
      await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));

      expect(await screen.findByText('This password is too common. Choose another one.')).toBeInTheDocument();
      expect(current.location?.pathname).toBe('/register');
    });

    it('explains a rate limit without leaving the form', async () => {
      mockApi([
        { path: '/meta', body: META_EMAIL },
        { method: 'POST', path: '/auth/register', status: 429, body: apiError('rate_limited', { retry_after: 120 }) },
      ]);
      const { current } = renderRoutes(routes, '/register');
      await fillRegistration();
      await userEvent.click(await screen.findByRole('button', { name: 'Create account' }));

      const alert = await screen.findByRole('alert');
      expect(within(alert).getByText("Couldn't create the account")).toBeInTheDocument();
      expect(within(alert).getByText('Too many attempts. Please wait and try again.')).toBeInTheDocument();
      expect(current.location?.pathname).toBe('/register');
    });

    it('verifies with the 6-digit code, never needing a link, and starts a session for onboarding', async () => {
      const { calls } = mockApi([
        { path: '/meta', body: META_EMAIL },
        { method: 'POST', path: '/auth/email/verify', body: { access_token: 'verified-access', expires_in: 900, user: meFixture([]) } },
      ]);
      const { current } = renderRoutes(routes, '/register/verify');
      await userEvent.type(screen.getByLabelText(/^email/i), ' Nigina@Example.TJ');
      await userEvent.type(screen.getByLabelText('Verification code'), '482913');
      await userEvent.click(await screen.findByRole('button', { name: 'Verify email' }));

      await waitFor(() => expect(current.location?.pathname).toBe('/welcome'), REDIRECT_TIMEOUT);
      expect(useSessionStore.getState().accessToken).toBe('verified-access');
      expect(nonMetaCalls(calls)).toEqual([
        expect.objectContaining({
          method: 'POST',
          path: '/api/v1/auth/email/verify',
          body: { email: 'nigina@example.tj', code: '482913' },
        }),
      ]);
    });

    it('accepts digits only, at most six, even when pasted with other characters', async () => {
      mockApi([{ path: '/meta', body: META_EMAIL }]);
      renderRoutes(routes, '/verify-email');
      const input = screen.getByLabelText('Verification code');
      expect(input).toHaveAttribute('inputmode', 'numeric');
      expect(input).toHaveAttribute('autocomplete', 'one-time-code');

      await userEvent.type(input, 'ab12 3-4c5678');

      expect(input).toHaveValue('123456');
    });

    it.each([
      ['', 'Enter the 6-digit code.'],
      ['12345', 'Enter the 6-digit code.'],
    ])('rejects the code %j on the client without sending', async (code, text) => {
      const { calls } = mockApi([{ path: '/meta', body: META_EMAIL }]);
      renderRoutes(routes, '/verify-email');
      await userEvent.type(screen.getByLabelText(/^email/i), 'nigina@example.tj');
      if (code) await userEvent.type(screen.getByLabelText('Verification code'), code);
      await userEvent.click(await screen.findByRole('button', { name: 'Verify email' }));

      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(nonMetaCalls(calls)).toHaveLength(0);
    });

    it.each([
      ['email_token_invalid', "That code isn't right or was already used. Check the email or send a new code."],
      ['email_token_expired', 'This code has expired. Send a new code.'],
    ])('keeps a %s code on /verify-email with a way to get a new one', async (code, text) => {
      mockApi([
        { path: '/meta', body: META_EMAIL },
        { method: 'POST', path: '/auth/email/verify', status: 422, body: apiError(code) },
      ]);
      const { current } = renderRoutes(routes, '/verify-email');
      await userEvent.type(screen.getByLabelText(/^email/i), 'nigina@example.tj');
      await userEvent.type(screen.getByLabelText('Verification code'), '000111');
      await userEvent.click(await screen.findByRole('button', { name: 'Verify email' }));

      expect(await screen.findByText("Couldn't confirm your email")).toBeInTheDocument();
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
      expect(current.location?.pathname).toBe('/verify-email');
    });

    it('waits out too many wrong codes using Retry-After', async () => {
      mockApi([
        { path: '/meta', body: META_EMAIL },
        { method: 'POST', path: '/auth/email/verify', status: 429, body: apiError('rate_limited', { retry_after: 600 }) },
      ]);
      renderRoutes(routes, '/verify-email');
      await userEvent.type(screen.getByLabelText(/^email/i), 'nigina@example.tj');
      await userEvent.type(screen.getByLabelText('Verification code'), '000111');
      await userEvent.click(await screen.findByRole('button', { name: 'Verify email' }));

      expect(await screen.findByText('Too many attempts. Please wait and try again.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again in (599|600) s/i })).toBeDisabled();
    });

    it('sends a new code with a neutral answer and a cooldown, staying on the page', async () => {
      const { calls } = mockApi([
        { path: '/meta', body: META_EMAIL },
        { method: 'POST', path: '/auth/email/resend', status: 202 },
      ]);
      const { current } = renderRoutes(routes, '/verify-email');
      await userEvent.type(screen.getByLabelText(/^email/i), ' Dilshod@Pamir.TJ');
      await userEvent.click(await screen.findByRole('button', { name: 'Send a new code' }));

      expect(await screen.findByText('If this address is waiting for confirmation, a new code is on its way.')).toBeInTheDocument();
      expect(nonMetaCalls(calls)).toEqual([
        expect.objectContaining({ path: '/api/v1/auth/email/resend', body: { email: 'dilshod@pamir.tj' } }),
      ]);
      expect(screen.getByRole('button', { name: /send a new code in (59|60) s/i })).toBeDisabled();
      expect(current.location?.pathname).toBe('/verify-email');
    });

    it('counts down from Retry-After when a new code is refused', async () => {
      mockApi([
        { path: '/meta', body: META_EMAIL },
        { method: 'POST', path: '/auth/email/resend', status: 429, body: apiError('email_resend_too_early', { retry_after: 42 }) },
      ]);
      renderRoutes(routes, '/verify-email');
      await userEvent.type(screen.getByLabelText(/^email/i), 'dilshod@pamir.tj');
      await userEvent.click(await screen.findByRole('button', { name: 'Send a new code' }));

      expect(await screen.findByText('Please wait a moment before requesting another email.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send a new code in (41|42) s/i })).toBeDisabled();
    });

    it('validates the address before sending a new code', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_EMAIL }]);
      renderRoutes(routes, '/verify-email');
      await userEvent.type(screen.getByLabelText(/^email/i), 'nope');
      await userEvent.click(await screen.findByRole('button', { name: 'Send a new code' }));

      expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
      expect(nonMetaCalls(calls)).toHaveLength(0);
    });
  });

  describe('email/password login (F-1.2, IAM-004, SEC-004)', () => {
    const META_LOGIN = { ...META_EMAIL, auth: { ...META_EMAIL.auth, password_login: true } };
    const newUser = () => meFixture([], { email: 'nigina@example.tj', full_name: 'Nigina Karimova' });

    async function submitLogin(email = '  Nigina@Example.TJ ', password = 'Dushanbe2026x') {
      await userEvent.type(screen.getByLabelText('Email'), email);
      await userEvent.type(screen.getByLabelText('Password'), password);
      await userEvent.click(await screen.findByRole('button', { name: 'Login now' }));
    }

    it('signs in, keeps the access token in memory, caches the user and leaves /login', async () => {
      const { calls } = mockApi([
        { path: '/meta', body: META_LOGIN },
        { method: 'POST', path: '/auth/login', body: { access_token: 'access-1', expires_in: 900, user: newUser() } },
      ]);
      const { current } = renderRoutes(routes, '/login');
      await submitLogin();

      // A user without an organization lands on onboarding (homePath).
      await waitFor(() => expect(current.location?.pathname).toBe('/welcome'));
      expect(nonMetaCalls(calls)).toEqual([
        expect.objectContaining({
          method: 'POST',
          path: '/api/v1/auth/login',
          body: { email: 'nigina@example.tj', password: 'Dushanbe2026x' },
        }),
      ]);
      // The login answer already is the /me object: no second request, and no stale bearer on the login call.
      expect(calls.find((call) => call.path === '/api/v1/auth/login')!.headers.Authorization).toBeUndefined();
      expect(useSessionStore.getState()).toMatchObject({ accessToken: 'access-1', endedReason: null });
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(JSON.stringify({ ...localStorage })).not.toContain('access-1');
    });

    it('goes back to the page that required sign-in (?next=)', async () => {
      mockApi([
        { path: '/meta', body: META_LOGIN },
        { method: 'POST', path: '/auth/login', body: { access_token: 'access-1', expires_in: 900, user: newUser() } },
      ]);
      const { current } = renderRoutes(routes, `/login?next=${encodeURIComponent('/profile')}`);
      await submitLogin();
      await waitFor(() => expect(current.location?.pathname).toBe('/profile'));
    });

    it('ignores a ?next= that leaves the app', async () => {
      mockApi([
        { path: '/meta', body: META_LOGIN },
        { method: 'POST', path: '/auth/login', body: { access_token: 'access-1', expires_in: 900, user: newUser() } },
      ]);
      const { current } = renderRoutes(routes, `/login?next=${encodeURIComponent('//evil.example/x')}`);
      await submitLogin();
      await waitFor(() => expect(current.location?.pathname).toBe('/welcome'));
    });

    it('answers invalid_credentials neutrally, without ending a session or leaving /login', async () => {
      mockApi([
        { path: '/meta', body: META_LOGIN },
        { method: 'POST', path: '/auth/login', status: 401, body: apiError('invalid_credentials') },
      ]);
      const { current } = renderRoutes(routes, '/login');
      await submitLogin();

      const alert = await screen.findByRole('alert');
      expect(within(alert).getByText("Couldn't sign in")).toBeInTheDocument();
      expect(within(alert).getByText('Email or password is incorrect.')).toBeInTheDocument();
      expect(screen.queryByText('You were signed out')).not.toBeInTheDocument();
      expect(useSessionStore.getState()).toMatchObject({ accessToken: null, endedReason: null });
      expect(current.location?.pathname).toBe('/login');
    });

    it('explains email_not_verified and leads back to confirmation with the address', async () => {
      mockApi([
        { path: '/meta', body: META_LOGIN },
        { method: 'POST', path: '/auth/login', status: 403, body: apiError('email_not_verified') },
      ]);
      const { current } = renderRoutes(routes, '/login');
      await submitLogin();

      expect(await screen.findByText('Confirm your email first')).toBeInTheDocument();
      expect(screen.getByText('Confirm your email before signing in.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('link', { name: 'Enter your code or get a new one' }));
      await waitFor(() => expect(current.location?.pathname).toBe('/register/verify'));
      // Step 2 opens knowing the address, so it asks for the code only and can resend straight away.
      expect(await screen.findByText(/n••••a@example\.tj/, {}, REDIRECT_TIMEOUT)).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Send a new code' })).toBeEnabled();
    });

    it('shows the blocked-account message', async () => {
      mockApi([
        { path: '/meta', body: META_LOGIN },
        { method: 'POST', path: '/auth/login', status: 403, body: apiError('user_blocked') },
      ]);
      renderRoutes(routes, '/login');
      await submitLogin();
      expect(await screen.findByText('This account is blocked. Contact TezFarmo support.')).toBeInTheDocument();
      expect(useSessionStore.getState().accessToken).toBeNull();
    });

    it('puts server validation errors on their fields', async () => {
      mockApi([
        { path: '/meta', body: META_LOGIN },
        {
          method: 'POST',
          path: '/auth/login',
          status: 422,
          body: apiError('validation_error', { fields: [{ field: 'email', code: 'value_error', message: 'Server says: bad email' }] }),
        },
      ]);
      renderRoutes(routes, '/login');
      await submitLogin();
      expect(await screen.findByText('Server says: bad email')).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByRole('alert', { name: /couldn't sign in/i })).not.toBeInTheDocument();
    });

    it('validates on the client before sending anything', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_LOGIN }]);
      renderRoutes(routes, '/login');
      await userEvent.click(await screen.findByRole('button', { name: 'Login now' }));
      expect(await screen.findAllByText('This field is required.')).toHaveLength(2);
      expect(nonMetaCalls(calls)).toHaveLength(0);
    });

    it('waits out a rate limit using Retry-After', async () => {
      mockApi([
        { path: '/meta', body: META_LOGIN },
        { method: 'POST', path: '/auth/login', status: 429, body: apiError('rate_limited', { retry_after: 90 }) },
      ]);
      renderRoutes(routes, '/login');
      await submitLogin();
      expect(await screen.findByText('Too many attempts. Please wait and try again.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again in (89|90) s/i })).toBeDisabled();
    });

    it('shows a general error when the server cannot be reached', async () => {
      const { fetchMock } = mockApi([{ path: '/meta', body: META_LOGIN }]);
      const answer = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/auth/login')) throw new TypeError('Failed to fetch');
        return answer(input, init);
      });
      renderRoutes(routes, '/login');
      await submitLogin();
      expect(await screen.findByText(/check your connection/i)).toBeInTheDocument();
      expect(screen.queryByText(/failed to fetch/i)).not.toBeInTheDocument();
    });

    it('sends one login at a time', async () => {
      let release: () => void = () => undefined;
      const { calls, fetchMock } = mockApi([{ path: '/meta', body: META_LOGIN }]);
      const answer = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input).endsWith('/auth/login')) return answer(input, init);
        calls.push({ method: 'POST', path: '/api/v1/auth/login', headers: {}, body: undefined });
        await new Promise<void>((resolve) => (release = resolve));
        return new Response(JSON.stringify(apiError('invalid_credentials')), { status: 401 });
      });
      renderRoutes(routes, '/login');
      await submitLogin();
      const submit = screen.getByRole('button', { name: 'Login now' });
      await waitFor(() => expect(submit).toHaveAttribute('aria-busy', 'true'));
      await userEvent.click(submit);
      expect(nonMetaCalls(calls)).toHaveLength(1);
      release();
    });

    it('sends a signed-in user away from /login and /register', async () => {
      mockApi([
        { path: '/meta', body: META_LOGIN },
        { path: '/me', body: newUser() },
      ]);
      useSessionStore.setState({ accessToken: 'access-1' });
      const { current } = renderRoutes(routes, '/login');
      await waitFor(() => expect(current.location?.pathname).toBe('/welcome'));
    });

    it('sends a guest from a protected page to /login and remembers it', async () => {
      mockApi([{ path: '/meta', body: META_LOGIN }]);
      const { current } = renderRoutes(routes, '/profile');
      await waitFor(() => expect(current.location?.pathname).toBe('/login'));
      expect(current.location?.search).toBe(`?next=${encodeURIComponent('/profile')}`);
    });
  });
});
