import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect as baseExpect, test, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 30000 });

function seed() {
  const email = `p06-${randomUUID()}@example.tj`;
  const output = execFileSync(
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
      `import asyncio, sys, json
import app.model_registry
from app.core.config import get_settings
assert get_settings().app_env == 'development' and get_settings().database_url.endswith('/tezfarmo_p00')
from app.core.db import get_sessionmaker
from app.core.security import hash_password
from app.core.time import utcnow
from app.modules.identity.models import User
from app.modules.organizations.models import Company, Store
from app.modules.organizations.schemas import CompanyCreate, StoreCreate
from app.modules.organizations.service import create_organization
from app.modules.organizations.ports import install_handlers
from app.modules.subscriptions.service import install
from app.modules.catalog.models import PriceList
install_handlers(); install()
async def seed():
    async with get_sessionmaker().begin() as session:
        user=User(email=sys.argv[1],full_name='P06 Owner',language='en',email_verified_at=utcnow(),password_hash=hash_password('P00Demo2026!'))
        session.add(user); await session.flush()
        result={}
        for index in range(2):
            suffix=str(index+1)
            company=await create_organization(session,user,'COMPANY',CompanyCreate(name='P06 Company '+suffix,legal_name='P06 Company '+suffix,tax_identifier=str(int(sys.argv[2])+index),phone='+992901234567',city='Dushanbe',address='Rudaki 6'))
            profile=await session.get(Company,company.organization.id)
            profile.verification_status='APPROVED'; profile.verified_at=utcnow()
            session.add(PriceList(company_id=profile.id,code='DEFAULT',name='P06 standard',is_default=True))
            result['company'+suffix]=str(profile.id); result['code'+suffix]=profile.public_code
            store=await create_organization(session,user,'STORE',StoreCreate(name='P06 Shop '+suffix,legal_name='P06 Shop '+suffix,phone='+992'+str(900000000+int(sys.argv[2][-7:])+index),city='Dushanbe',address='Rudaki 7',latitude='38.560000',longitude='68.770000'))
            shop=await session.get(Store,store.organization.id)
            shop.verification_status='APPROVED'; shop.verified_at=utcnow()
            result['store'+suffix]=str(shop.id); result['phone'+suffix]=shop.phone
        print(json.dumps(result))
asyncio.run(seed())`,
      email,
      String(Date.now()).slice(-12),
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  return { email, ...(JSON.parse(output.trim().split('\n').at(-1)!) as Record<string, string>) };
}

async function switchOrg(page: Page, name: string) {
  await page.getByRole('button', { name: 'Switch organization' }).click();
  await page.getByRole('menuitem').filter({ hasText: name }).click();
  await expect(page.getByRole('button', { name: 'Switch organization' })).toContainText(name);
}

test('P06 both invitation directions, immutable future terms, suspension, termination and mobile', async ({ page }) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(15000);
  const data = seed();
  await page.addInitScript(() => localStorage.setItem('tezfarmo.language', 'en'));
  await page.goto('/login');
  await page.getByLabel(/^email/i).fill(data.email);
  await page.getByLabel(/^password/i).fill('P00Demo2026!');
  await page.getByRole('button', { name: 'Login now', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await switchOrg(page, 'P06 Company 1');
  await page.goto('/company/partners');
  await page.getByRole('button', { name: 'Invite store', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Phone', { exact: true }).fill(data.phone1!);
  await dialog.getByRole('button', { name: 'Find store' }).click();
  await dialog.getByRole('button', { name: 'P06 Shop 1 · Dushanbe' }).click();
  await dialog.getByLabel('Customer code').fill('P06-SHOP');
  await dialog.getByRole('combobox', { name: 'Price list', exact: true }).selectOption({ label: 'P06 standard' });
  await dialog.getByLabel('Credit limit').fill('500');
  await dialog.getByLabel('Credit days').fill('14');
  await dialog.getByRole('button', { name: 'Preview terms' }).click();
  await expect(dialog.getByText('500', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Invite store', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('link', { name: 'P06 Shop 1', exact: true }).click();
  const companyPath = new URL(page.url()).pathname;
  const pid = companyPath.split('/').at(-1)!;
  await expect(page.getByRole('link', { name: 'Open in maps' })).toBeVisible();
  await switchOrg(page, 'P06 Shop 1');
  await page.goto('/store/suppliers?tab=invitations');
  await page.getByRole('link', { name: 'P06 Company 1', exact: true }).click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('500.00', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Terminate', exact: true })).toBeVisible();
  await switchOrg(page, 'P06 Company 1');
  await page.goto(companyPath);
  await page.getByRole('button', { name: 'New terms version' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Credit limit').fill('700');
  const future = new Date(Date.now() + 86400000);
  const date = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await dialog.getByLabel('Effective from').fill(date);
  await dialog.getByRole('button', { name: 'Preview terms' }).click();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Future terms' })).toBeVisible();
  await page.getByRole('button', { name: 'Suspend', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason').fill('Temporary review');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Reactivate', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'P06 Shop 1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await switchOrg(page, 'P06 Shop 1');
  await page.goto(`/store/suppliers/${pid}`);
  await page.getByRole('button', { name: 'Terminate', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Contract ended');
  await dialog.getByLabel('Type P06 Company 1 to confirm').fill('P06 Company 1');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Terms history' })).toBeVisible();
  await switchOrg(page, 'P06 Shop 2');
  await page.goto('/store/suppliers');
  await page.getByRole('button', { name: 'Request partnership', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Company public code (8 characters)').fill(data.code2!);
  await dialog.getByRole('button', { name: 'Request partnership', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await switchOrg(page, 'P06 Company 2');
  await page.goto('/company/partners');
  await page.getByRole('link', { name: 'P06 Shop 2', exact: true }).click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Price list', exact: true }).selectOption({ label: 'P06 standard' });
  await dialog.getByRole('button', { name: 'Preview terms' }).click();
  await dialog.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible();
});
