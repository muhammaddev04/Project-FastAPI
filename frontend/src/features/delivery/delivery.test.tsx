import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture } from '@/test/fixtures';
import { mockApi, renderRoutes, renderWithProviders } from '@/test/render';
import { mapsUrl, type Delivery } from './api';
import { StoreDeliveryBlock } from './pages';
import { operationId } from './offline-queue';

const permissions = ['delivery.view_all', 'delivery.plan', 'delivery.manual_confirm', 'delivery.regenerate_code', 'members.view'];
const me = () => meFixture([membershipFixture({ permissions })]);
const page = <T,>(results: T[]) => ({ count: results.length, limit: 100, offset: 0, results });
const delivery: Delivery = {
  id: 'd-1',
  order_id: 'o-1',
  store_id: 's-1',
  order_number: 'ORD-1',
  store_name: 'Shop',
  attempt_no: 1,
  status: 'PLANNED',
  run_id: null,
  stop_sequence: null,
  courier_id: null,
  address: 'Rudaki 1',
  latitude: null,
  longitude: null,
  code_attempts: 0,
  code_locked: false,
  confirmation_method: null,
  manual_reason: null,
  failure_reason_code: null,
  failure_note: null,
  dispatched_at: null,
  arrived_at: null,
  delivered_at: null,
  failed_at: null,
  version: 2,
  created_at: '2026-10-06T08:00:00Z',
};
beforeEach(() => useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: 'org-company', endedReason: null }));

it('hands map navigation to coordinates or an encoded address', () => {
  expect(mapsUrl({ address: 'A & B' })).toContain('destination=A%20%26%20B');
  expect(mapsUrl({ address: 'Shop', latitude: '38.56', longitude: '68.77' })).toContain('destination=38.56%2C68.77');
  expect(operationId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

it('creates a run with the chosen courier and ordered deliveries', async () => {
  const user = userEvent.setup();
  const { calls } = mockApi([
    { path: '/me', body: me() },
    { path: '/deliveries', body: page([delivery]) },
    { path: '/delivery-runs', body: page([]) },
    { path: '/members', body: page([{ user_id: 'c-1', full_name: 'Courier One', role: 'COURIER', status: 'ACTIVE' }]) },
    { method: 'POST', path: '/delivery-runs', body: {} },
  ]);
  renderRoutes(routes, '/company/delivery');
  await screen.findByRole('option', { name: 'Courier One' });
  await user.selectOptions(await screen.findByLabelText('Courier'), 'c-1');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'New run' }));
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ courier_id: 'c-1', delivery_ids: ['d-1'] }),
  );
  expect(calls.find((call) => call.method === 'POST')?.headers['Idempotency-Key']).toBeTruthy();
});

it('keeps planning controls from delivery viewers', async () => {
  mockApi([
    { path: '/me', body: meFixture([membershipFixture({ role: 'OPERATOR', permissions: ['delivery.view_all'] })]) },
    { path: '/deliveries', body: page([delivery]) },
    { path: '/delivery-runs', body: page([]) },
  ]);
  renderRoutes(routes, '/company/delivery');
  await screen.findByText('Shop');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'New run' })).not.toBeInTheDocument();
});

it('requires a substantial reason for a manual handover and displays the warning', async () => {
  const user = userEvent.setup();
  mockApi([
    { path: '/me', body: me() },
    { path: '/deliveries/d-1', body: { ...delivery, status: 'ARRIVED', history: [] } },
  ]);
  renderRoutes(routes, '/company/delivery/d-1');
  await user.click(await screen.findByRole('button', { name: 'Confirm without code' }));
  const buttons = screen.getAllByRole('button', { name: 'Confirm without code' });
  expect(buttons.at(-1)).toBeDisabled();
  await user.type(screen.getByLabelText('Why the code was not used'), 'Goods handed to the owner');
  expect(buttons.at(-1)).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('confirmed without its code');
});

it('shows the store handover code with the receipt instruction', async () => {
  mockApi([
    {
      path: '/orders/o-1/delivery',
      body: { status: 'IN_TRANSIT', code: '123456', courier_name: 'Courier One', courier_phone: '+992900000001' },
    },
  ]);
  renderWithProviders(<StoreDeliveryBlock orderId="o-1" orgId="store-1" />);
  expect(await screen.findByLabelText('Handover code')).toHaveTextContent('123456');
  expect(screen.getByText('Give this code to the courier only when you receive the goods.')).toBeVisible();
});
