import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';
import { priceDifference, type Product, type MatrixRow } from './api';

const page = <T,>(results: T[]) => ({ count: results.length, results, limit: 20, offset: 0 });
const product: Product = {
  id: 'product-1',
  sku: 'TEA',
  name: 'Green tea',
  description: null,
  barcode: null,
  category_id: null,
  base_unit: 'PCS',
  image_file_id: null,
  is_active: true,
  version: 1,
  created_at: '2026-10-05T10:00:00Z',
  units: [
    {
      id: 'unit-1',
      product_id: 'product-1',
      code: 'PCS',
      name: { tg: 'PCS', ru: 'PCS', en: 'PCS' },
      coefficient: '1',
      is_base: true,
      allow_fraction: false,
      min_order_qty: '1',
      is_active: true,
    },
  ],
  prices: [],
};
beforeEach(() => useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: 'org-company', endedReason: null }));

it('lists products and applies server search filters', async () => {
  const { calls } = mockApi([
    { path: '/me', body: meFixture() },
    { path: '/catalog/products', body: page([product]) },
    { path: '/catalog/categories', body: [] },
  ]);
  renderRoutes(routes, '/company/catalog/products');
  expect(await screen.findByRole('link', { name: 'Green tea' })).toHaveAttribute('href', '/company/catalog/products/product-1');
  await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'TEA');
  await waitFor(() => expect(calls.some((call) => call.query?.get('search') === 'TEA')).toBe(true));
});

it('creates a product with a tenant bound idempotency key', async () => {
  const { calls } = mockApi([
    { path: '/me', body: meFixture() },
    { path: '/catalog/categories', body: [] },
    { method: 'POST', path: '/catalog/products', status: 201, body: product },
    { path: '/catalog/products/product-1', body: product },
  ]);
  renderRoutes(routes, '/company/catalog/products/new');
  const sku = await screen.findByLabelText('SKU');
  await waitFor(() => expect(sku).toBeEnabled());
  await userEvent.type(sku, 'TEA');
  await userEvent.type(screen.getByLabelText('Name'), 'Green tea');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
  const call = calls.find((call) => call.method === 'POST')!;
  expect(call.headers['X-Org-Id']).toBe('org-company');
  expect(call.headers['Idempotency-Key']).toBeTruthy();
  expect(call.body).toMatchObject({ sku: 'TEA', base_unit: 'PCS' });
});

it('shows warehouse catalog without price tabs or editing', async () => {
  mockApi([
    { path: '/me', body: meFixture([membershipFixture({ role: 'WAREHOUSE', permissions: ['org.view', 'catalog.view'] })]) },
    { path: '/catalog/products/product-1', body: product },
    { path: '/catalog/categories', body: [] },
  ]);
  renderRoutes(routes, '/company/catalog/products/product-1');
  expect(await screen.findByLabelText('SKU')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Prices' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
});

it('blocks new catalog writes in full block', async () => {
  mockApi([
    { path: '/me', body: meFixture() },
    { path: '/catalog/products', body: page([product]) },
    { path: '/catalog/categories', body: [] },
    { path: '/subscription/access', body: { status: 'FULL_BLOCK', allowed_actions: ['READ'] } },
  ]);
  renderRoutes(routes, '/company/catalog/products');
  await screen.findByRole('link', { name: 'Green tea' });
  expect(screen.queryByRole('link', { name: 'Add product' })).not.toBeInTheDocument();
});

it('previews bulk price changes before sending one idempotent request', async () => {
  const row: MatrixRow = {
    product_id: product.id,
    sku: product.sku,
    name: product.name,
    unit: product.units![0]!,
    current: {
      id: 'price-1',
      price_list_id: 'list-1',
      product_unit_id: 'unit-1',
      price: '10.00',
      valid_from: '2026-10-05T10:00:00Z',
      valid_to: null,
      created_at: '2026-10-05T10:00:00Z',
    },
    future: null,
    resolved_price: '10',
  };
  const { calls } = mockApi([
    { path: '/me', body: meFixture() },
    { path: '/pricing/price-lists/list-1/prices', body: page([row]) },
    { method: 'POST', path: '/pricing/prices/bulk', status: 201, body: [] },
  ]);
  renderRoutes(routes, '/company/pricing/lists/list-1');
  const input = await screen.findByRole('spinbutton', { name: 'Price TEA PCS' });
  await waitFor(() => expect(input).toBeEnabled());
  await userEvent.clear(input);
  await userEvent.type(input, '12');
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: /Preview/ }));
  expect(screen.getByText(/20.0%/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1));
  expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
    rows: [{ price: '12', product_unit_id: 'unit-1', price_list_id: 'list-1' }],
  });
});

it('disables import confirmation when preview contains errors', async () => {
  mockApi([
    { path: '/me', body: meFixture() },
    {
      path: '/imports/import-1',
      body: { id: 'import-1', kind: 'PRODUCTS', status: 'VALIDATED', total_rows: 2, error_count: 1, summary: {}, failure_reason: null },
    },
    { path: '/imports/import-1/rows', body: page([]) },
    {
      path: '/imports/import-1/errors',
      body: page([
        {
          id: 'error-1',
          row_number: 2,
          field: 'base_unit',
          error_code: 'base_unit_immutable',
          message_key: 'errors.base_unit_immutable',
          params: {},
        },
      ]),
    },
  ]);
  renderRoutes(routes, '/company/imports/import-1');
  expect(await screen.findByRole('button', { name: 'Confirm' })).toBeDisabled();
  expect(await screen.findByText('The base unit cannot change after use or pricing.')).toBeVisible();
});

it('computes percentage differences including previously missing prices', () => {
  expect(priceDifference('10', '12')).toBe('20.0');
  expect(priceDifference(null, '12')).toBeNull();
});
