import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';

const MEMBERS = {
  count: 2,
  limit: 20,
  offset: 0,
  results: [
    { id: 'm1', user_id: 'u1', full_name: 'Dilshod Rahimov', phone: '+992900000001', role: 'OWNER', status: 'ACTIVE', joined_at: '2026-09-01T08:00:00Z' },
    { id: 'm2', user_id: 'u2', full_name: 'Farrukh Nazarov', phone: '+992900000002', role: 'OPERATOR', status: 'SUSPENDED', joined_at: '2026-09-10T08:00:00Z' },
  ],
};

function signIn(activeOrgId: string | null = null) {
  useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId, endedReason: null });
}

function sidebar() {
  return screen.getAllByRole('navigation', { name: 'Main navigation' })[0]!;
}

describe('Company application', () => {
  it('shows the owner console with live team size and honest empty panels', async () => {
    const { calls } = mockApi([
      { path: '/me', body: meFixture([membershipFixture()]) },
      { path: '/members', body: MEMBERS },
    ]);
    signIn();
    renderRoutes(routes, '/company');
    expect(await screen.findByRole('heading', { name: 'Pamir Distribution' })).toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: /subscription/i })).toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByText('Getting ready')).toBeInTheDocument();
    expect(screen.getByText('Store orders will appear here once partnerships and ordering are live.')).toBeInTheDocument();
    const membersCall = calls.find((call) => call.path === '/api/v1/members');
    expect(membersCall?.headers['X-Org-Id']).toBe('org-company');
  });

  it('gives an operator a reduced menu and no team data', async () => {
    const { calls } = mockApi([{ path: '/me', body: meFixture([membershipFixture({ role: 'OPERATOR', permissions: [] })]) }]);
    signIn();
    renderRoutes(routes, '/company');
    await screen.findByRole('heading', { name: 'Pamir Distribution' });
    const nav = sidebar();
    expect(within(nav).getByRole('link', { name: /orders/i })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /team/i })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /subscription/i })).not.toBeInTheDocument();
    expect(screen.getByText('Your work queue')).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/api/v1/members')).toBe(false);
  });

  it('opens a planned module as an explicit "arrives in" page', async () => {
    mockApi([{ path: '/me', body: meFixture([membershipFixture()]) }, { path: '/members', body: MEMBERS }]);
    signIn();
    renderRoutes(routes, '/company/orders');
    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByText('Arrives in P07')).toBeInTheDocument();
  });

  it('forbids a planned page the role cannot see', async () => {
    mockApi([{ path: '/me', body: meFixture([membershipFixture({ role: 'OPERATOR', permissions: [] })]) }]);
    signIn();
    renderRoutes(routes, '/company/subscription');
    expect(await screen.findByText("You don't have access")).toBeInTheDocument();
  });

  it('lists the team from the API with statuses', async () => {
    mockApi([{ path: '/me', body: meFixture([membershipFixture()]) }, { path: '/members', body: MEMBERS }]);
    signIn();
    renderRoutes(routes, '/company/team');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Farrukh Nazarov')).toBeInTheDocument();
    expect(within(table).getByText('Suspended')).toBeInTheDocument();
    expect(screen.getByText('1–2 of 2')).toBeInTheDocument();
  });

  it('shows a retryable error when the team cannot be loaded', async () => {
    mockApi([
      { path: '/me', body: meFixture([membershipFixture()]) },
      { path: '/members', status: 403, body: { error: { code: 'membership_inactive', message: '', details: {}, request_id: 'r' } } },
    ]);
    signIn();
    renderRoutes(routes, '/company/team');
    expect(await screen.findByText("Your membership in this organization isn't active.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Store application', () => {
  it('shows the store home with repeat-order and supplier panels', async () => {
    mockApi([{ path: '/me', body: meFixture([storeMembership()]) }, { path: '/members', body: MEMBERS }]);
    signIn();
    renderRoutes(routes, '/store');
    expect(await screen.findByRole('heading', { name: 'Corner Market' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repeat order' })).toBeDisabled();
    expect(screen.getByText('My suppliers')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Quick navigation' })).toBeInTheDocument();
  });

  it('hides debts and the team from sellers', async () => {
    mockApi([{ path: '/me', body: meFixture([storeMembership({ role: 'SELLER', permissions: [] })]) }]);
    signIn();
    renderRoutes(routes, '/store');
    await screen.findByRole('heading', { name: 'Corner Market' });
    expect(screen.queryByText('Upcoming payments')).not.toBeInTheDocument();
    expect(within(sidebar()).queryByRole('link', { name: /my debt/i })).not.toBeInTheDocument();
  });

  it('denies the team page to sellers', async () => {
    mockApi([{ path: '/me', body: meFixture([storeMembership({ role: 'SELLER', permissions: [] })]) }]);
    signIn();
    renderRoutes(routes, '/store/team');
    expect(await screen.findByText("You don't have access")).toBeInTheDocument();
  });
});

describe('organization switcher and profile', () => {
  it('switches from the company to the store application', async () => {
    mockApi([{ path: '/me', body: meFixture([membershipFixture(), storeMembership()]) }, { path: '/members', body: MEMBERS }]);
    signIn('org-company');
    renderRoutes(routes, '/company');
    await screen.findByRole('heading', { name: 'Pamir Distribution' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Switch organization' })[0]!);
    await userEvent.click(await screen.findByRole('menuitem', { name: /corner market/i }));
    expect(await screen.findByRole('heading', { name: 'Corner Market' })).toBeInTheDocument();
    expect(useSessionStore.getState().activeOrgId).toBe('org-store');
  });

  it('routes company couriers to the courier area', async () => {
    mockApi([{ path: '/me', body: meFixture([membershipFixture({ role: 'COURIER', permissions: [] })]) }]);
    signIn();
    renderRoutes(routes, '/');
    expect(await screen.findByRole('heading', { name: "Today's run" })).toBeInTheDocument();
  });

  it('saves the profile through PATCH /me', async () => {
    const me = meFixture([membershipFixture()]);
    const { calls } = mockApi([
      { path: '/me', body: me },
      { method: 'PATCH', path: '/me', body: { ...me, full_name: 'Dilshod R.' } },
    ]);
    signIn();
    renderRoutes(routes, '/profile');
    const name = await screen.findByLabelText('Full name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Dilshod R.');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Your profile was saved.')).toBeInTheDocument();
    await waitFor(() => expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ full_name: 'Dilshod R.', language: 'en' }));
    expect(screen.getByRole('button', { name: /change password/i })).toBeDisabled();
  });
});
