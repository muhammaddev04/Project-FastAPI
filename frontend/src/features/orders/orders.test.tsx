import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';
import { totals, type Order, type Preview } from './api';

const page = (results: unknown[]) => ({ count: results.length, limit: 20, offset: 0, results });
const item = {
  id: 'item-1',
  product_id: 'product-1',
  product_unit_id: 'unit-1',
  product_name_snapshot: 'Tea',
  sku_snapshot: 'TEA',
  unit_code_snapshot: 'PCS',
  unit_name_snapshot: { en: 'Piece' },
  unit_coefficient_snapshot: '1.000',
  allow_fraction_snapshot: false,
  base_unit_snapshot: 'PCS',
  requested_quantity: '5.000',
  confirmed_quantity: null,
  rejected_quantity: '0.000',
  unit_price: '10.00',
  line_total: '50.00',
};
const order = {
  id: 'order-1',
  company_id: 'org-company',
  store_id: 'org-store',
  partnership_id: 'partner-1',
  order_number: 'ORD-2026-000001',
  source: 'STORE',
  status: 'VIEWED',
  partner_name: 'Corner Market',
  currency: 'TJS',
  requested_subtotal: '50.00',
  subtotal: null,
  discount: '0.00',
  discount_reason: null,
  delivery_fee: '0.00',
  total: null,
  terms_id: null,
  terms_snapshot: null,
  delivery_address: 'Rudaki 1',
  delivery_latitude: null,
  delivery_longitude: null,
  store_note: null,
  company_note: null,
  created_by: 'user-1',
  confirmed_by: null,
  confirmed_at: null,
  delivered_at: null,
  completed_at: null,
  cancelled_at: null,
  cancel_reason: null,
  rejection_reason: null,
  credit_override_reason: null,
  minimum_override_reason: null,
  created_at: '2026-10-06T06:00:00Z',
  updated_at: null,
  version: 2,
  items: [item],
  history: [
    {
      id: 'h1',
      from_status: null,
      to_status: 'NEW',
      actor_id: 'user-1',
      actor_type: 'USER',
      reason: null,
      details: {},
      created_at: '2026-10-06T06:00:00Z',
    },
  ],
} satisfies Order;
const preview = {
  lines: [{ item_id: 'item-1', available: '3.000', confirmed_quantity: '3.000' }],
  credit: { allowed: true, limit: '100.00', outstanding: '0.00', unapplied: '0.00' },
  terms: { credit_limit: '100.00', minimum_order_amount: '0.00', delivery_fee: '7.00', free_delivery_threshold: '50.00' },
  subtotal: '30.00',
  delivery_fee: '7.00',
  total: '37.00',
} satisfies Preview;
const cart = {
  partnership_id: 'partner-1',
  items: [
    {
      product_unit_id: 'unit-1',
      product_name: 'Tea',
      unit_code: 'PCS',
      quantity: '5.000',
      allow_fraction: false,
      min_order_qty: '1.000',
      price: '10.00',
      line_total: '50.00',
      availability_status: 'IN_STOCK',
      orderable: true,
    },
  ],
  subtotal: '50.00',
  delivery_fee: '0.00',
  minimum_order_amount: '0.00',
  warnings: [],
};
const partner = {
  id: 'partner-1',
  status: 'ACTIVE',
  partner: { name: 'Pamir supplier' },
  current_terms: { minimum_order_amount: '0.00', delivery_fee: '0.00' },
};
function setup(store = false, role = 'OWNER', permissions?: string[]) {
  const membership = store ? storeMembership() : membershipFixture();
  const selected = { ...membership, role: role as typeof membership.role, ...(permissions ? { permissions } : {}) };
  useSessionStore.setState({ accessToken: 'token', activeOrgId: selected.organization_id, restoring: false });
  return meFixture([selected]);
}

it('uses per-line money and subtotal before discount for free delivery', () => {
  expect(totals(order, { 'item-1': '5' }, preview, '40')).toMatchObject({ subtotal: 50, deliveryFee: 0, total: 10 });
  expect(totals(order, { 'item-1': '3' }, preview, '5')).toMatchObject({ subtotal: 30, deliveryFee: 7, total: 32 });
});

it('previews cart checkout and sends an idempotency key', async () => {
  const api = mockApi([
    { path: '/me', body: setup(true) },
    { path: '/partnerships', body: page([partner]) },
    { path: '/store/cart/partner-1', body: cart },
    { path: '/store/cart/partner-1/checkout', method: 'POST', body: order },
    { path: '/orders/order-1', body: order },
  ]);
  renderRoutes(routes, '/store/cart/partner-1');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Review order' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/Tea · 5.000 PCS/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Send order' }));
  await waitFor(() => expect(api.calls.find((row) => row.path.endsWith('/checkout'))?.headers['Idempotency-Key']).toBeTruthy());
});

it('prefills only available quantity and reviews partial confirmation', async () => {
  const api = mockApi([
    { path: '/me', body: setup() },
    { path: '/orders/order-1', body: order },
    { path: '/orders/order-1/confirmation-preview', body: preview },
    { path: '/orders/order-1/confirm', method: 'POST', body: { ...order, status: 'PARTIALLY_CONFIRMED' } },
  ]);
  renderRoutes(routes, '/company/orders/order-1');
  const user = userEvent.setup();
  const input = await screen.findByRole('spinbutton', { name: 'Confirmed quantity · Tea' });
  expect(input).toHaveValue(3);
  await user.click(screen.getByRole('button', { name: 'Review confirmation' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/Rejected/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Confirm order' }));
  await waitFor(() =>
    expect(api.calls.find((row) => row.path.endsWith('/confirm'))?.body).toMatchObject({
      lines: [{ item_id: 'item-1', confirmed_quantity: '3.000' }],
      version: 2,
    }),
  );
});

it('requires an owner credit reason before confirmation', async () => {
  mockApi([
    { path: '/me', body: setup() },
    { path: '/orders/order-1', body: order },
    { path: '/orders/order-1/confirmation-preview', body: { ...preview, credit: { ...preview.credit, limit: '20.00', allowed: false } } },
  ]);
  renderRoutes(routes, '/company/orders/order-1');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Review confirmation' }));
  const dialog = screen.getByRole('dialog');
  const confirm = within(dialog).getByRole('button', { name: 'Confirm order' });
  expect(confirm).toBeDisabled();
  await user.type(within(dialog).getByLabelText('Credit override reason'), 'Owner approval');
  expect(confirm).toBeEnabled();
});

it('keeps discount and override fields from operators', async () => {
  mockApi([
    { path: '/me', body: setup(false, 'OPERATOR', ['orders.view', 'orders.confirm', 'orders.create']) },
    { path: '/orders/order-1', body: order },
    { path: '/orders/order-1/confirmation-preview', body: { ...preview, credit: { ...preview.credit, limit: '20.00', allowed: false } } },
  ]);
  renderRoutes(routes, '/company/orders/order-1');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Review confirmation' }));
  expect(screen.queryByLabelText('Discount reason')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Credit override reason')).not.toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm order' })).toBeDisabled();
});

it('renders warehouse quantities and assembly without money', async () => {
  const warehouseItem = Object.fromEntries(Object.entries(item).filter(([key]) => !['unit_price', 'line_total'].includes(key)));
  const warehouseOrder = Object.fromEntries(
    Object.entries({ ...order, status: 'CONFIRMED', items: [{ ...warehouseItem, confirmed_quantity: '5.000' }] }).filter(
      ([key]) =>
        !['currency', 'requested_subtotal', 'subtotal', 'discount', 'delivery_fee', 'total', 'terms_id', 'terms_snapshot'].includes(key),
    ),
  );
  mockApi([
    { path: '/me', body: setup(false, 'WAREHOUSE', ['orders.view', 'orders.assemble']) },
    { path: '/orders/order-1', body: warehouseOrder },
  ]);
  renderRoutes(routes, '/company/orders/order-1');
  expect(await screen.findByRole('button', { name: 'Start assembling' })).toBeInTheDocument();
  expect(screen.queryByText('TJS', { exact: false })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Price' })).not.toBeInTheDocument();
});

it('seller cannot cancel an order created by another user', async () => {
  mockApi([
    { path: '/me', body: setup(true, 'SELLER') },
    { path: '/orders/order-1', body: { ...order, created_by: 'another-user' } },
  ]);
  renderRoutes(routes, '/store/orders/order-1');
  await screen.findByRole('heading', { name: order.order_number });
  expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
});
