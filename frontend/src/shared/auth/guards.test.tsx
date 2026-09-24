import { screen, waitFor } from '@testing-library/react';
import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';
import { RequireArea, RequireGuest, RequirePermission } from './guards';
import { useSessionStore } from './session-store';

function routesFor() {
  return [
    { path: '/login', element: <p>login page</p> },
    { path: '/welcome', element: <p>welcome page</p> },
    { path: '/403', element: <p>forbidden page</p> },
    { path: '/guest', element: <RequireGuest><p>guest only</p></RequireGuest> },
    {
      path: '/company',
      element: <RequireArea area="company">{({ membership }) => <p>company app for {membership.org_name}</p>}</RequireArea>,
    },
    {
      path: '/store',
      element: <RequireArea area="store">{({ membership }) => <p>store app for {membership.org_name}</p>}</RequireArea>,
    },
    {
      path: '/company/team',
      element: (
        <RequireArea area="company">
          {({ membership }) => (
            <RequirePermission membership={membership} code="members.view">
              <p>team page</p>
            </RequirePermission>
          )}
        </RequireArea>
      ),
    },
  ];
}

describe('route guards', () => {
  beforeEach(() => {
    useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null });
  });

  it('sends guests to /login and remembers where they were going', async () => {
    const { current } = renderRoutes(routesFor(), '/company?tab=1');
    await screen.findByText('login page');
    expect(current.location?.search).toBe(`?next=${encodeURIComponent('/company?tab=1')}`);
  });

  it('opens the Company app for a Company member', async () => {
    mockApi([{ path: '/me', body: meFixture([membershipFixture()]) }]);
    useSessionStore.setState({ accessToken: 'fixture-token' });
    renderRoutes(routesFor(), '/company');
    expect(await screen.findByText('company app for Pamir Distribution')).toBeInTheDocument();
    expect(useSessionStore.getState().activeOrgId).toBe('org-company');
  });

  it('denies the Store app to a user with only Company memberships', async () => {
    mockApi([{ path: '/me', body: meFixture([membershipFixture()]) }]);
    useSessionStore.setState({ accessToken: 'fixture-token' });
    renderRoutes(routesFor(), '/store');
    expect(await screen.findByText('forbidden page')).toBeInTheDocument();
  });

  it('switches the active organization when a multi-org user opens the other area', async () => {
    mockApi([{ path: '/me', body: meFixture([membershipFixture(), storeMembership()]) }]);
    useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: 'org-company' });
    renderRoutes(routesFor(), '/store');
    expect(await screen.findByText('store app for Corner Market')).toBeInTheDocument();
    expect(useSessionStore.getState().activeOrgId).toBe('org-store');
  });

  it('sends a user without organizations to onboarding', async () => {
    mockApi([{ path: '/me', body: meFixture([]) }]);
    useSessionStore.setState({ accessToken: 'fixture-token' });
    renderRoutes(routesFor(), '/company');
    expect(await screen.findByText('welcome page')).toBeInTheDocument();
  });

  it('hides permission-gated pages from roles without the permission (FE-004)', async () => {
    mockApi([{ path: '/me', body: meFixture([membershipFixture({ role: 'OPERATOR', permissions: [] })]) }]);
    useSessionStore.setState({ accessToken: 'fixture-token' });
    renderRoutes(routesFor(), '/company/team');
    expect(await screen.findByText("You don't have access")).toBeInTheDocument();
    expect(screen.queryByText('team page')).not.toBeInTheDocument();
  });

  it('ends the session and returns to login when the server rejects the token', async () => {
    mockApi([{ path: '/me', status: 401, body: { error: { code: 'token_expired', message: '', details: {}, request_id: 'r' } } }]);
    useSessionStore.setState({ accessToken: 'expired-token' });
    renderRoutes(routesFor(), '/company');
    expect(await screen.findByText('login page')).toBeInTheDocument();
    await waitFor(() => expect(useSessionStore.getState().endedReason).toBe('token_expired'));
    expect(useSessionStore.getState().accessToken).toBeNull();
  });

  it('redirects signed-in users away from guest pages to their application', async () => {
    mockApi([{ path: '/me', body: meFixture([storeMembership()]) }]);
    useSessionStore.setState({ accessToken: 'fixture-token' });
    renderRoutes(routesFor(), '/guest');
    expect(await screen.findByText('store app for Corner Market')).toBeInTheDocument();
  });
});
