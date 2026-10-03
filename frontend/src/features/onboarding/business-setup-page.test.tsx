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
const withCompanyArea = [
  ...routes.filter((route) => route.path !== '*' && route.path !== '/company'),
  { path: '/company/settings/verification', element: <p>company verification page</p> },
];

/** The five fields the backend rejects a request without, for either organization type. */
async function fillRequired(name: string) {
  await userEvent.type(screen.getByLabelText(/^(company|store) name/i), name);
  await userEvent.type(screen.getByLabelText(/^legal name/i), `${name} LLC`);
  await userEvent.clear(screen.getByLabelText(/^business phone/i));
  await userEvent.type(screen.getByLabelText(/^business phone/i), '+992 90 123 4567');
  await userEvent.type(screen.getByLabelText(/^city/i), 'Dushanbe');
  await userEvent.type(screen.getByLabelText(/^address/i), 'Rudaki Ave 12');
}

/** Step 4 of 5: the organization (ORG-001/002, P02 §1). */
describe('onboarding step 4: business setup (/welcome/company, /welcome/store)', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: null, endedReason: null, restoring: false }));

  it('opens on the chosen type and asks only for what creating the organization needs', async () => {
    mockApi([{ path: '/me', body: meFixture([]) }]);
    renderRoutes(routes, '/welcome/company');

    expect(await screen.findByRole('heading', { level: 1, name: 'Set up your company' })).toBeInTheDocument();
    expect(screen.getByText('Step 4 of 5')).toBeInTheDocument();
    // The type was settled in step 3, so it is not asked again.
    expect(screen.queryByRole('radio', { name: /company|store/i })).not.toBeInTheDocument();
    // Required by CompanyCreate, so they stand in the main column.
    for (const label of [/^company name/i, /^legal name/i, /^tax identifier/i, /^business phone/i, /^city/i, /^address/i]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // Accepted but not required, so it waits behind the disclosure.
    expect(screen.queryByLabelText(/^business email/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Optional details' }));
    expect(screen.getByLabelText(/^business email/i)).toBeInTheDocument();
    expect(screen.getByText('Your business will be verified')).toBeInTheDocument();
  });

  it("keeps a Store's tax identifier and coordinates optional, behind the disclosure", async () => {
    mockApi([{ path: '/me', body: meFixture([]) }]);
    renderRoutes(routes, '/welcome/store');

    expect(await screen.findByRole('heading', { level: 1, name: 'Set up your store' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^tax identifier/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Optional details' }));
    expect(screen.getByLabelText(/^tax identifier/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^latitude/i)).toBeInTheDocument();
  });

  it('validates the TZ fields before calling the API (tax id required for a Company)', async () => {
    const { calls } = mockApi([{ path: '/me', body: meFixture([]) }]);
    renderRoutes(routes, '/welcome/company');
    await userEvent.click(await screen.findByRole('button', { name: 'Create company' }));

    expect(await screen.findAllByText('Enter at least 2 characters.')).not.toHaveLength(0);
    expect(await screen.findByText('This field is required.')).toBeInTheDocument(); // tax identifier
    await userEvent.type(screen.getByLabelText(/^tax identifier/i), '12ab');
    await userEvent.click(screen.getByRole('button', { name: 'Create company' }));
    expect(await screen.findByText('Enter 9 to 12 digits.')).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('confirms the details in a dialog, then creates the Company and opens step 5', async () => {
    const created = {
      id: 'm-new',
      organization_id: 'org-new',
      org_type: 'COMPANY',
      org_name: 'Pamir Trade',
      org_status: 'ACTIVE',
      role: 'OWNER',
      status: 'ACTIVE',
      joined_at: '2026-09-01T08:00:00Z',
      permissions: [],
    };
    const { calls } = mockApi([
      { path: '/me', body: meFixture([]) },
      {
        method: 'POST',
        path: '/organizations/companies',
        status: 201,
        body: {
          organization: { id: 'org-new', type: 'COMPANY', name: 'Pamir Trade', verification_status: 'NOT_SUBMITTED' },
          membership: created,
        },
      },
    ]);
    renderRoutes(withCompanyArea, '/welcome/company');

    await screen.findByLabelText(/^company name/i);
    await fillRequired('Pamir Trade');
    await userEvent.type(screen.getByLabelText(/^tax identifier/i), '510012345');
    await userEvent.click(screen.getByRole('button', { name: 'Create company' }));

    // FE-002: the preview is the confirm dialog, not a second full screen.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Check your details');
    expect(dialog).toHaveTextContent('Pamir Trade LLC');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Create company', hidden: false }));
    expect(await screen.findByText('company verification page')).toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/api/v1/organizations/companies');
    expect(post?.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
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
    renderRoutes(withStoreArea, '/welcome/store');

    await screen.findByLabelText(/^store name/i);
    await fillRequired('Corner Market');
    await userEvent.click(screen.getByRole('button', { name: 'Optional details' }));
    await userEvent.type(screen.getByLabelText(/^latitude/i), '38.559772');
    await userEvent.click(screen.getByRole('button', { name: 'Create store' }));
    expect(await screen.findByText('Enter both latitude and longitude, or neither.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^longitude/i), '68.787038');
    await userEvent.click(screen.getByRole('button', { name: 'Create store' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Create store', hidden: false }));

    expect(await screen.findByText('store verification page')).toBeInTheDocument();
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/api/v1/organizations/stores');
    expect(post?.body).toMatchObject({ name: 'Corner Market', latitude: '38.559772', longitude: '68.787038' });
    expect(post?.body).not.toHaveProperty('tax_identifier');
  });

  it('shows a server error (e.g. the tax id is taken) and keeps what was typed', async () => {
    mockApi([
      { path: '/me', body: meFixture([]) },
      {
        method: 'POST',
        path: '/organizations/companies',
        status: 409,
        body: { error: { code: 'tax_identifier_taken', message: '', details: {}, request_id: 'r' } },
      },
    ]);
    renderRoutes(routes, '/welcome/company');

    await screen.findByLabelText(/^company name/i);
    await fillRequired('Pamir Trade');
    await userEvent.type(screen.getByLabelText(/^tax identifier/i), '510012345');
    await userEvent.click(screen.getByRole('button', { name: 'Create company' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Create company', hidden: false }));

    expect(await screen.findByText('This tax identifier is already registered.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^legal name/i)).toHaveValue('Pamir Trade LLC'));
  });

  it('prefills the name a pre-Phase-D registration left on the user record', async () => {
    mockApi([{ path: '/me', body: meFixture([], { onboarding: { org_type: 'COMPANY', org_name: 'Pamir Trade' } }) }]);
    renderRoutes(routes, '/welcome/company');
    expect(await screen.findByDisplayValue('Pamir Trade')).toBeInTheDocument();
  });
});
