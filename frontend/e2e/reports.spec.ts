import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { login, ready, request, seed, switchOrg } from './business-fixture';

const expect = baseExpect.configure({ timeout: 30_000 });

/** The platform administrator is created the way production creates one: through the CLI, never through the API. */
function createSuperadmin(email: string) {
  const project = process.env.P12_COMPOSE_PROJECT ?? process.env.P10_COMPOSE_PROJECT ?? 'tezfarmo-p00';
  const override = process.env.P12_COMPOSE_OVERRIDE ?? process.env.P10_COMPOSE_OVERRIDE;
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      project,
      '-f',
      resolve('../docker-compose.p00.yml'),
      ...(override ? ['-f', override] : []),
      'exec',
      '-T',
      'backend',
      'python',
      '-m',
      'app.cli',
      'create-superadmin',
      '--email',
      email,
      '--full-name',
      'P12 Platform Admin',
    ],
    { encoding: 'utf8', timeout: 60_000, input: 'P00Demo2026!\nP00Demo2026!\n' },
  );
}

async function exportReady(page: Page, kind: string) {
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  await page.getByRole('link', { name: 'Exports', exact: true }).first().click();
  await expect(page).toHaveURL(/\/exports$/);
  const row = page.getByRole('row').filter({ hasText: kind });
  // EXP-001 answers 202 and the worker writes the file; the list polls until it is ready.
  await expect(row.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 });
  return row;
}

async function verifyReportLatency(page: Page) {
  const reports = await request<{ code: string }[]>(page, '/reports');
  for (const report of reports) {
    const elapsed: number[] = [];
    for (let sample = 0; sample < 20; sample++) {
      // Pace the benchmark below the authenticated rate limit, including background UI reads.
      await new Promise((resolve) => setTimeout(resolve, 600));
      const started = performance.now();
      await request(page, `/reports/${report.code}`);
      elapsed.push(performance.now() - started);
    }
    const p95 = elapsed.sort((a, b) => a - b)[18]!;
    console.log(`RPT-004 ${report.code}: fixture p95=${p95.toFixed(1)}ms (20 requests)`);
    expect(p95, report.code).toBeLessThanOrEqual(2000);
  }
}

test('P12 reports match the delivered order, export to a signed file and feed both dashboards', async ({ page }) => {
  test.setTimeout(420_000);
  page.setDefaultTimeout(30_000);
  if (!process.env.P12_COMPOSE_PROJECT) throw new Error('Run with python scripts/check_p12_browser.py');
  const data = seed();
  const adminEmail = `p12-admin-${randomUUID()}@example.tj`;
  createSuperadmin(adminEmail);

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
  await request(page, `/deliveries/${first.delivery.id}/manual-confirm`, 'POST', {
    reason: 'Signed handover confirmed by shop owner.',
  });

  // §1.3: the dashboard shows the day's figures, not a placeholder.
  await page.goto('/company');
  await expect(page.getByText('Sales this month', { exact: true })).toBeVisible();
  await expect(page.getByText('57.00 TJS', { exact: true }).first()).toBeVisible();

  // §1.2 sales_summary: five pieces at 10.00 plus the 7.00 delivery fee of the frozen terms.
  await page.goto('/company/reports');
  await page.getByRole('link', { name: 'Open', exact: true }).first().click();
  await expect(page).toHaveURL(/\/company\/reports\/[a-z_]+$/);
  await page.goto('/company/reports/sales_summary');
  await expect(page.getByRole('heading', { name: 'Sales by period' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '57.00' }).first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Sales by period' })).toBeVisible();

  // RPT-003: a window wider than 366 days is refused rather than silently narrowed.
  await page.getByLabel('From', { exact: true }).fill('2024-01-01');
  await expect(page.getByText(/at most 366|366/).first()).toBeVisible();
  await page.getByLabel('From', { exact: true }).fill(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(new Date()));

  // EXP-001..003: request, wait, download through a signed URL.
  const row = await exportReady(page, 'Sales by period');
  const download = page.waitForResponse(
    (response) => response.url().includes('/exports/') && response.url().endsWith('/download') && response.status() === 200,
  );
  await row.getByRole('button', { name: 'Download', exact: true }).click();
  const link = (await (await download).json()) as { url: string };
  expect(link.url).toMatch(/\/api\/v1\/files\/content\/.*signature=/);
  const file = await page.request.get(link.url);
  expect(file.ok()).toBe(true);
  const csv = await file.body();
  expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(csv.toString('utf8')).toContain(';');
  expect(csv.toString('utf8')).toContain('57.00');

  // RPT-001: the store side sees its own reports only.
  await switchOrg(page, 'P08 Shop');
  await page.goto('/store');
  await expect(page.getByText('Total debt', { exact: true })).toBeVisible();
  await page.goto('/store/reports');
  await expect(page.getByRole('heading', { name: 'Purchases by company', exact: true })).toBeVisible();
  await expect(page.getByText('Sales by period')).toHaveCount(0);
  await page.goto('/store/reports/store_debt');
  await expect(page.getByRole('cell', { name: '57.00' }).first()).toBeVisible();

  // §3: the platform panel, its audit trail and the reason every change carries.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('tezfarmo.language', 'en');
  });
  const adminLogin = await page.request.post('/api/v1/auth/login', { data: { email: adminEmail, password: 'P00Demo2026!' } });
  expect(adminLogin.ok()).toBe(true);
  await page.goto('/admin/dashboard');
  await expect(page.getByText('Active companies', { exact: true })).toBeVisible();
  await page.goto('/admin/organizations');
  await page.getByText('P08 Shop', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Suspend', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox').fill('Owner asked support to pause the shop');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Suspended', { exact: true })).toBeVisible();

  await page.goto('/admin/audit');
  await expect(page.getByText('organization.suspended', { exact: true }).first()).toBeVisible();
  await page.getByText('organization.suspended', { exact: true }).click();
  await expect(page.getByRole('dialog').getByText(/Owner asked support to pause the shop/)).toBeVisible();
  await expect(page.getByText('Platform admin', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await page.goto('/admin/outbox');
  await expect(page.getByRole('heading', { name: 'Outbox' })).toBeVisible();
  await page.goto('/admin/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await page.goto('/admin/reconciliation');
  await expect(page.getByRole('heading', { name: 'Reconciliation' })).toBeVisible();

  // ADM-010: reading a tenant's orders needs a reason, and the read itself is audited.
  await page.goto('/admin/organizations');
  await page.getByText('P08 Company', { exact: true }).first().click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('button', { name: 'Show orders', exact: true })).toBeDisabled();
  await detail.getByPlaceholder(/At least 10 characters/).fill('Support ticket 4821');
  await detail.getByRole('button', { name: 'Show orders', exact: true }).click();
  await expect(detail.getByText(/ORD-/).first()).toBeVisible();
  await detail.getByLabel('Partnership ID').fill(data.pid);
  await detail.getByRole('button', { name: 'Show statement', exact: true }).click();
  await expect(detail.getByText('Closing balance: 57.00 TJS')).toBeVisible();
  await page.goto('/admin/audit');
  await page.getByRole('textbox').nth(2).fill('admin.viewed');
  await expect(page.getByText('admin.viewed', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const adminDownload = page.getByRole('button', { name: 'Download', exact: true });
  await expect(adminDownload).toBeEnabled({ timeout: 60_000 });
  const adminLinkResponse = page.waitForResponse(
    (response) => response.url().includes('/admin/exports/') && response.url().endsWith('/download') && response.ok(),
  );
  await adminDownload.click();
  const adminLink = (await (await adminLinkResponse).json()) as { url: string };
  const auditFile = await page.request.get(adminLink.url);
  expect(auditFile.ok()).toBe(true);
  const auditCsv = (await auditFile.body()).toString('utf8');
  expect(auditCsv).toContain('admin.viewed');
  expect(auditCsv).not.toContain('user.blocked');
  expect(auditCsv).not.toContain('export.requested');

  // Phone, tablet and desktop: the reports table and the admin tables stay usable.
  for (const size of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  await login(page, data.email);
  await switchOrg(page, 'P08 Company');
  for (const size of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/company/reports/sales_summary');
    await expect(page.getByRole('heading', { name: 'Sales by period', exact: true })).toBeVisible();
    await expect(page.getByText('57.00', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  await verifyReportLatency(page);
  await switchOrg(page, 'P08 Shop');
  await verifyReportLatency(page);
});
