import { expect as baseExpect, test } from '@playwright/test';
import { seed, login, switchOrg, request, ready, queue } from './business-fixture';
const expect = baseExpect.configure({ timeout: 30_000 });

test('P09 delivered charge, FIFO payment, statement, adjustments and offline courier cash', async ({ page, browser }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(30_000);
  const data = seed();
  await login(page, data.email);
  await switchOrg(page, 'P08 Company');
  const first = await ready(page, data);
  await page.goto(`/company/delivery/${first.delivery.id}`);
  // Dispatch through the existing board to bind the delivery to the courier.
  await page.goto('/company/delivery');
  await page.getByRole('combobox', { name: 'Courier', exact: true }).selectOption({ label: 'P08 Warehouse' });
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await page.getByRole('link', { name: /P08 Warehouse/ }).click();
  await expect(page.getByRole('heading', { name: 'Run', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start run' }).click();
  await page.goto(`/company/delivery/${first.delivery.id}`);
  await page.getByRole('button', { name: 'Confirm without code', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Why the code was not used').fill('Finance acceptance received by owner');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm without code', exact: true }).click();
  await expect(page.getByText('Delivered', { exact: true }).first()).toBeVisible();
  await page.goto(`/company/finance/${data.pid}`);
  await expect(page.getByRole('heading', { name: 'P08 Shop', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'OPEN', exact: true })).toBeVisible();
  const initial = await request<{ balance: string }>(page, `/finance/partnerships/${data.pid}`);
  expect(initial.balance).toBe('57.00');
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount', { exact: true }).fill('20');
  await expect(dialog.getByRole('heading', { name: 'FIFO allocation preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'PENDING', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('20.00 TJS · CASH', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'CONFIRMED', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Charges', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'PARTIALLY_PAID', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Statement', exact: true }).click();
  await expect(page.getByText('Opening balance: 0.00 TJS')).toBeVisible();
  await expect(page.getByText('Closing balance: 37.00 TJS')).toBeVisible();
  await page.getByRole('button', { name: 'Adjustments', exact: true }).click();
  await page.getByRole('button', { name: 'New adjustment' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type', { exact: true }).selectOption('CREDIT');
  await dialog.getByLabel('Amount', { exact: true }).fill('7');
  await dialog.getByLabel('Reason', { exact: true }).fill('Delivery fee goodwill credit');
  await expect(dialog.getByText('Balance after approval: 37.00 → 30.00 TJS')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create adjustment' }).click();
  await expect(page.getByRole('cell', { name: 'APPROVED', exact: true })).toBeVisible();
  await page.goto('/company/finance/adjustments');
  await expect(page.getByRole('heading', { name: 'Adjustments', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'P08 Shop', exact: true })).toBeVisible();
  await page.goto('/company/finance');
  await expect(page.getByRole('link', { name: 'P08 Shop', exact: true })).toBeVisible();
  await switchOrg(page, 'P08 Shop');
  await page.goto(`/store/finance/${data.pid}`);
  await expect(page.getByRole('heading', { name: 'P08 Company', exact: true })).toBeVisible();
  expect((await request<{ balance: string }>(page, `/finance/partnerships/${data.pid}`)).balance).toBe('30.00');
  await expect(page.getByRole('button', { name: 'Adjustments', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Report payment' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Record and confirm' })).toHaveCount(0);
  await dialog.getByLabel('Amount', { exact: true }).fill('5');
  await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const courierContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const courier = await courierContext.newPage();
    await login(courier, data.warehouseEmail, true);
    await courier.goto(`/courier/stops/${first.delivery.id}`);
    await expect(courier.getByRole('button', { name: 'I collected cash' })).toBeVisible();
    expect(await courier.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await queue(courier);
    await courierContext.setOffline(true);
    await courier.getByLabel('Amount', { exact: true }).fill('30');
    await courier.getByRole('button', { name: 'I collected cash' }).click();
    await expect(courier.getByText('Cash payment saved for synchronization')).toBeVisible();
    const rows = await queue(courier);
    const cash = rows.find((row) => row.operation_type === 'PAYMENT_RECORD')!;
    expect(cash.payload).toEqual({ amount: '30' });
    await courierContext.setOffline(false);
    await expect.poll(async () => (await queue(courier)).length).toBe(0);
    const replay = await request<{ results: { result_status: string }[] }>(courier, '/courier/sync', 'POST', {
      operations: [
        {
          operation_id: cash.operation_id,
          operation_type: cash.operation_type,
          entity_id: cash.entity_id,
          expected_status: cash.expected_status,
          client_created_at: cash.client_created_at,
          payload: cash.payload,
        },
      ],
    });
    expect(replay.results[0]?.result_status).toBe('DUPLICATE');
  } finally {
    await courierContext.close();
  }
  await switchOrg(page, 'P08 Company');
  await page.goto('/company/finance/payments?status=PENDING');
  await expect(page.getByRole('heading', { name: 'Payments', exact: true })).toBeVisible();
  const cashRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: '30.00 TJS', exact: true }) });
  await cashRow.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(async () => (await request<{ balance: string }>(page, `/finance/partnerships/${data.pid}`)).balance).toBe('0.00');
  await page.goto(`/company/finance/${data.pid}`);
  await page.getByRole('button', { name: 'Charges', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'PAID', exact: true })).toBeVisible();
  await switchOrg(page, 'P08 Shop');
  await page.goto(`/store/finance/${data.pid}`);
  await page.getByRole('button', { name: 'Statement', exact: true }).click();
  await expect(page.getByText('Closing balance: 0.00 TJS')).toBeVisible();
});
