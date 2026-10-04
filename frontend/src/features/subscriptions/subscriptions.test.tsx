import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';
import { previewPaymentPeriod, type Plan, type Subscription, type SubscriptionDetail } from './api';

const plan: Plan = {
  id: 'plan-1',
  code: 'STANDARD',
  name: { tg: 'Стандарт', ru: 'Стандарт', en: 'Standard' },
  price_monthly: '700.00',
  currency: 'TJS',
  max_active_stores: 150,
  max_users: 15,
  max_products: 3000,
  is_public: true,
  sort_order: 2,
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: null,
};
const sub: Subscription = {
  id: 'sub-1',
  company_id: 'org-company',
  company_name: 'Pamir Distribution',
  status: 'TRIAL',
  plan,
  trial_ends_at: '2026-10-20T00:00:00Z',
  current_period_start: null,
  current_period_end: null,
  grace_ends_at: null,
  soft_block_ends_at: null,
  cancel_at_period_end: false,
  status_changed_at: '2026-10-06T00:00:00Z',
  version: 1,
  usage: { users: 2, products: 0, active_stores: 0 },
  limits: { users: 15, products: 3000, active_stores: 150 },
  allowed_actions: ['MEMBER_INVITE'],
};
const detail: SubscriptionDetail = { ...sub, history: [], payments: [] };
const page = <T,>(results: T[]) => ({ count: results.length, results, limit: 20, offset: 0 });
function signIn() {
  useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: 'org-company', endedReason: null });
}

beforeEach(signIn);

it('shows company status, limits and payment history and captures tenant for plan requests', async () => {
  const { calls } = mockApi([
    { path: '/me', body: meFixture() },
    { path: '/subscription', body: sub },
    { path: '/subscription/payments', body: page([]) },
    { path: '/plans', body: page([plan]) },
    { method: 'POST', path: '/subscription/plan-requests', status: 201, body: {} },
  ]);
  renderRoutes(routes, '/company/settings/subscription');
  expect(await screen.findByText('Standard')).toBeInTheDocument();
  expect(screen.getByText('Users: 2 / 15')).toBeInTheDocument();
  expect(screen.getByText('No payments yet')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Plan' }), 'STANDARD');
  await userEvent.click(screen.getByRole('button', { name: 'Request plan change' }));
  expect(await screen.findByText('Your request was sent.')).toBeInTheDocument();
  const call = calls.find((call) => call.method === 'POST');
  expect(call?.headers['X-Org-Id']).toBe('org-company');
  expect(call?.headers['Idempotency-Key']).toMatch(/^[\da-f-]{36}$/i);
});

it('lets managers read subscription without owner controls', async () => {
  mockApi([
    { path: '/me', body: meFixture([membershipFixture({ role: 'MANAGER', permissions: ['subscription.view'] })]) },
    { path: '/subscription', body: sub },
    { path: '/subscription/payments', body: page([]) },
    { path: '/plans', body: page([plan]) },
  ]);
  renderRoutes(routes, '/company/settings/subscription');
  await screen.findByText('Standard');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Request plan change' })).not.toBeInTheDocument();
});

it('shows cancellation immediately and restores the server value after a failed save', async () => {
  const { fetchMock } = mockApi([
    { path: '/me', body: meFixture() },
    { path: '/subscription', body: sub },
    { path: '/subscription/payments', body: page([]) },
    { path: '/plans', body: page([plan]) },
    {
      method: 'POST',
      path: '/subscription/cancel-at-period-end',
      status: 503,
      body: { error: { code: 'service_unavailable', message: 'Unavailable', details: {} } },
    },
  ]);
  const implementation = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) => {
    if (init?.method === 'POST') await new Promise((resolve) => setTimeout(resolve, 500));
    return implementation(input, init);
  });
  renderRoutes(routes, '/company/settings/subscription');
  const checkbox = await screen.findByRole('checkbox', { name: 'Cancel at the end of the paid period' });
  await userEvent.click(checkbox);
  expect(checkbox).toBeChecked();
  expect(checkbox).toBeDisabled();
  await screen.findByRole('alert');
  expect(checkbox).not.toBeChecked();
  expect(checkbox).not.toBeDisabled();
});

it.each(['GRACE', 'SOFT_BLOCK', 'FULL_BLOCK', 'CANCELLED'])('shows the %s subscription banner', async (status) => {
  mockApi([
    { path: '/me', body: meFixture() },
    { path: '/subscription/access', body: { status, allowed_actions: ['READ'] } },
  ]);
  renderRoutes(routes, '/company');
  await waitFor(() => expect(screen.getByText(/Renew|New orders, partnerships|Продлите|Обунаи худро/)).toBeInTheDocument());
});

it('disables company member invitations when subscription blocks them', async () => {
  mockApi([
    { path: '/me', body: meFixture() },
    { path: '/subscription/access', body: { status: 'SOFT_BLOCK', allowed_actions: ['READ'] } },
    { path: '/members', body: page([]) },
  ]);
  renderRoutes(routes, '/company/team');
  expect(await screen.findByRole('button', { name: 'Invite member' })).toBeDisabled();
});

it('previews manual payment before recording an idempotent admin payment', async () => {
  const { calls } = mockApi([
    { path: '/me', body: meFixture([], { is_superadmin: true }) },
    { path: '/admin/subscriptions/sub-1', body: detail },
    { path: '/admin/plans', body: page([plan]) },
    { method: 'POST', path: '/admin/subscriptions/sub-1/payments', body: { ...detail, status: 'ACTIVE' } },
  ]);
  renderRoutes(routes, '/admin/subscriptions/sub-1');
  await screen.findByRole('heading', { name: 'Record payment' });
  await userEvent.click(screen.getByRole('button', { name: 'Preview payment' }));
  expect(screen.getByText('Confirm payment of 700.00 TJS.')).toBeInTheDocument();
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText('Payment recorded.')).toBeInTheDocument();
  const call = calls.find((call) => call.method === 'POST');
  expect(call?.headers['Idempotency-Key']).toBeTruthy();
  expect(call?.body).toEqual({ months: 1, amount: '700.00', method: 'CASH', reference: null, override_amount_reason: null });
});

it('requires an explanation for a manual payment amount override', async () => {
  mockApi([
    { path: '/me', body: meFixture([], { is_superadmin: true }) },
    { path: '/admin/subscriptions/sub-1', body: detail },
    { path: '/admin/plans', body: page([plan]) },
  ]);
  renderRoutes(routes, '/admin/subscriptions/sub-1');
  const amount = await screen.findByRole('spinbutton', { name: 'Amount (TJS)' });
  await userEvent.clear(amount);
  await userEvent.type(amount, '600');
  expect(screen.getByRole('textbox', { name: 'Reason for amount override' })).toBeRequired();
});

it.each([
  ['2026-01-31T12:30:00Z', 1, '2026-02-28T12:30:00.000Z'],
  ['2024-01-31T12:30:00Z', 1, '2024-02-29T12:30:00.000Z'],
  ['2026-01-31T12:30:00Z', 2, '2026-03-31T12:30:00.000Z'],
  ['2026-12-31T12:30:00Z', 1, '2027-01-31T12:30:00.000Z'],
] as const)('matches calendar month payment preview from %s', (start, months, end) => {
  expect(previewPaymentPeriod(sub, months, new Date(start)).end.toISOString()).toBe(end);
});

it('extends an active future paid period in the preview', () => {
  const active = { ...sub, status: 'ACTIVE', current_period_end: '2026-01-31T12:30:00Z' };
  const preview = previewPaymentPeriod(active, 1, new Date('2026-01-10T00:00:00Z'));
  expect(preview.start.toISOString()).toBe('2026-01-31T12:30:00.000Z');
  expect(preview.end.toISOString()).toBe('2026-02-28T12:30:00.000Z');
});
