import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes, type MockRoute } from '@/test/render';

const META = {
  version: '0.1.0',
  languages: ['tg', 'ru', 'en'],
  default_language: 'tg',
  currency: 'TJS',
  auth: { password_login: true, registration: true, password_reset: true, email_verification: true, google: true },
};
const ME = meFixture([membershipFixture(), storeMembership({ role: 'SELLER', verification_status: 'PENDING' })], {
  last_login_at: '2026-09-26T08:00:00Z',
});

function apiError(code: string, details: Record<string, unknown> = {}) {
  return { error: { code, message: code, details, request_id: 'r' } };
}

function openProfile(extra: MockRoute[] = []) {
  useSessionStore.setState({ accessToken: 'access-1', activeOrgId: null, endedReason: null, restoring: false });
  const api = mockApi([
    { path: '/meta', body: META },
    { path: '/me', body: ME },
    { path: '/auth/google/link', body: { connected: false, status: null, email: null, linked_at: null } },
    ...extra,
  ]);
  return { ...api, ...renderRoutes(routes, '/profile') };
}

async function fillPasswords(current: string, next: string, confirm = next) {
  await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
  await userEvent.type(screen.getByLabelText('Current password'), current);
  await userEvent.type(screen.getByLabelText('Create a password'), next);
  await userEvent.type(screen.getByLabelText('Repeat new password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('user profile (P01 §10 /profile)', () => {
  it('shows the person, their stats and every organization with its role and verification', async () => {
    openProfile();
    expect(await screen.findByRole('heading', { name: 'Dilshod Rahimov', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText('dilshod@pamir.tj').length).toBeGreaterThan(0);
    expect(screen.getByText('Organizations')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'My organizations' })).toBeInTheDocument();
    expect(screen.getByText('Pamir Distribution')).toBeInTheDocument();
    expect(screen.getByText('Corner Market')).toBeInTheDocument();
    expect(screen.getByText('Seller')).toBeInTheDocument();
    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Corner Market' })).toBeInTheDocument();
  });

  it('opens an organization from the list in its own area', async () => {
    const { current } = openProfile([{ path: '/members', body: { count: 1, limit: 1, offset: 0, results: [] } }]);
    await userEvent.click(await screen.findByRole('button', { name: 'Open Corner Market' }));
    await waitFor(() => expect(current.location?.pathname).toBe('/store'));
    expect(useSessionStore.getState().activeOrgId).toBe('org-store');
  });
});

describe('password change (POST /auth/password/change, IAM-008)', () => {
  afterEach(() => {
    document.cookie = 'csrf_token=; Max-Age=0; path=/';
  });

  it('a wrong current password stays on the page as a field error and keeps the session', async () => {
    const { calls } = openProfile([{ method: 'POST', path: '/auth/password/change', status: 401, body: apiError('invalid_credentials') }]);
    await fillPasswords('wrong-one1', 'NewPassword2026');
    expect(await screen.findByText('The current password is incorrect.')).toBeInTheDocument();
    expect(useSessionStore.getState().accessToken).toBe('access-1');
    // No refresh attempt: a wrong password is an answer, not an expired session.
    expect(calls.some((call) => call.path === '/api/v1/auth/refresh')).toBe(false);
  });

  it('maps the server password policy to the new-password field', async () => {
    openProfile([
      {
        method: 'POST',
        path: '/auth/password/change',
        status: 422,
        body: apiError('weak_password', { fields: [{ field: 'new_password', code: 'password_too_common' }] }),
      },
    ]);
    await fillPasswords('Dushanbe2026x', 'Password123');
    expect(await screen.findByText('This password is too common. Choose another one.')).toBeInTheDocument();
  });

  it('checks the repeat locally before calling the server', async () => {
    const { calls } = openProfile();
    await fillPasswords('Dushanbe2026x', 'NewPassword2026', 'NewPassword2027');
    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/api/v1/auth/password/change')).toBe(false);
  });

  it('on success signs out here too and explains why on the login page', async () => {
    document.cookie = 'csrf_token=csrf-1; path=/';
    const { calls, current } = openProfile([
      { method: 'POST', path: '/auth/password/change', status: 204 },
      { method: 'POST', path: '/auth/logout', status: 204 },
    ]);
    await fillPasswords('Dushanbe2026x', 'NewPassword2026');
    await waitFor(() => expect(current.location?.pathname).toBe('/login'));
    expect(calls.find((call) => call.path === '/api/v1/auth/password/change')?.body).toEqual({
      current_password: 'Dushanbe2026x',
      new_password: 'NewPassword2026',
    });
    expect(useSessionStore.getState().accessToken).toBeNull();
    expect(await screen.findByText('Your password was changed. Sign in with the new password.')).toBeInTheDocument();
  });
});
