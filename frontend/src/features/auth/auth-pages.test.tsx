import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { mockApi, renderRoutes } from '@/test/render';

const META_DISABLED = {
  version: '0.1.0',
  languages: ['tg', 'ru', 'en'],
  default_language: 'tg',
  currency: 'TJS',
  auth: { password_login: false, registration: false, password_reset: false, email_verification: false, google: false },
};

function nonMetaCalls(calls: { path: string }[]) {
  return calls.filter((call) => call.path !== '/api/v1/meta');
}

// The notice replaces the animated "checking" row once /meta has answered.
const NOTICE_TIMEOUT = { timeout: 3000 };
const continueButton = () => screen.getByRole('button', { name: /^continue$/i });

describe('auth screens (CR-001: email)', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null }));

  describe('login', () => {
    it('signs in with email and links to registration and forgot-password', () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/login');
      expect(screen.getByRole('heading', { name: 'Login to your account' })).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
      expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register');
      expect(screen.getByRole('link', { name: 'Forgot?' })).toHaveAttribute('href', '/forgot-password');
      expect(screen.getByRole('link', { name: /support/i })).toHaveAttribute('href', 'https://t.me/tezfarmo_support');
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
      mockApi([{ path: '/meta', status: 503, body: { error: { code: 'service_unavailable', message: '', details: {}, request_id: 'r' } } }]);
      renderRoutes(routes, '/login');
      // One automatic retry for 5xx happens first (query-client.ts), so allow for its back-off.
      expect(await screen.findByText("Couldn't load sign-in options", {}, { timeout: 4000 })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });

  describe('registration', () => {
    async function fillAccount({ confirm = 'Dushanbe2026', terms = true } = {}) {
      await userEvent.type(screen.getByLabelText(/full name/i), 'Nigina Karimova');
      await userEvent.type(screen.getByLabelText(/^email/i), '  Nigina@Example.TJ ');
      await userEvent.type(screen.getByLabelText(/create a password/i), 'Dushanbe2026');
      await userEvent.type(screen.getByLabelText(/repeat the password/i), confirm);
      if (terms) await userEvent.click(screen.getByRole('checkbox', { name: /terms of use/i }));
      await userEvent.click(continueButton());
    }

    it('asks for email and password only, with no phone or SMS code', () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      expect(screen.getByText('Step 1 of 3: Account')).toBeInTheDocument();
      expect(screen.getByLabelText(/^email/i)).toHaveAttribute('type', 'email');
      expect(screen.queryByLabelText(/mobile|phone/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: /sms/i })).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /^store/i })).toBeChecked();
    });

    it('validates each field before moving on', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      await userEvent.click(continueButton());
      expect((await screen.findAllByText('Enter at least 2 characters.')).length).toBeGreaterThan(0);
      // The email hint animates out before its error animates in.
      expect(await screen.findByText('This field is required.')).toBeInTheDocument();
      expect(screen.getByText('Accept the terms to continue.')).toBeInTheDocument();
    });

    it('shows password strength and rejects mismatched passwords', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      await userEvent.type(screen.getByLabelText(/create a password/i), 'short');
      expect(screen.getByText('Very weak')).toBeInTheDocument();
      await userEvent.clear(screen.getByLabelText(/create a password/i));
      await fillAccount({ confirm: 'Different2026' });
      expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    });

    it('keeps answers across steps and reviews them without creating anything', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      await fillAccount();
      // Steps animate: the next step mounts after the previous one has left.
      await userEvent.type(await screen.findByLabelText(/store name/i), 'Corner Market');
      await userEvent.click(screen.getByRole('button', { name: /back/i }));
      expect(await screen.findByLabelText(/full name/i)).toHaveValue('Nigina Karimova');
      await userEvent.click(continueButton());
      await screen.findByLabelText(/store name/i);
      await userEvent.click(continueButton());

      expect(await screen.findByText('Corner Market · Store')).toBeInTheDocument();
      expect(screen.getByText('nigina@example.tj')).toBeInTheDocument();
      expect(screen.getByText(/confirmation link to nigina@example.tj/i)).toBeInTheDocument();
      expect(await screen.findByText("Registration isn't open yet", {}, NOTICE_TIMEOUT)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
      expect(nonMetaCalls(calls)).toHaveLength(0);
    });
  });

  describe('forgot and reset password', () => {
    it('requests a reset link by email and explains it is not enabled yet', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/forgot-password');
      expect(screen.getByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument();
      expect(screen.getByText(/if an account exists for it/i)).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText(/^email/i), 'wrong');
      await userEvent.tab();
      expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
      expect(await screen.findByText("Password reset isn't enabled yet", {}, NOTICE_TIMEOUT)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send reset link' })).toBeDisabled();
      expect(nonMetaCalls(calls)).toHaveLength(0);
    });

    it('sends the old /reset path to /forgot-password', () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      const { current } = renderRoutes(routes, '/reset');
      expect(current.location?.pathname).toBe('/forgot-password');
    });

    it('treats a reset link without a token as invalid', () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/reset-password');
      expect(screen.getByText("This reset link isn't valid")).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
    });

    it('takes the token out of the address bar and validates the new password', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      const { current } = renderRoutes(routes, `/reset-password?token=${'a'.repeat(43)}`);
      expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
      await waitFor(() => expect(current.location?.search).toBe(''));
      await userEvent.type(screen.getByLabelText(/create a password/i), 'Dushanbe2026');
      await userEvent.type(screen.getByLabelText(/repeat the password/i), 'Other2026x');
      await userEvent.tab();
      expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save new password' })).toBeDisabled();
    });
  });

  describe('verify email', () => {
    it('explains the inbox step when opened without a link', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/verify-email');
      expect(screen.getByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
      expect(screen.getByText(/we sent a confirmation link/i)).toBeInTheDocument();
      expect(await screen.findByText("Email verification isn't enabled yet", {}, NOTICE_TIMEOUT)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send the link again' })).toBeDisabled();
    });

    it('offers confirmation for a link and removes the token from the URL', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      const { current } = renderRoutes(routes, `/verify-email?token=${'b'.repeat(43)}`);
      expect(screen.getByRole('button', { name: 'Confirm email' })).toBeDisabled();
      await waitFor(() => expect(current.location?.search).toBe(''));
    });
  });

  it('Google callback reports a cancelled sign-in without touching the code', async () => {
    const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
    renderRoutes(routes, '/auth/google/callback?error=access_denied');
    const alert = await screen.findByRole('status');
    expect(within(alert).getByText('Google sign-in was cancelled')).toBeInTheDocument();
    expect(nonMetaCalls(calls)).toHaveLength(0);
  });
});
