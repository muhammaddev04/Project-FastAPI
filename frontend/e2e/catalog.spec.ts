import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

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
    { timeout: 30_000, encoding: 'utf8' },
  );
}

function seed() {
  const email = `p04-${randomUUID()}@example.tj`;
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
        user = User(email=sys.argv[1], full_name='P04 Owner', language='en', email_verified_at=utcnow(), password_hash=hash_password('P00Demo2026!'))
        session.add(user); await session.flush()
        result = await create_organization(session, user, 'COMPANY', CompanyCreate(name='P04 Catalog Acceptance', legal_name='P04 LLC', tax_identifier=sys.argv[2], phone='+992901234567', city='Dushanbe', address='Rudaki 4'))
        company = await session.get(Company, result.organization.id)
        company.verification_status='APPROVED'; company.verified_at=utcnow()
asyncio.run(seed())`,
    email,
    String(Date.now()).slice(-12),
  );
  return email;
}

function workbook(sku: string, unit: string) {
  return Buffer.from(
    fixture(
      `import base64, sys
from io import BytesIO
from openpyxl import Workbook
from app.modules.catalog.imports import HEADERS
book=Workbook(); sheet=book.active
sheet.append(HEADERS['PRODUCTS']['en'])
sheet.append([sys.argv[1], 'Imported coffee', 'Drinks', None, 'Imported via browser', sys.argv[2], True])
data=BytesIO(); book.save(data)
print(base64.b64encode(data.getvalue()).decode())`,
      sku,
      unit,
    ).trim(),
    'base64',
  );
}

test('P04 company products, units, price preview and asynchronous Excel import', async ({ page }) => {
  test.setTimeout(240_000);
  const email = seed();
  await page.addInitScript(() => localStorage.setItem('tezfarmo.language', 'en'));
  await page.goto('/login');
  await page.getByLabel(/^email/i).fill(email);
  await page.getByLabel(/^password/i).fill('P00Demo2026!');
  await page.getByRole('button', { name: 'Login now', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto('/company/catalog/products/new');
  await page.getByLabel('SKU', { exact: true }).fill('TEA');
  await page.getByLabel('Name', { exact: true }).fill('Acceptance tea');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/company\/catalog\/products\/[a-f0-9-]+$/);
  await page.getByRole('button', { name: 'Units', exact: true }).click();
  await page.getByRole('button', { name: 'Add unit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (tg)').fill('Қуттӣ');
  await dialog.getByLabel('Name (ru)').fill('Коробка');
  await dialog.getByLabel('Name (en)').fill('Box');
  await expect(dialog.getByText('1 BOX24 = 24 PCS', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Box · 1 BOX24/)).toBeVisible();
  await page.goto('/company/pricing/lists');
  await page.getByRole('link', { name: 'Default (Default)', exact: true }).click();
  const price = page.getByRole('spinbutton', { name: 'Price TEA PCS', exact: true });
  await price.fill('10');
  await page.getByRole('button', { name: 'Preview (1)' }).click();
  await expect(page.getByText(/TEA · PCS: — → 10 TJS/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(price).toHaveValue('10.00');
  await page.goto('/company/imports/new');
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'valid.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook('COFFEE', 'PCS'),
  });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText('Validated', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Categories to create: Drinks')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Created: 1', { exact: true })).toBeVisible();
  await page.goto('/company/catalog/products');
  await expect(page.getByRole('link', { name: 'Imported coffee', exact: true })).toBeVisible();
  await page.goto('/company/imports/new');
  await page.getByLabel('File', { exact: true }).setInputFiles({
    name: 'invalid.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook('TEA', 'KG'),
  });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText('Validated', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await expect(page.getByText('The base unit cannot change after use or pricing.')).toBeVisible();
});
