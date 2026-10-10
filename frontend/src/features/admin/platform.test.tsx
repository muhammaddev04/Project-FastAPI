import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';

function adminMe() {
  return meFixture([], { is_superadmin: true, full_name: 'Platform Admin' });
}

const user1 = {
  id: 'user-9',
  full_name: 'Nigina Karimova',
  email: 'nigina@example.tj',
  phone: '+992900000009',
  status: 'ACTIVE' as const,
  is_superadmin: false,
  language: 'tg',
  last_login_at: '2026-10-08T06:00:00Z',
  created_at: '2026-09-01T06:00:00Z',
};
const membership = {
  user_id: 'user-9',
  full_name: 'Nigina Karimova',
  organization_id: 'org-company',
  organization_name: 'Pamir Distribution',
  organization_type: 'COMPANY' as const,
  role: 'OWNER',
  status: 'ACTIVE',
};

beforeEach(() => {
  useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: null, restoring: false });
});
afterEach(() => vi.restoreAllMocks());

it('shows the platform figures', async () => {
  mockApi([
    { path: '/me', body: adminMe() },
    {
      path: '/admin/dashboard',
      body: {
        organizations: { COMPANY_ACTIVE: 4, STORE_ACTIVE: 11 },
        subscriptions: { ACTIVE: 3, TRIAL: 1 },
        mrr: '1500.00',
        verifications_pending: 2,
        outbox_failed: 1,
        reconciliation_issues: 0,
        notifications_failed_24h: 5,
      },
    },
  ]);
  renderRoutes(routes, '/admin/dashboard');
  expect(await screen.findByText('1500.00 TJS')).toBeInTheDocument();
  expect(screen.getByText('Active companies')).toBeInTheDocument();
  expect(screen.getByText('Notification failures (24 h)')).toBeInTheDocument();
});

it('blocks a user only once a reason has been written, and sends that reason', async () => {
  const user = userEvent.setup();
  const { calls } = mockApi([
    { path: '/me', body: adminMe() },
    { path: '/admin/users', body: { count: 1, limit: 20, offset: 0, results: [user1] } },
    { path: '/admin/users/user-9', body: { ...user1, memberships: [membership] } },
    {
      method: 'POST',
      path: '/admin/users/user-9/block',
      body: { ...user1, status: 'BLOCKED', memberships: [membership] },
    },
  ]);
  renderRoutes(routes, '/admin/users');

  await user.click(await screen.findByText('Nigina Karimova'));
  await user.click(await screen.findByRole('button', { name: 'Block' }));
  const confirm = screen.getByRole('button', { name: 'Confirm' });
  // §3: the command is not offered until the reason is long enough to be useful in the audit log.
  expect(confirm).toBeDisabled();
  await user.type(screen.getByRole('textbox'), 'Fraud reported by the owner');
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  await waitFor(() => expect(calls.some((call) => call.path === '/api/v1/admin/users/user-9/block')).toBe(true));
  const blocked = calls.find((call) => call.path === '/api/v1/admin/users/user-9/block');
  expect(blocked?.body).toEqual({ reason: 'Fraud reported by the owner' });
  expect(blocked?.headers['X-Org-Id']).toBeUndefined();
});

it('shows an audit row with what changed before and after', async () => {
  const user = userEvent.setup();
  mockApi([
    { path: '/me', body: adminMe() },
    {
      path: '/admin/audit-logs',
      body: {
        count: 1,
        limit: 20,
        offset: 0,
        results: [
          {
            id: 'audit-1',
            created_at: '2026-10-09T09:00:00Z',
            actor_id: 'admin-1',
            actor_type: 'SUPERADMIN',
            org_id: 'org-company',
            action: 'organization.legal_updated',
            entity_type: 'organizations',
            entity_id: 'org-company',
            old_data: { legal_name: 'Pamir LLC' },
            new_data: { legal_name: 'Pamir Distribution LLC' },
            reason: 'Registry correction requested',
            request_id: 'req-1',
          },
        ],
      },
    },
  ]);
  renderRoutes(routes, '/admin/audit');
  await user.click(await screen.findByText('organization.legal_updated'));
  expect(await screen.findByText('Before')).toBeInTheDocument();
  expect(screen.getByText(/Pamir LLC/)).toBeInTheDocument();
  expect(screen.getByText(/Pamir Distribution LLC/)).toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByText(/Registry correction requested/)).toBeInTheDocument();
});

it('retries a failed outbox event with a reason', async () => {
  const user = userEvent.setup();
  const event = {
    id: 'event-1',
    event_type: 'ORDER_CREATED',
    org_id: 'org-company',
    status: 'FAILED' as const,
    attempts: 8,
    last_error: 'RuntimeError',
    created_at: '2026-10-09T08:00:00Z',
    next_attempt_at: '2026-10-09T08:10:00Z',
    processed_at: null,
  };
  const { calls } = mockApi([
    { path: '/me', body: adminMe() },
    { path: '/admin/outbox', body: { count: 1, limit: 20, offset: 0, results: [event] } },
    { method: 'POST', path: '/admin/outbox/event-1/retry', body: { ...event, status: 'PENDING', attempts: 0, last_error: null } },
  ]);
  renderRoutes(routes, '/admin/outbox');

  expect(await screen.findByText('RuntimeError')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await user.type(screen.getByRole('textbox'), 'Provider outage is over');
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(calls.some((call) => call.path === '/api/v1/admin/outbox/event-1/retry')).toBe(true));
  expect(calls.find((call) => call.path === '/api/v1/admin/outbox/event-1/retry')?.body).toEqual({
    reason: 'Provider outage is over',
  });
});

it("asks for a reason before reading a tenant's orders and statement", async () => {
  const user = userEvent.setup();
  const organization = {
    id: 'org-company',
    name: 'Pamir Distribution',
    type: 'COMPANY' as const,
    status: 'ACTIVE',
    legal_name: 'Pamir Distribution LLC',
    verification_status: 'APPROVED',
    created_at: '2026-09-01T06:00:00Z',
    phone: '+992900000001',
    email: null,
    city: 'Dushanbe',
    address: 'Rudaki 1',
    tax_identifier: '123456789',
    members: [membership],
    partnerships: 3,
    subscription: { status: 'ACTIVE', plan_code: 'BASIC', current_period_end: '2026-11-01T00:00:00Z' },
    version: 2,
  };
  const { calls } = mockApi([
    { path: '/me', body: adminMe() },
    { path: '/admin/organizations', body: { count: 1, limit: 20, offset: 0, results: [organization] } },
    { path: '/admin/organizations/org-company', body: organization },
    {
      method: 'PATCH',
      path: '/admin/organizations/org-company/legal',
      body: { ...organization, legal_name: 'Pamir Trading LLC', tax_identifier: '123456780', version: 3 },
    },
    {
      path: '/admin/partnerships/11111111-1111-4111-8111-111111111111/statement',
      body: {
        partnership_id: '11111111-1111-4111-8111-111111111111',
        date_from: null,
        date_to: null,
        opening_balance: '0.00',
        closing_balance: '420.00',
        entries: [],
      },
    },
    {
      path: '/admin/organizations/org-company/orders',
      body: {
        count: 1,
        limit: 20,
        offset: 0,
        results: [
          {
            id: 'order-1',
            order_number: 'ORD-2026-000001',
            company_id: 'org-company',
            store_id: 'org-store',
            status: 'COMPLETED',
            total: '420.00',
            created_at: '2026-10-01T06:00:00Z',
            delivered_at: '2026-10-02T06:00:00Z',
          },
        ],
      },
    },
  ]);
  renderRoutes(routes, '/admin/organizations');

  await user.click(await screen.findByText('Pamir Distribution'));
  const showOrders = await screen.findByRole('button', { name: 'Show orders' });
  expect(showOrders).toBeDisabled();
  await user.type(screen.getByPlaceholderText(/At least 10 characters/), 'Support ticket 4821');
  await user.click(screen.getByRole('button', { name: 'Show orders' }));
  await waitFor(() => expect(calls.some((call) => call.path === '/api/v1/admin/organizations/org-company/orders')).toBe(true));
  const read = calls.find((call) => call.path === '/api/v1/admin/organizations/org-company/orders');
  expect(read?.query?.get('reason')).toBe('Support ticket 4821');
  expect(await screen.findByText('ORD-2026-000001')).toBeInTheDocument();
  const showStatement = screen.getByRole('button', { name: 'Show statement' });
  expect(showStatement).toBeDisabled();
  await user.type(screen.getByLabelText('Partnership ID'), '11111111-1111-4111-8111-111111111111');
  await user.click(showStatement);
  expect(await screen.findByText('Closing balance: 420.00 TJS')).toBeInTheDocument();
  expect(calls.find((call) => call.path.endsWith('/statement'))?.query?.get('reason')).toBe('Support ticket 4821');
  await user.click(screen.getByRole('button', { name: 'Legal fields' }));
  const legalName = screen.getByLabelText('Legal name');
  expect(legalName).toHaveValue('Pamir Distribution LLC');
  const taxId = screen.getByLabelText('Tax identifier');
  expect(taxId).toHaveValue('123456789');
  fireEvent.change(legalName, { target: { value: 'Pamir Trading LLC' } });
  fireEvent.change(taxId, { target: { value: '123456780' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Corrected registration certificate' } });
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      legal_name: 'Pamir Trading LLC',
      tax_identifier: '123456780',
      version: 2,
      reason: 'Corrected registration certificate',
    }),
  );
});
