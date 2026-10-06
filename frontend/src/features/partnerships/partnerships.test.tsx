import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';
import { canAct, type Partnership } from './api';

const terms = {
  id: 'terms-1',
  partnership_id: 'partner-1',
  version_no: 1,
  price_list_id: 'list-1',
  price_list_name: 'Standard list',
  credit_limit: '100.00',
  credit_days: 14,
  payment_methods: ['CASH'],
  minimum_order_amount: '0.00',
  delivery_fee: '5.00',
  free_delivery_threshold: null,
  return_days: 14,
  dispute_window_hours: 48,
  effective_from: '2026-01-01T00:00:00Z',
  note: null,
  created_by: 'owner',
  created_at: '2026-01-01T00:00:00Z',
};
const partner = {
  id: 'partner-1',
  company_id: 'org-company',
  store_id: 'org-store',
  status: 'PENDING',
  initiated_by_side: 'COMPANY',
  customer_code: 'SHOP-1',
  activated_at: null,
  suspended_at: null,
  ended_at: null,
  end_reason: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
  version: 1,
  partner: {
    id: 'org-store',
    name: 'Corner Market',
    phone: '+992901234567',
    city: 'Dushanbe',
    address: 'Rudaki 1',
    verification_status: 'APPROVED',
  },
  current_terms: terms,
  future_terms: [],
};
const page = (results: unknown[]) => ({ count: results.length, limit: 20, offset: 0, results });
function setup(store = false, permissions?: string[]) {
  const membership = store ? storeMembership(permissions ? { permissions } : {}) : membershipFixture(permissions ? { permissions } : {});
  useSessionStore.setState({ accessToken: 'token', activeOrgId: membership.organization_id, restoring: false });
  return meFixture([membership]);
}

it('shows partnership lists and real detail routes', async () => {
  mockApi([
    { path: '/me', body: setup() },
    { path: '/partnerships', body: page([partner]) },
    { path: '/partnerships/partner-1', body: partner },
    { path: '/partnerships/partner-1/terms', body: [terms] },
  ]);
  const user = userEvent.setup();
  renderRoutes(routes, '/company/partners');
  await user.click(await screen.findByRole('link', { name: 'Corner Market' }));
  expect(await screen.findByRole('heading', { name: 'Current terms' })).toBeInTheDocument();
  expect(screen.getAllByText('Standard list').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
});

it('previews an invitation before the store accepts with an idempotency key', async () => {
  const { calls } = mockApi([
    { path: '/me', body: setup(true) },
    { path: '/partnerships/partner-1', body: partner },
    { path: '/partnerships/partner-1/terms', body: [terms] },
    { method: 'POST', path: '/partnerships/partner-1/accept', body: { ...partner, status: 'ACTIVE' } },
  ]);
  const user = userEvent.setup();
  renderRoutes(routes, '/store/suppliers/partner-1');
  await user.click(await screen.findByRole('button', { name: 'Accept' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('100.00')).toBeInTheDocument();
  expect(calls.some((call) => call.method === 'POST')).toBe(false);
  await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(calls.some((call) => call.path.endsWith('/accept') && call.method === 'POST')).toBe(true));
  const request = calls.find((call) => call.path.endsWith('/accept') && call.method === 'POST');
  expect(request?.headers['Idempotency-Key']).toMatch(/^[a-f0-9-]{36}$/);
  expect(request?.body).toEqual({});
});

it('requires a reason and the partner name before termination', async () => {
  const { calls } = mockApi([
    { path: '/me', body: setup() },
    { path: '/partnerships/partner-1', body: { ...partner, status: 'ACTIVE' } },
    { path: '/partnerships/partner-1/terms', body: [terms] },
    { method: 'POST', path: '/partnerships/partner-1/terminate', body: { ...partner, status: 'TERMINATED' } },
  ]);
  const user = userEvent.setup();
  renderRoutes(routes, '/company/partners/partner-1');
  await user.click(await screen.findByRole('button', { name: 'Terminate' }));
  const dialog = screen.getByRole('dialog');
  const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByLabelText('Reason'), 'Finished');
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByLabelText('Type Corner Market to confirm'), 'Corner Market');
  await user.click(confirm);
  await waitFor(() => expect(calls.some((call) => call.path.endsWith('/terminate') && call.method === 'POST')).toBe(true));
});

it('keeps manager credit fields read-only while allowing other new terms', async () => {
  mockApi([
    { path: '/me', body: setup(false, ['partners.view', 'partners.manage', 'terms.view', 'terms.manage']) },
    { path: '/partnerships/partner-1', body: { ...partner, status: 'ACTIVE' } },
    { path: '/partnerships/partner-1/terms', body: [terms] },
    { path: '/pricing/price-lists', body: page([{ id: 'list-1', name: 'Standard list', is_active: true }]) },
  ]);
  const user = userEvent.setup();
  renderRoutes(routes, '/company/partners/partner-1');
  await user.click(await screen.findByRole('button', { name: 'New terms version' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('Credit limit')).toHaveAttribute('readonly');
  expect(within(dialog).getByLabelText('Credit days')).toHaveAttribute('readonly');
  expect(within(dialog).getByLabelText('Delivery fee')).not.toHaveAttribute('readonly');
});

it('submits an eight-character company code from the store request dialog', async () => {
  const { calls } = mockApi([
    { path: '/me', body: setup(true) },
    { path: '/partnerships', body: page([]) },
    { method: 'POST', path: '/partnerships/request', status: 201, body: partner },
  ]);
  const user = userEvent.setup();
  renderRoutes(routes, '/store/suppliers');
  await user.click(await screen.findByRole('button', { name: 'Request partnership' }));
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('Company public code (8 characters)'), 'abcd2345');
  await user.click(within(dialog).getByRole('button', { name: 'Request partnership' }));
  await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ company_public_code: 'ABCD2345' });
});

it('denies warehouse access without making partnership requests', async () => {
  const { calls } = mockApi([{ path: '/me', body: setup(false, ['stock.view']) }]);
  renderRoutes(routes, '/company/partners');
  expect(await screen.findByText("You don't have access")).toBeInTheDocument();
  expect(calls.some((call) => call.path.includes('/partnerships'))).toBe(false);
});

it('checks receiver-only actions and company-only suspension', () => {
  const value = partner as Partnership;
  expect(canAct(value, 'COMPANY', ['partners.manage'], 'accept')).toBe(false);
  expect(canAct(value, 'STORE', ['partners.manage'], 'accept')).toBe(true);
  expect(canAct({ ...value, status: 'ACTIVE' }, 'STORE', ['partners.manage'], 'suspend')).toBe(false);
  expect(canAct({ ...value, status: 'ACTIVE' }, 'COMPANY', ['partners.manage'], 'suspend')).toBe(true);
});
