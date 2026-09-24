import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';

const withStoreArea = [...routes.filter((route) => route.path !== '*'), { path: '/store', element: <p>store app</p> }];

describe('onboarding /welcome', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: null, endedReason: null }));

  it('explains the Company and Store choices', async () => {
    mockApi([{ path: '/me', body: meFixture([]) }]);
    renderRoutes(routes, '/welcome');
    expect(await screen.findByRole('heading', { name: /welcome, dilshod/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^company/i })).toBeChecked();
    expect(screen.getByText('A shop that buys from its suppliers.')).toBeInTheDocument();
  });

  it('validates the organization name before calling the API', async () => {
    const { calls } = mockApi([{ path: '/me', body: meFixture([]) }]);
    renderRoutes(routes, '/welcome');
    await userEvent.click(await screen.findByRole('button', { name: 'Create company' }));
    expect(await screen.findByText('Enter at least 2 characters.')).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('creates a Store, makes it active and opens the Store app', async () => {
    const created = storeMembership({ organization_id: 'org-new', org_name: 'Corner Market' });
    const { calls } = mockApi([
      { path: '/me', body: meFixture([]) },
      {
        method: 'POST',
        path: '/organizations/stores',
        status: 201,
        body: { organization: { id: 'org-new', type: 'STORE', name: 'Corner Market', status: 'ACTIVE' }, membership: created },
      },
    ]);
    renderRoutes(withStoreArea, '/welcome');
    await userEvent.click(await screen.findByRole('radio', { name: /^store/i }));
    await userEvent.type(screen.getByLabelText('Store name'), 'Corner Market');
    await userEvent.click(screen.getByRole('button', { name: 'Create store' }));

    expect(await screen.findByText('store app')).toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/api/v1/organizations/stores');
    expect(post?.body).toEqual({ name: 'Corner Market' });
    expect(useSessionStore.getState().activeOrgId).toBe('org-new');
  });

  it('shows the server error when the organization limit is reached', async () => {
    mockApi([
      { path: '/me', body: meFixture([]) },
      {
        method: 'POST',
        path: '/organizations/companies',
        status: 409,
        body: { error: { code: 'organization_limit_reached', message: '', details: { max: 5 }, request_id: 'r' } },
      },
    ]);
    renderRoutes(routes, '/welcome');
    await userEvent.type(await screen.findByLabelText('Company name'), 'Sixth Company');
    await userEvent.click(screen.getByRole('button', { name: 'Create company' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You already own the maximum number of organizations (5).'),
    );
  });

  it('lists existing organizations to switch into', async () => {
    mockApi([{ path: '/me', body: meFixture([storeMembership()]) }]);
    renderRoutes(withStoreArea, '/welcome');
    await userEvent.click(await screen.findByRole('button', { name: /corner market/i }));
    expect(await screen.findByText('store app')).toBeInTheDocument();
    expect(useSessionStore.getState().activeOrgId).toBe('org-store');
  });
});
