import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';
import { baseQuantity, quantityDifference, type StockDetail } from './api';

const stock: StockDetail = {
  product_id: 'product-1',
  name: 'Green tea',
  sku: 'TEA',
  barcode: '123456',
  base_unit: 'PCS',
  category_id: null,
  is_active: true,
  quantity: '100.000',
  reserved_quantity: '80.000',
  available: '20.000',
  low_stock_threshold: '25.000',
  last_movement_at: null,
  version: 1,
  reservations: [],
};
const product = {
  id: 'product-1',
  name: 'Green tea',
  sku: 'TEA',
  barcode: '123456',
  base_unit: 'PCS',
  is_active: true,
  units: [
    { id: 'pcs-1', code: 'PCS', coefficient: '1.000', is_active: true, is_base: true, allow_fraction: false },
    { id: 'box-1', code: 'BOX24', coefficient: '24.000', is_active: true, is_base: false, allow_fraction: false },
  ],
};
const page = <T,>(results: T[]) => ({ count: results.length, limit: 20, offset: 0, results });
beforeEach(() => useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: 'org-company', endedReason: null }));

it('calculates base unit previews with exact decimal rounding and range checks', () => {
  expect(baseQuantity('24', '24')).toBe('576.000');
  expect(baseQuantity('0.001', '0.500')).toBe('0.001');
  expect(baseQuantity('99999999999.999', '1')).toBe('99999999999.999');
  expect(baseQuantity('99999999999.999', '2')).toBeNull();
  expect(baseQuantity('-1', '1')).toBeNull();
  expect(baseQuantity('0.0001', '1')).toBeNull();
  expect(quantityDifference('90.000', '100.000')).toBe('-10.000');
});

it('filters low stock on the server and links to the product stock detail', async () => {
  const { calls } = mockApi([
    { path: '/me', body: meFixture() },
    { path: '/inventory/stocks', body: page([stock]) },
    { path: '/catalog/categories', body: [] },
  ]);
  renderRoutes(routes, '/company/warehouse/stock');
  expect(await screen.findByRole('link', { name: 'Green tea · TEA' })).toHaveAttribute('href', '/company/warehouse/stock/product-1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Low stock only' }));
  await waitFor(() => expect(calls.some((call) => call.query?.get('low_stock') === 'true')).toBe(true));
});

it('requires confirmation and submits the original unit quantity with idempotency', async () => {
  const { calls } = mockApi([
    { path: '/me', body: meFixture() },
    { path: '/catalog/products', body: page([{ ...product, units: undefined }]) },
    { path: '/catalog/products/product-1', body: product },
    { method: 'POST', path: '/inventory/receipts', status: 201, body: { received: 1 } },
    { path: '/inventory/stocks', body: page([stock]) },
    { path: '/catalog/categories', body: [] },
  ]);
  renderRoutes(routes, '/company/warehouse/receipts/new');
  const search = await screen.findByLabelText('Search name, SKU or barcode');
  await waitFor(() => expect(search).toBeEnabled());
  await userEvent.type(search, 'TEA');
  const choose = await screen.findByRole('button', { name: 'Green tea · TEA' });
  await waitFor(() => expect(choose).toBeEnabled());
  await userEvent.click(choose);
  await userEvent.selectOptions(await screen.findByLabelText('Unit code'), 'box-1');
  await userEvent.type(await screen.findByLabelText('On hand'), '24');
  expect(screen.getByText('+24 BOX24 = +576.000 PCS')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(calls.filter((call) => call.path === '/api/v1/inventory/receipts' && call.method === 'POST')).toHaveLength(0);
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(calls.some((call) => call.path === '/api/v1/inventory/receipts' && call.method === 'POST')).toBe(true));
  const request = calls.find((call) => call.path === '/api/v1/inventory/receipts' && call.method === 'POST');
  expect(request?.body).toMatchObject({ items: [{ product_id: 'product-1', unit_id: 'box-1', quantity: '24' }] });
  expect(request?.headers['Idempotency-Key']).toBeTruthy();
  expect(calls.find((call) => call.path === '/api/v1/catalog/products/product-1')?.headers['X-Org-Id']).toBe('org-company');
});

it('shows adjustment delta and requires a reason before submitting', async () => {
  const { calls } = mockApi([
    { path: '/me', body: meFixture() },
    { path: '/inventory/stocks/product-1', body: stock },
    { path: '/inventory/movements', body: page([]) },
    { method: 'POST', path: '/inventory/adjustments', body: stock },
  ]);
  renderRoutes(routes, '/company/warehouse/stock/product-1');
  const open = await screen.findByRole('button', { name: 'Inventory count' });
  await waitFor(() => expect(open).toBeEnabled());
  await userEvent.click(open);
  const dialog = within(screen.getByRole('dialog'));
  await userEvent.type(dialog.getByLabelText('Actual quantity in base units'), '90');
  expect(dialog.getByText('Quantity change: -10.000 PCS')).toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await userEvent.type(dialog.getByLabelText('Reason (at least 5 characters)'), 'Actual count');
  await userEvent.click(dialog.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path === '/api/v1/inventory/adjustments')).toBe(true));
});

it('allows operators to view stock while hiding all write actions', async () => {
  mockApi([
    { path: '/me', body: meFixture([membershipFixture({ role: 'OPERATOR', permissions: ['stock.view', 'catalog.view'] })]) },
    { path: '/inventory/stocks/product-1', body: stock },
    { path: '/inventory/movements', body: page([]) },
  ]);
  renderRoutes(routes, '/company/warehouse/stock/product-1');
  await screen.findByRole('heading', { name: 'Green tea' });
  expect(screen.queryByRole('button', { name: 'Inventory count' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Write off' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Low stock threshold')).toBeDisabled();
});

it('denies the inventory area to couriers', async () => {
  const { calls } = mockApi([{ path: '/me', body: meFixture([membershipFixture({ role: 'COURIER', permissions: ['org.view'] })]) }]);
  renderRoutes(routes, '/company/warehouse/stock');
  await screen.findByRole('heading', { name: "You don't have access" });
  expect(calls.some((call) => call.path === '/api/v1/inventory/stocks')).toBe(false);
});
