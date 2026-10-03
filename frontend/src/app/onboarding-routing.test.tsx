import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Location } from 'react-router-dom';
import { homePath } from '@/shared/auth/context';
import { resetSessionRestoreForTests, restoreSession, useSessionStore } from '@/shared/auth/session-store';
import type { Me } from '@/shared/auth/types';
import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes, type MockRoute } from '@/test/render';
import { routes } from './router';

const META = {
  version: '0.1.0',
  languages: ['tg', 'ru', 'en'],
  default_language: 'tg',
  currency: 'TJS',
  auth: { password_login: true, registration: true, password_reset: true, email_verification: true, google: true },
};
const companyIntent = meFixture([], { onboarding: { org_type: 'COMPANY', org_name: 'Pamir Trade' } });
const storeIntent = meFixture([], { onboarding: { org_type: 'STORE', org_name: 'Corner Market' } });

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

async function passwordLogin(me: Me, extra: MockRoute[] = []) {
  useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null, restoring: false });
  mockApi([
    { path: '/meta', body: META },
    { method: 'POST', path: '/auth/login', body: { access_token: 'access-1', expires_in: 900, user: me } },
    { path: '/me', body: me },
    ...extra,
  ]);
  const page = renderAt('/login');
  await userEvent.type(screen.getByLabelText('Email'), 'nigina@example.tj');
  await userEvent.type(screen.getByLabelText('Password'), 'Dushanbe2026x');
  await userEvent.click(await screen.findByRole('button', { name: 'Login now' }));
  return page;
}

describe('homePath: where a signed-in user lands (server state only)', () => {
  it.each([
    ['intent COMPANY, no organization', companyIntent, '/welcome/company'],
    ['intent STORE, no organization', storeIntent, '/welcome/store'],
    ['no intent, no organization', meFixture([]), '/welcome'],
    [
      'company OWNER not submitted',
      meFixture([membershipFixture({ verification_status: 'NOT_SUBMITTED' })]),
      '/company/settings/verification',
    ],
    ['company OWNER pending', meFixture([membershipFixture({ verification_status: 'PENDING' })]), '/company/settings/verification'],
    ['company OWNER rejected', meFixture([membershipFixture({ verification_status: 'REJECTED' })]), '/company/settings/verification'],
    ['company OWNER approved', meFixture([membershipFixture({ verification_status: 'APPROVED' })]), '/company'],
    ['company MANAGER of a pending org', meFixture([membershipFixture({ role: 'MANAGER', verification_status: 'PENDING' })]), '/company'],
    ['store OWNER pending', meFixture([storeMembership({ verification_status: 'PENDING' })]), '/store/settings/verification'],
    [
      'intent COMPANY but already owns an approved company',
      meFixture([membershipFixture()], { onboarding: { org_type: 'COMPANY', org_name: 'X' } }),
      '/company',
    ],
  ])('%s → %s', (_case, me, expected) => {
    expect(homePath(me, null)).toBe(expected);
  });

  it('never picks "create" for a user with several organizations; it uses the remembered one', () => {
    const me = meFixture([membershipFixture(), storeMembership()], { onboarding: { org_type: 'STORE', org_name: 'Shop' } });
    expect(homePath(me, 'org-store')).toBe('/store');
    expect(homePath(me, null)).toBe('/company');
  });
});

describe('onboarding routing after login, reload, Google and on / (no second Company/Store question)', () => {
  beforeEach(() => {
    resetSessionRestoreForTests();
    useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null, restoring: false });
  });
  afterEach(() => {
    document.cookie = 'csrf_token=; Max-Age=0; path=/';
  });

  it.each([
    ['Company', companyIntent, '/welcome/company', 'Set up your company', 'Pamir Trade'],
    ['Store', storeIntent, '/welcome/store', 'Set up your store', 'Corner Market'],
  ])('registered as %s → login opens that onboarding directly, name prefilled', async (_type, me, path, heading, name) => {
    const page = await passwordLogin(me);

    await waitFor(() => expect(page.current.location?.pathname).toBe(path));
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /^company/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /^store/i })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue(name)).toBeInTheDocument();
    page.stop();
    expect(page.visited).not.toContain('/welcome');
  });

  it('a reload restores the session and lands on the same onboarding page', async () => {
    document.cookie = 'csrf_token=csrf-1; path=/';
    mockApi([
      { path: '/meta', body: META },
      { method: 'POST', path: '/auth/refresh', body: { access_token: 'restored', expires_in: 900 } },
      { path: '/me', body: storeIntent },
    ]);
    void restoreSession();
    const page = renderAt('/welcome/store');

    expect(await screen.findByRole('heading', { name: 'Set up your store' })).toBeInTheDocument();
    page.stop();
    expect(page.visited).toEqual(['/welcome/store']);
  });

  it('/ and /welcome send a user with an intent to that onboarding page without loops', async () => {
    mockApi([
      { path: '/meta', body: META },
      { path: '/me', body: companyIntent },
    ]);
    useSessionStore.setState({ accessToken: 'access-1' });
    const root = renderAt('/');
    await waitFor(() => expect(root.current.location?.pathname).toBe('/welcome/company'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    root.stop();
    expect(root.visited).toEqual(['/', '/welcome/company']);
    root.unmount();

    const welcome = renderAt('/welcome');
    await waitFor(() => expect(welcome.current.location?.pathname).toBe('/welcome/company'));
    welcome.stop();
  });

  it('a user without an intent (e.g. created by Google) gets the Company/Store choice once', async () => {
    mockApi([
      { path: '/meta', body: META },
      { path: '/me', body: meFixture([]) },
    ]);
    useSessionStore.setState({ accessToken: 'access-1' });
    renderAt('/');
    expect(await screen.findByRole('radio', { name: /^company/i })).toBeInTheDocument();
  });

  it('a pending company owner lands on verification, not on create', async () => {
    const owner = meFixture(
      [membershipFixture({ verification_status: 'PENDING', permissions: ['org.view', 'verification.view', 'verification.submit'] })],
      {
        onboarding: { org_type: 'COMPANY', org_name: 'Pamir Distribution' },
      },
    );
    const page = await passwordLogin(owner, [
      {
        path: '/organization',
        body: {
          id: 'org-company',
          type: 'COMPANY',
          name: 'Pamir Distribution',
          legal_name: 'Pamir LLC',
          tax_identifier: '510012345',
          verification_status: 'PENDING',
          legal_locked: true,
          version: 2,
        },
      },
      {
        path: '/verification',
        body: {
          verification_status: 'PENDING',
          verified_at: null,
          required_documents: ['REGISTRATION_CERTIFICATE', 'TAX_CERTIFICATE'],
          can_submit: false,
          latest_request: null,
        },
      },
    ]);

    await waitFor(() => expect(page.current.location?.pathname).toBe('/company/settings/verification'));
    expect((await screen.findAllByText('Pending review')).length).toBeGreaterThan(0);
    page.stop();
    expect(page.visited.some((path) => path.startsWith('/welcome'))).toBe(false);
  });

  it('an approved owner lands on the dashboard', async () => {
    const page = await passwordLogin(meFixture([membershipFixture({ verification_status: 'APPROVED' })]));
    await waitFor(() => expect(page.current.location?.pathname).toBe('/company'));
    page.stop();
  });

  it('Google sign-in routes by the same server state', async () => {
    mockApi([
      { path: '/meta', body: META },
      { method: 'POST', path: '/auth/google/callback', body: { access_token: 'google-access', expires_in: 900, user: storeIntent } },
      { path: '/me', body: storeIntent },
    ]);
    const page = renderAt(`/auth/google/callback?state=${'s'.repeat(43)}&code=code-1`);

    await waitFor(() => expect(page.current.location?.pathname).toBe('/welcome/store'));
    page.stop();
  });
});
