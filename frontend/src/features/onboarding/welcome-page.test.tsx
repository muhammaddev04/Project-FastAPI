import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';

const withStoreArea = [
  ...routes.filter((route) => route.path !== '*' && route.path !== '/store'),
  { path: '/store/settings/verification', element: <p>store verification page</p> },
];

async function fillCommon(name: string) {
  await userEvent.type(screen.getByLabelText(/^(company|store) name/i), name);
  await userEvent.type(screen.getByLabelText(/^legal name/i), `${name} LLC`);
  await userEvent.clear(screen.getByLabelText(/^business phone/i));
  await userEvent.type(screen.getByLabelText(/^business phone/i), '+992 90 123 4567');
  await userEvent.type(screen.getByLabelText(/^city/i), 'Dushanbe');
  await userEvent.type(screen.getByLabelText(/^address/i), 'Rudaki Ave 12');
}

describe('onboarding /welcome (ORG-001/002, P02 §1)', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: null, endedReason: null, restoring: false }));

  it('explains the Company and Store choices and why the details are asked', async () => {
    mockApi([{ path: '/me', body: meFixture([]) }]);
    renderRoutes(routes, '/welcome');
    expect(await screen.findByRole('heading', { name: /welcome, dilshod/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^company/i })).toBeChecked();
    expect(screen.getByText('A shop that buys from its suppliers.')).toBeInTheDocument();
    expect(screen.getByText('Your business will be verified')).toBeInTheDocument();
    expect(screen.getByText(/used to check that the business is real/i)).toBeInTheDocument();
  });

  it('validates the TZ fields before calling the API (tax id required for a Company)', async () => {
    const { calls } = mockApi([{ path: '/me', body: meFixture([]) }]);
    renderRoutes(routes, '/welcome');
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));

    expect(await screen.findAllByText('Enter at least 2 characters.')).not.toHaveLength(0);
    expect(await screen.findByText('This field is required.')).toBeInTheDocument(); // tax identifier
    await userEvent.type(screen.getByLabelText(/^tax identifier/i), '12ab');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByText('Enter 9 to 12 digits.')).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('reviews, creates a Company with the TZ payload and opens its verification step', async () => {
    const withCompanyArea = [
      ...routes.filter((route) => route.path !== '*' && route.path !== '/company'),
      { path: '/company/settings/verification', element: <p>company verification page</p> },
    ];
    const created = { id: 'm-new', organization_id: 'org-new', org_type: 'COMPANY', org_name: 'Pamir Trade', org_status: 'ACTIVE', role: 'OWNER', status: 'ACTIVE', joined_at: '2026-09-01T08:00:00Z', permissions: [] };
    const { calls } = mockApi([
      { path: '/me', body: meFixture([]) },
      {
        method: 'POST',
        path: '/organizations/companies',
        status: 201,
        body: { organization: { id: 'org-new', type: 'COMPANY', name: 'Pamir Trade', verification_status: 'NOT_SUBMITTED' }, membership: created },
      },
    ]);
    renderRoutes(withCompanyArea, '/welcome');
    await screen.findByRole('radio', { name: /^company/i });
    await fillCommon('Pamir Trade');
    await userEvent.type(screen.getByLabelText(/^tax identifier/i), '510012345');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(await screen.findByText('Check your details')).toBeInTheDocument();
    expect(screen.getByText('Pamir Trade LLC')).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Create company' }));

    expect(await screen.findByText('company verification page')).toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/api/v1/organizations/companies');
    expect(post?.body).toEqual({
      name: 'Pamir Trade',
      legal_name: 'Pamir Trade LLC',
      tax_identifier: '510012345',
      phone: '+992901234567',
      city: 'Dushanbe',
      address: 'Rudaki Ave 12',
    });
    expect(useSessionStore.getState().activeOrgId).toBe('org-new');
  });

  it('creates a Store without a tax id, with coordinates that must come in pairs', async () => {
    const created = storeMembership({ organization_id: 'org-store', org_name: 'Corner Market' });
    const { calls } = mockApi([
      { path: '/me', body: meFixture([]) },
      {
        method: 'POST',
        path: '/organizations/stores',
        status: 201,
        body: { organization: { id: 'org-store', type: 'STORE', name: 'Corner Market' }, membership: created },
      },
    ]);
    renderRoutes(withStoreArea, '/welcome');
    await userEvent.click(await screen.findByRole('radio', { name: /^store/i }));
    await fillCommon('Corner Market');
    await userEvent.type(screen.getByLabelText(/^latitude/i), '38.559772');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByText('Enter both latitude and longitude, or neither.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^longitude/i), '68.787038');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create store' }));

    expect(await screen.findByText('store verification page')).toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/api/v1/organizations/stores');
    expect(post?.body).toMatchObject({ name: 'Corner Market', latitude: '38.559772', longitude: '68.787038' });
    expect(post?.body).not.toHaveProperty('tax_identifier');
  });

  it('shows a server error (e.g. the tax id is taken) and goes back to editing', async () => {
    mockApi([
      { path: '/me', body: meFixture([]) },
      {
        method: 'POST',
        path: '/organizations/companies',
        status: 409,
        body: { error: { code: 'tax_identifier_taken', message: '', details: {}, request_id: 'r' } },
      },
    ]);
    renderRoutes(routes, '/welcome');
    await screen.findByRole('radio', { name: /^company/i });
    await fillCommon('Pamir Trade');
    await userEvent.type(screen.getByLabelText(/^tax identifier/i), '510012345');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create company' }));

    expect(await screen.findByText('This tax identifier is already registered.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^legal name/i)).toHaveValue('Pamir Trade LLC'));
  });
});
