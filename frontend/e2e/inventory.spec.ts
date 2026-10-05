import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

function fixture(script: string, ...args: string[]) {
  return execFileSync(
    'docker',
    [
      'compose',
      '-p',
      'tezfarmo-p00',
      '-f',
      resolve('../docker-compose.p00.yml'),
      'exec',
      '-T',
      'backend',
      'python',
      '-c',
      `from app.core.config import get_settings
assert get_settings().app_env == 'development' and get_settings().database_url.endswith('/tezfarmo_p00')
${script}`,
      ...args,
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
}
function seed() {
  const email = `p05-${randomUUID()}@example.tj`;
  fixture(
    `import asyncio, sys
import app.model_registry
from app.core.db import get_sessionmaker
from app.core.security import hash_password
from app.core.time import utcnow
from app.modules.identity.models import User
from app.modules.organizations.models import Company
from app.modules.organizations.schemas import CompanyCreate
from app.modules.organizations.service import create_organization
from app.modules.organizations.ports import install_handlers
from app.modules.subscriptions.service import install
install_handlers(); install()
async def seed():
    async with get_sessionmaker().begin() as session:
        user=User(email=sys.argv[1],full_name='P05 Owner',language='en',email_verified_at=utcnow(),password_hash=hash_password('P00Demo2026!'))
        session.add(user); await session.flush()
        result=await create_organization(session,user,'COMPANY',CompanyCreate(name='P05 Inventory Acceptance',legal_name='P05 LLC',tax_identifier=sys.argv[2],phone='+992901234567',city='Dushanbe',address='Rudaki 5'))
        company=await session.get(Company,result.organization.id)
        company.verification_status='APPROVED'; company.verified_at=utcnow()
asyncio.run(seed())`,
    email,
    String(Date.now()).slice(-12),
  );
  return email;
}

test('P05 stock receipt, low stock, count, write-off, movements and asynchronous stock import', async ({ page }) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(15000);
  const email = seed();
  await page.addInitScript(() => localStorage.setItem('tezfarmo.language', 'en'));
  await page.goto('/login');
  await page.getByLabel(/^email/i).fill(email);
  await page.getByLabel(/^password/i).fill('P00Demo2026!');
  await page.getByRole('button', { name: 'Login now', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto('/company/catalog/products/new');
  await page.getByLabel('SKU', { exact: true }).fill('MILK');
  await page.getByLabel('Name', { exact: true }).fill('Inventory milk');
  await page.getByLabel('Barcode', { exact: true }).fill('1234567890123');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/company\/catalog\/products\/[a-f0-9-]+$/);
  const productId = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('button', { name: 'Units', exact: true }).click();
  await page.getByRole('button', { name: 'Add unit', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (tg)').fill('Қуттӣ');
  await dialog.getByLabel('Name (ru)').fill('Коробка');
  await dialog.getByLabel('Name (en)').fill('Box');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Box · 1 BOX24/)).toBeVisible();
  await page.goto('/company/warehouse/receipts/new');
  const scanner = page.getByLabel('Search name, SKU or barcode');
  await scanner.fill('1234567890123');
  await scanner.press('Enter');
  await page.getByRole('combobox', { name: 'Unit code', exact: true }).selectOption({ label: 'BOX24' });
  await page.getByLabel('On hand', { exact: true }).fill('24');
  await expect(page.getByText('+24 BOX24 = +576.000 PCS', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page).toHaveURL(/\/company\/warehouse\/stock$/);
  await page.getByRole('link', { name: 'Inventory milk · MILK', exact: true }).click();
  await expect(page.getByText('576.000 PCS', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Low stock threshold').fill('600');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inventory count', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Actual quantity in base units').fill('500');
  await dialog.getByLabel('Reason (at least 5 characters)').fill('Actual stock count');
  await expect(dialog.getByText('Quantity change: -76.000 PCS')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('500.000 PCS', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Write off', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Unit code', exact: true }).selectOption({ label: 'BOX24' });
  await dialog.getByLabel('On hand', { exact: true }).fill('1');
  await dialog.getByLabel('Reason (at least 5 characters)').fill('Damaged box');
  await expect(dialog.getByText('Quantity change: -24.000 PCS')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('476.000 PCS', { exact: true }).first()).toBeVisible();
  await page.goto('/company/warehouse/stock');
  await page.getByRole('checkbox', { name: 'Low stock only' }).check();
  await expect(page.getByRole('link', { name: 'Inventory milk · MILK' })).toBeVisible();
  await page.goto('/company/warehouse/movements');
  await page.getByLabel('Movement type').selectOption('WRITE_OFF');
  await expect(page.getByText('Damaged box', { exact: true })).toBeVisible();
  const workbook = Buffer.from(
    fixture(`import base64
from io import BytesIO
from openpyxl import Workbook
book=Workbook(); book.active.append(['sku','unit_code','quantity','note']); book.active.append(['MILK','PCS',2,'Imported receipt'])
data=BytesIO(); book.save(data); print(base64.b64encode(data.getvalue()).decode())`).trim(),
    'base64',
  );
  await page.goto('/company/imports/new');
  await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('STOCK');
  await page
    .getByLabel('File', { exact: true })
    .setInputFiles({ name: 'stock.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.goto(`/company/warehouse/stock/${productId}`);
  await expect(page.getByText('478.000 PCS', { exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Inventory milk' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
