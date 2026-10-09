import { expect as baseExpect, test } from '@playwright/test';
import { seed, login, switchOrg, request, ready } from './business-fixture';

const expect = baseExpect.configure({ timeout: 30_000 });
type Case = { id: string; status: string; credit_note_id?: string; total_credit?: string };

test('P10 return credit, damaged goods, private dispute evidence and owner resolution', async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(30_000);
  if (!process.env.P10_COMPOSE_PROJECT) throw new Error('Run with python scripts/check_p10_browser.py for isolated acceptance');
  const data = seed();
  await login(page, data.email);
  await switchOrg(page, 'P08 Company');
  const first = await ready(page, data);
  await page.goto('/company/delivery');
  await page.getByRole('combobox', { name: 'Courier', exact: true }).selectOption({ label: 'P08 Warehouse' });
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await page.getByRole('link', { name: /P08 Warehouse/ }).click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByText('On the way', { exact: true }).first()).toBeVisible();
  await request(page, `/deliveries/${first.delivery.id}/manual-confirm`, 'POST', { reason: 'Signed handover confirmed by shop owner.' });

  await switchOrg(page, 'P08 Shop');
  await page.goto(`/store/orders/${first.order.id}`);
  await page.getByRole('button', { name: 'Return goods', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/P08 Tea.*max/).fill('6');
  await expect(dialog.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
  await dialog.getByLabel(/P08 Tea.*max/).fill('2');
  await dialog.getByRole('button', { name: 'Review', exact: true }).click();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/store\/returns\//);
  const returnId = new URL(page.url()).pathname.split('/').at(-1)!;
  await switchOrg(page, 'P08 Company');
  await page.goto(`/company/returns/${returnId}`);
  await expect(page.getByRole('heading', { name: 'Approve', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Receive', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Complete', exact: true })).toBeVisible();
  await page.getByLabel('Back to stock', { exact: true }).fill('0');
  await expect(page.getByText(/Total credit: 20.00 TJS/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm the credit', exact: true }).click();
  await expect.poll(async () => (await request<Case>(page, `/returns/${returnId}`)).status).toBe('COMPLETED');
  const completed = await request<Case>(page, `/returns/${returnId}`);
  expect(completed.credit_note_id).toBeTruthy();
  expect(completed.total_credit).toBe('20.00');
  expect((await request<{ balance: string }>(page, `/finance/partnerships/${data.pid}`)).balance).toBe('37.00');

  await switchOrg(page, 'P08 Shop');
  await page.goto(`/store/orders/${first.order.id}`);
  await page.getByRole('button', { name: /^Dispute/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Description', { exact: true }).fill('Two pieces arrived damaged; please review the evidence.');
  await dialog
    .getByLabel('Add evidence', { exact: true })
    .setInputFiles({ name: 'evidence.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nSigned evidence') });
  await expect(dialog.getByText('evidence.pdf', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/store\/disputes\//);
  const disputeId = new URL(page.url()).pathname.split('/').at(-1)!;
  await switchOrg(page, 'P08 Company');
  await page.goto(`/company/disputes/${disputeId}`);
  await expect(page.getByRole('button', { name: 'Open the file', exact: true })).toBeVisible();
  await page.getByLabel('Message', { exact: true }).fill('Evidence reviewed with the courier.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Evidence reviewed with the courier.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Take it on', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Take it on', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Outcome', exact: true }).selectOption('ADJUSTMENT_CREDIT');
  await dialog.getByLabel(/^Amount/).fill('7');
  await dialog.getByLabel('Why', { exact: true }).fill('Goodwill credit for damaged delivery.');
  await expect(dialog.getByText('Balance after the credit: 30.00 TJS', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(async () => (await request<Case>(page, `/disputes/${disputeId}`)).status).toBe('RESOLVED');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await switchOrg(page, 'P08 Shop');
  await page.goto(`/store/disputes/${disputeId}`);
  await expect(page.getByText('Evidence reviewed with the courier.', { exact: true })).toBeVisible();
  expect((await request<{ balance: string }>(page, `/finance/partnerships/${data.pid}`)).balance).toBe('30.00');
});
