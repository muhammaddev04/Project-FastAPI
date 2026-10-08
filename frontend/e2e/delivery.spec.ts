import { expect as baseExpect, test } from '@playwright/test';
import { seed, login, switchOrg, request, ready, queue, type Order, type Delivery } from './business-fixture';
const expect = baseExpect.configure({ timeout: 30_000 });

test('P08 board, courier offline handover, encrypted queue, replay and authoritative conflicts', async ({ page, browser }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(30_000);
  const data = seed();
  await login(page, data.email);
  await switchOrg(page, 'P08 Company');
  const first = await ready(page, data);
  const second = await ready(page, data);
  await page.getByRole('link', { name: 'Delivery', exact: true }).click();
  await expect(page.getByRole('option', { name: 'P08 Warehouse' })).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Courier', exact: true }).selectOption({ label: 'P08 Warehouse' });
  await page.getByRole('checkbox').first().check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await expect(page.getByRole('link', { name: /P08 Warehouse/ })).toBeVisible();
  await page.getByRole('link', { name: /P08 Warehouse/ }).click();
  await expect(page.getByRole('heading', { name: 'Run', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move stop up' }).nth(1).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const runId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect
    .poll(async () => (await request<{ stops: Delivery[] }>(page, `/delivery-runs/${runId}`)).stops[0]?.id)
    .toBe(first.delivery.id);
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByText('On the way', { exact: true }).first()).toBeVisible();

  await switchOrg(page, 'P08 Shop');
  await page.goto(`/store/orders/${first.order.id}`);
  const code = (await page.getByLabel('Handover code').textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);
  await expect(page.getByText('Give this code to the courier only when you receive the goods.')).toBeVisible();

  const courierContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const courier = await courierContext.newPage();
  await login(courier, data.warehouseEmail, true);
  await courier.goto('/courier');
  await expect(courier.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await courier.goto(`/courier/stops/${first.delivery.id}`);
  await expect(courier.getByRole('button', { name: 'I have arrived' })).toBeVisible();
  await queue(courier); // Warm the queue module before network is disabled.
  await courier.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  expect(await courier.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await courierContext.setOffline(true);
  await expect(courier.getByRole('status').first()).toContainText('Offline');
  expect((await request<{ stops: Delivery[] }>(courier, '/courier/today')).stops).toHaveLength(2);
  await courier.getByRole('button', { name: 'I have arrived' }).click();
  await expect(courier.getByRole('status').first()).toContainText('1 waiting to sync');
  await courier.getByLabel('Enter the 6-digit code').fill(code);
  await courier.getByRole('button', { name: 'Handed over', exact: true }).click();
  await expect(courier.getByRole('status').first()).toContainText('2 waiting to sync');
  const queued = await queue(courier);
  expect(queued.some((row) => row.sealed_code)).toBe(true);
  expect(JSON.stringify(queued)).not.toContain(code);
  courier.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('2 delivery actions');
    await dialog.dismiss();
  });
  await courier.getByRole('button', { name: 'Account menu', exact: true }).click();
  await courier.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(courier.getByRole('status').first()).toContainText('2 waiting to sync');
  expect((await queue(courier)).filter((row) => row.status === 'PENDING')).toHaveLength(2);
  await courierContext.setOffline(false);
  await expect(courier.getByRole('status').first()).toContainText('0 waiting to sync');
  await expect(courier.getByText('Delivered', { exact: true })).toBeVisible();
  const arrivedOperation = queued.find((row) => row.operation_type === 'DELIVERY_ARRIVE')!;
  const replay = await request<{ results: { result_status: string }[] }>(courier, '/courier/sync', 'POST', {
    operations: [
      {
        operation_id: arrivedOperation.operation_id,
        operation_type: arrivedOperation.operation_type,
        entity_id: arrivedOperation.entity_id,
        expected_status: arrivedOperation.expected_status,
        client_created_at: arrivedOperation.client_created_at,
        payload: {},
      },
    ],
  });
  expect(replay.results[0]?.result_status).toBe('DUPLICATE');
  await switchOrg(page, 'P08 Company');
  expect((await request<Order>(page, `/orders/${first.order.id}`)).status).toBe('DELIVERED');
  const stock = await request<{ quantity: string; reserved_quantity: string }>(page, `/inventory/stocks/${data.product}`);
  expect(stock.quantity).toBe('95.000');
  expect(stock.reserved_quantity).toBe('5.000');

  await courier.goto(`/courier/stops/${second.delivery.id}`);
  await expect(courier.getByRole('button', { name: 'I have arrived' })).toBeVisible();
  await courierContext.setOffline(true);
  await courier.getByRole('button', { name: 'I have arrived' }).click();
  await expect(courier.getByRole('status').first()).toContainText('1 waiting to sync');
  await page.goto(`/company/delivery/${second.delivery.id}`);
  await page.getByRole('button', { name: 'Confirm without code', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Why the code was not used').fill('Goods received by store owner');
  await dialog.getByRole('button', { name: 'Confirm without code', exact: true }).click();
  await expect(page.getByText('Delivered', { exact: true }).first()).toBeVisible();
  await courierContext.setOffline(false);
  await expect(courier.getByRole('status').first()).toContainText('0 waiting to sync');
  await courier.getByRole('link', { name: 'Issues', exact: true }).last().click();
  await expect(courier.getByText('Server state: Delivered', { exact: true })).toBeVisible();
  const issues = await queue(courier);
  expect(issues.some((row) => row.status === 'CONFLICT')).toBe(true);
  await courier.goto('/courier');
  await courier.getByRole('button', { name: 'Finish run' }).click();
  await expect(courier.getByText(/Finished/)).toBeVisible();
  await courierContext.close();
});
