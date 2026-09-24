import { screen, within } from '@testing-library/react';
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

describe('auth screens', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null }));

  describe('login', () => {
    it('is a dedicated sign-in page with links to registration and password reset', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/login');
      expect(screen.getByRole('heading', { name: 'Login to your account' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register');
      expect(screen.getByRole('link', { name: /support/i })).toHaveAttribute('href', 'https://t.me/tezfarmo_support');
      expect(screen.getByRole('link', { name: 'Forgot?' })).toHaveAttribute('href', '/reset');
    });

    it('explains that password sign-in is not enabled and sends no credentials', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/login');
      expect(await screen.findByText("Sign-in isn't enabled yet")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Login now' })).toBeDisabled();
      expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled();
      expect(nonMetaCalls(calls)).toHaveLength(0);
    });

    it('validates the phone number format', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/login');
      const phone = screen.getByLabelText('Phone number');
      await userEvent.type(phone, '12345');
      await userEvent.tab();
      expect(await screen.findByText(/9-digit number after \+992/i)).toBeInTheDocument();
      expect(phone).toHaveAttribute('aria-invalid', 'true');
    });

    it('tells the user why their session ended', async () => {
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
      await userEvent.type(screen.getByLabelText(/mobile number/i), '90 123 4567');
      await userEvent.type(screen.getByLabelText(/^email/i), 'nigina@example.tj');
      await userEvent.type(screen.getByLabelText(/create a password/i), 'Dushanbe2026');
      await userEvent.type(screen.getByLabelText(/repeat the password/i), confirm);
      if (terms) await userEvent.click(screen.getByRole('checkbox', { name: /terms of use/i }));
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    }

    it('starts on step 1 with the Store/Company choice and validates before moving on', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      expect(screen.getByText('Step 1 of 3: Phone and SMS code')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /^store/i })).toBeChecked();
      expect(screen.getByText('100% free to use')).toBeInTheDocument();
      expect(screen.getByText('14-day trial')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect((await screen.findAllByText('Enter at least 2 characters.')).length).toBeGreaterThan(0);
      expect(screen.getByText('Accept the terms to continue.')).toBeInTheDocument();
      expect(screen.getByText('Step 1 of 3: Phone and SMS code')).toBeInTheDocument();
    });

    it('shows password strength and the disabled SMS code field', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      const password = screen.getByLabelText(/create a password/i);
      await userEvent.type(password, 'short');
      expect(screen.getByText('Very weak')).toBeInTheDocument();
      await userEvent.clear(password);
      await userEvent.type(password, 'Dushanbe2026');
      expect(screen.getByText('At least 8 characters').closest('li')).toHaveClass('text-primary');
      expect(await screen.findByText(/activates once phone verification is enabled/i)).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'SMS confirmation code' })).toBeInTheDocument();
      screen.getAllByLabelText(/SMS confirmation code \d/).forEach((box) => expect(box).toBeDisabled());
    });

    it('rejects mismatched passwords', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      await fillAccount({ confirm: 'Different2026' });
      expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    });

    it('keeps answers across steps and reviews them without creating anything', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      await fillAccount();
      expect(await screen.findByText('Step 2 of 3: Organization')).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText(/store name/i), 'Corner Market');
      await userEvent.click(screen.getByRole('button', { name: /back/i }));
      expect(screen.getByLabelText(/full name/i)).toHaveValue('Nigina Karimova');
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));

      expect(await screen.findByText('Corner Market · Store')).toBeInTheDocument();
      expect(screen.getByText('+992901234567')).toBeInTheDocument();
      expect(screen.getByText(/6-digit code to \+992901234567/)).toBeInTheDocument();
      expect(screen.getByText(/confirm nigina@example.tj/i)).toBeInTheDocument();
      expect(screen.getByText("Registration isn't open yet")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
      expect(nonMetaCalls(calls)).toHaveLength(0);
    });
  });

  it('password reset explains it is not enabled yet', async () => {
    mockApi([{ path: '/meta', body: META_DISABLED }]);
    renderRoutes(routes, '/reset');
    expect(await screen.findByText("Password reset isn't enabled yet")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send code' })).toBeDisabled();
  });

  it('Google callback reports a cancelled sign-in without touching the code', async () => {
    const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
    renderRoutes(routes, '/auth/google/callback?error=access_denied');
    const alert = await screen.findByRole('status');
    expect(within(alert).getByText('Google sign-in was cancelled')).toBeInTheDocument();
    expect(nonMetaCalls(calls)).toHaveLength(0);
  });
});
