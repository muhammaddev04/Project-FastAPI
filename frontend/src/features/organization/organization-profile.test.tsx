import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Membership } from '@/shared/auth/types';
import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes, type MockRoute } from '@/test/render';

const OWNER_PERMS = ['org.view', 'org.edit_contacts', 'org.edit_legal', 'verification.submit', 'verification.view', 'members.view'];

function company(overrides: Record<string, unknown> = {}) {
  return {
    id: 'org-company',
    type: 'COMPANY',
    name: 'Pamir Distribution',
    status: 'ACTIVE',
    legal_name: 'Pamir Distribution LLC',
    tax_identifier: '510012345',
    public_code: 'PMR4821',
    phone: '+992900000001',
    email: 'office@pamir.tj',
    city: 'Dushanbe',
    address: 'Rudaki 10',
    latitude: null,
    longitude: null,
    verification_status: 'APPROVED',
    verified_at: '2026-09-20T10:00:00Z',
    legal_locked: true,
    version: 3,
    ...overrides,
  };
}

const VERIFICATION = {
  verification_status: 'APPROVED',
  verified_at: '2026-09-20T10:00:00Z',
  required_documents: ['REGISTRATION_CERTIFICATE', 'TAX_CERTIFICATE'],
  can_submit: false,
  latest_request: {
    id: 'r1',
    status: 'APPROVED',
    submitted_at: '2026-09-19T10:00:00Z',
    review_started_at: null,
    reviewed_at: '2026-09-20T10:00:00Z',
    rejection_reason: null,
    documents: [
      { id: 'd1', doc_type: 'REGISTRATION_CERTIFICATE', file: { id: 'f1', display_name: 'registration.pdf', size_bytes: 1, content_type: 'application/pdf', category: 'VERIFICATION', created_at: '2026-09-19T10:00:00Z' } },
    ],
  },
};

const OWNERS = {
  count: 1,
  limit: 1,
  offset: 0,
  results: [{ id: 'm1', user_id: 'u1', full_name: 'Dilshod Rahimov', email: 'dilshod@pamir.tj', phone: null, role: 'OWNER', status: 'ACTIVE', joined_at: '2026-09-01T08:00:00Z' }],
};

function apiError(code: string, status: number) {
  return { status, body: { error: { code, message: code, details: {}, request_id: 'r' } } };
}

function open(path: string, membership: Membership, profile: Record<string, unknown>, extra: MockRoute[] = []) {
  useSessionStore.setState({ accessToken: 'token', activeOrgId: membership.organization_id, endedReason: null, restoring: false });
  const api = mockApi([
    { path: '/me', body: meFixture([membership]) },
    { path: '/organization', body: profile },
    { path: '/verification', body: VERIFICATION },
    { path: '/members', body: OWNERS },
    ...extra,
  ]);
  return { ...api, ...renderRoutes(routes, path) };
}

const owner = membershipFixture({ permissions: OWNER_PERMS });

describe('organization profile (P02 §8 settings/profile)', () => {
  it('/company/settings opens the profile tab with real organization data', async () => {
    const { current } = open('/company/settings', owner, company());
    await waitFor(() => expect(current.location?.pathname).toBe('/company/settings/profile'));
    expect(await screen.findByText('Company profile')).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(tabs).getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/company/settings/profile');
    expect(within(tabs).getByRole('link', { name: 'Verification' })).toHaveAttribute('href', '/company/settings/verification');
    expect(screen.getAllByText('PMR4821').length).toBeGreaterThan(0);
    expect(await screen.findByText('registration.pdf')).toBeInTheDocument();
    expect(await screen.findByText('dilshod@pamir.tj')).toBeInTheDocument();
  });

  it('keeps verified legal details read-only and saves only the changed contacts with the version', async () => {
    const { calls } = open('/company/settings/profile', owner, company(), [
      { method: 'PATCH', path: '/organization', body: company({ phone: '+992900000099', version: 4 }) },
    ]);
    expect(await screen.findByText(/Legal details are verified/)).toBeInTheDocument();
    expect(screen.getByLabelText('Legal name')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Company name')).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText('Tax identifier (INN)')).toHaveAttribute('readonly');

    const phone = screen.getByLabelText('Business phone');
    // The form is filled from the loaded profile right after the first render; edit only once it holds the data.
    await waitFor(() => expect(phone).toHaveValue('+992900000001'));
    await userEvent.clear(phone);
    await userEvent.click(phone);
    await userEvent.paste('+992 90 000 0099');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Organization profile saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ phone: '+992900000099', version: 3 });
  });

  it('lets the owner edit legal details before verification', async () => {
    const draft = company({ verification_status: 'NOT_SUBMITTED', verified_at: null, legal_locked: false });
    const { calls } = open('/company/settings/profile', owner, draft, [
      { method: 'PATCH', path: '/organization', body: company({ verification_status: 'NOT_SUBMITTED', legal_locked: false, tax_identifier: '510099999', version: 4 }) },
    ]);
    const inn = await screen.findByLabelText('Tax identifier (INN)');
    expect(inn).not.toHaveAttribute('readonly');
    await waitFor(() => expect(inn).toHaveValue('510012345'));
    await userEvent.clear(inn);
    await userEvent.type(inn, '510099999');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ tax_identifier: '510099999', version: 3 }));
  });

  it('explains a version conflict and reloads the latest profile', async () => {
    const { calls } = open('/company/settings/profile', owner, company(), [{ method: 'PATCH', path: '/organization', ...apiError('version_conflict', 409) }]);
    const city = await screen.findByLabelText('City');
    await waitFor(() => expect(city).toHaveValue('Dushanbe'));
    await userEvent.clear(city);
    await userEvent.type(city, 'Khujand');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText(/Someone else changed this profile/)).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET' && call.path === '/api/v1/organization').length).toBeGreaterThan(1));
  });

  it('shows a taken INN as the server explains it', async () => {
    const draft = company({ verification_status: 'NOT_SUBMITTED', legal_locked: false });
    open('/company/settings/profile', owner, draft, [{ method: 'PATCH', path: '/organization', ...apiError('tax_identifier_taken', 409) }]);
    const inn = await screen.findByLabelText('Tax identifier (INN)');
    await waitFor(() => expect(inn).toHaveValue('510012345'));
    await userEvent.clear(inn);
    await userEvent.type(inn, '510077777');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('This tax identifier is already registered.')).toBeInTheDocument();
  });

  it('gives an operator a read-only profile without the verification tab or team data', async () => {
    const operator = membershipFixture({ role: 'OPERATOR', permissions: ['org.view'] });
    const { calls } = open('/company/settings/profile', operator, company());
    expect(await screen.findByText('Your role can view these details only.')).toBeInTheDocument();
    expect(screen.getByLabelText('Business phone')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Save profile' })).not.toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(tabs).queryByRole('link', { name: 'Verification' })).not.toBeInTheDocument();
    expect(calls.some((call) => call.path === '/api/v1/members' || call.path === '/api/v1/verification')).toBe(false);
  });

  it('shows a store with its location and a maps link', async () => {
    const store = storeMembership({ permissions: OWNER_PERMS });
    open(
      '/store/settings/profile',
      store,
      company({ id: 'org-store', type: 'STORE', name: 'Corner Market', public_code: null, latitude: '38.559800', longitude: '68.787000' }),
    );
    expect(await screen.findByText('Store profile')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Latitude')).toHaveValue('38.559800'));
    expect(screen.getByRole('link', { name: 'Open in maps' })).toHaveAttribute('href', expect.stringContaining('38.559800,68.787000'));
  });
});
