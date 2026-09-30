import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';

const member = (index: number) => ({
  id: `m${index}`,
  user_id: `u${index}`,
  full_name: `Member ${index}`,
  email: `member${index}@example.tj`,
  phone: null,
  role: 'OPERATOR',
  status: 'ACTIVE',
  joined_at: '2026-09-01T08:00:00Z',
});
const PAGE = { count: 45, limit: 20, offset: 0, results: Array.from({ length: 20 }, (_, index) => member(index)) };
const EMPTY = { count: 0, limit: 20, offset: 0, results: [] };

function queries(calls: ReturnType<typeof mockApi>['calls']) {
  return calls.filter((call) => call.path === '/api/v1/members').map((call) => Object.fromEntries(new URLSearchParams(call.query)));
}

describe('P01 team page filters (FND-011: role, status, search over name and phone)', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: null, endedReason: null }));

  it('sends only the chosen filters, starts again at the first page, and resets them', async () => {
    const { calls } = mockApi([
      { path: '/me', body: meFixture([membershipFixture()]) },
      { path: '/members', body: PAGE },
    ]);
    renderRoutes(routes, '/company/team');
    const last = () => queries(calls).at(-1);

    await screen.findByText('Member 0');
    expect(last()).toEqual({ limit: '20', offset: '0' });
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(last()).toEqual({ limit: '20', offset: '20' }));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by role' }), 'MANAGER');
    await waitFor(() => expect(last()).toEqual({ role: 'MANAGER', limit: '20', offset: '0' }));
    // the filter change never asked for the old page of the new filter
    expect(queries(calls)).not.toContainEqual({ role: 'MANAGER', limit: '20', offset: '20' });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'SUSPENDED');
    await waitFor(() => expect(last()).toEqual({ role: 'MANAGER', status: 'SUSPENDED', limit: '20', offset: '0' }));

    await userEvent.type(screen.getByRole('textbox', { name: 'Search members' }), '  +99290  ');
    await waitFor(() => expect(last()).toEqual({ role: 'MANAGER', status: 'SUSPENDED', search: '+99290', limit: '20', offset: '0' }));

    // going back to the first filter combination (reset) starts at its first page, not at the page left earlier
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => expect(last()).toEqual({ limit: '20', offset: '0' }));
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search members' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Filter by role' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
  });

  it('a role without members.view sees no access and the page does not ask the API', async () => {
    const { calls } = mockApi([
      { path: '/me', body: meFixture([membershipFixture({ role: 'OPERATOR', permissions: ['org.view'] })]) },
      { path: '/members', body: PAGE },
    ]);
    renderRoutes(routes, '/company/team');
    expect(await screen.findByText("You don't have access")).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/api/v1/members')).toBe(false);
  });

  it('limits the search to the 100 characters the API accepts', async () => {
    mockApi([
      { path: '/me', body: meFixture([membershipFixture()]) },
      { path: '/members', body: PAGE },
    ]);
    renderRoutes(routes, '/company/team');
    expect(await screen.findByRole('textbox', { name: 'Search members' })).toHaveAttribute('maxlength', '100');
  });

  it('when filters hide every member, says so and offers the reset', async () => {
    const { calls } = mockApi([
      { path: '/me', body: meFixture([membershipFixture()]) },
      { path: '/members', body: EMPTY },
    ]);
    renderRoutes(routes, '/company/team');
    await screen.findByText('No members match');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'REVOKED');
    expect(await screen.findByText('Nothing matches these filters')).toBeInTheDocument();
    const resets = screen.getAllByRole('button', { name: 'Reset filters' });
    expect(resets).toHaveLength(2); // toolbar and empty state
    await userEvent.click(resets[1]!);
    await waitFor(() => expect(queries(calls).at(-1)).toEqual({ limit: '20', offset: '0' }));
  });
});
