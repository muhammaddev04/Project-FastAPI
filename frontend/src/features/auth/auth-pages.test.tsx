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
      expect(screen.getByRole('heading', { name: 'Sign in to TezFarmo' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register');
      expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/reset');
    });

    it('explains that password sign-in is not enabled and sends no credentials', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/login');
      expect(await screen.findByText("Sign-in isn't enabled yet")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
      expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled();
      expect(nonMetaCalls(calls)).toHaveLength(0);
    });

    it('validates the phone number format', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/login');
      const phone = screen.getByLabelText('Phone number');
      await userEvent.clear(phone);
      await userEvent.type(phone, '12345');
      await userEvent.tab();
      expect(await screen.findByText(/international format/i)).toBeInTheDocument();
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
    async function fillBusiness() {
      await userEvent.click(screen.getByRole('radio', { name: /^store/i }));
      await userEvent.type(screen.getByLabelText('Store name'), 'Corner Market');
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    }

    async function fillDetails() {
      await userEvent.type(await screen.findByLabelText('Full name'), 'Nigina Karimova');
      const phone = screen.getByLabelText('Phone number');
      await userEvent.clear(phone);
      await userEvent.type(phone, '+992 90 123 4567');
      await userEvent.type(screen.getByLabelText(/^email/i), 'nigina@example.tj');
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    }

    it('validates each step before moving on', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(await screen.findByText('Enter at least 2 characters.')).toBeInTheDocument();
      expect(screen.getByText('Business')).toBeInTheDocument();
    });

    it('walks through business, details and password, keeping answers when going back', async () => {
      mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      await fillBusiness();
      await fillDetails();

      const password = await screen.findByLabelText('Create a password');
      await userEvent.type(password, 'short');
      expect(screen.getByText('8+ characters').closest('li')).toHaveClass('text-muted-foreground');
      await userEvent.clear(password);
      await userEvent.type(password, 'Dushanbe2026');
      expect(screen.getByText('8+ characters').closest('li')).toHaveClass('text-success');
      await userEvent.type(screen.getByLabelText('Repeat the password'), 'Different2026');
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /back/i }));
      expect(screen.getByLabelText('Full name')).toHaveValue('Nigina Karimova');
    });

    it('reviews the details and explains verification without creating anything', async () => {
      const { calls } = mockApi([{ path: '/meta', body: META_DISABLED }]);
      renderRoutes(routes, '/register');
      await fillBusiness();
      await fillDetails();
      await userEvent.type(await screen.findByLabelText('Create a password'), 'Dushanbe2026');
      await userEvent.type(screen.getByLabelText('Repeat the password'), 'Dushanbe2026');
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

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
