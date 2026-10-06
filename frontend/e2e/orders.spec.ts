import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect as baseExpect, test, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 30_000 });
function seed() {
  const email = `p07-${randomUUID()}@example.tj`;
  const warehouseEmail = `p07-warehouse-${randomUUID()}@example.tj`;
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
from decimal import Decimal
from datetime import timedelta
from sqlalchemy import select
import app.model_registry
from app.core.config import get_settings
assert get_settings().app_env == 'development' and get_settings().database_url.endswith('/tezfarmo_p00')
from app.core.db import get_sessionmaker
from app.core.security import hash_password
from app.core.time import utcnow
from app.modules.identity.models import User, Membership
from app.modules.organizations.models import Company, Store
from app.modules.organizations.schemas import CompanyCreate, StoreCreate
from app.modules.organizations.service import create_organization
from app.modules.organizations.ports import install_handlers
from app.modules.subscriptions.service import install
from app.modules.catalog.models import PriceList, Product, ProductUnit, Price
from app.modules.inventory.models import Stock
from app.modules.inventory.service import stock_service
from app.modules.partnerships.models import Partnership, PartnershipTerms
install_handlers(); install()
async def seed():
    async with get_sessionmaker().begin() as session:
        owner=User(email=sys.argv[1],full_name='P07 Owner',language='en',email_verified_at=utcnow(),password_hash=hash_password('P00Demo2026!'))
        worker=User(email=sys.argv[2],full_name='P07 Warehouse',language='en',email_verified_at=utcnow(),password_hash=hash_password('P00Demo2026!'))
        session.add_all([owner,worker]); await session.flush()
        company=await create_organization(session,owner,'COMPANY',CompanyCreate(name='P07 Company',legal_name='P07 Company',tax_identifier=sys.argv[3],phone='+992901234567',city='Dushanbe',address='Rudaki 7'))
        store=await create_organization(session,owner,'STORE',StoreCreate(name='P07 Shop',legal_name='P07 Shop',phone='+992901234568',city='Dushanbe',address='Rudaki 8'))
        cp=await session.get(Company,company.organization.id); cp.verification_status='APPROVED'; cp.verified_at=utcnow()
        sp=await session.get(Store,store.organization.id); sp.verification_status='APPROVED'; sp.verified_at=utcnow()
        session.add(Membership(user_id=worker.id,organization_id=cp.id,role='WAREHOUSE',joined_at=utcnow()))
        price_list=PriceList(company_id=cp.id,code='DEFAULT',name='P07 standard',is_default=True)
        session.add(price_list); await session.flush()
        partner=Partnership(company_id=cp.id,store_id=sp.id,status='ACTIVE',initiated_by_side='COMPANY',initiated_by=owner.id,activated_at=utcnow())
        session.add(partner); await session.flush()
        session.add(PartnershipTerms(partnership_id=partner.id,version_no=1,price_list_id=price_list.id,credit_limit=Decimal('500'),credit_days=14,payment_methods=['CASH'],minimum_order_amount=Decimal('20'),delivery_fee=Decimal('7'),free_delivery_threshold=Decimal('100'),return_days=14,dispute_window_hours=48,effective_from=utcnow()-timedelta(minutes=5),created_by=owner.id))
        product=Product(company_id=cp.id,sku='P07-TEA',name='P07 Tea',base_unit='PCS',created_by=owner.id)
        session.add(product); await session.flush()
        unit=ProductUnit(product_id=product.id,code='PCS',name={'en':'Piece','tg':'Dona','ru':'Shtuka'},coefficient=Decimal('1'),is_base=True,allow_fraction=False,min_order_qty=Decimal('1'))
        session.add(unit); session.add(Stock(product_id=product.id,company_id=cp.id)); await session.flush()
        session.add(Price(price_list_id=price_list.id,product_unit_id=unit.id,price=Decimal('10'),valid_from=utcnow()-timedelta(days=1),created_by=owner.id))
        await stock_service.receive(session,cp.id,[(product.id,Decimal('100'))],owner.id)
        print(json.dumps({'pid':str(partner.id),'product':str(product.id)}))
asyncio.run(seed())`,
      email,
      warehouseEmail,
      String(Date.now()).slice(-12),
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return { email, warehouseEmail, ...(JSON.parse(output.trim().split('\n').at(-1)!) as { pid: string; product: string }) };
}
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('P00Demo2026!');
  await page.getByRole('button', { name: 'Login now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch organization' })).toBeVisible();
}
async function switchOrg(page: Page, name: string) {
  await page.getByRole('button', { name: 'Switch organization' }).click();
  await page.getByRole('menuitem').filter({ hasText: name }).click();
  await expect(page.getByRole('button', { name: 'Switch organization' })).toContainText(name);
}

test('P07 store checkout, partial confirmation, warehouse assembly, cancellation, repeat and on-behalf', async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const data = seed();
  await login(page, data.email);
  await switchOrg(page, 'P07 Shop');
  await page.goto(`/store/catalog?partnership=${data.pid}`);
  await page.getByRole('spinbutton', { name: 'Quantity · P07 Tea' }).fill('8');
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await page.getByRole('link', { name: /Open cart/ }).click();
  await expect(page.getByText('80.00 TJS', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Review order', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByText('P07 Tea · 8.000 PCS · 80.00')).toBeVisible();
  await dialog.getByRole('button', { name: 'Send order', exact: true }).click();
  await expect(page.getByRole('heading', { name: /ORD-2026-/ })).toBeVisible();
  const oid = new URL(page.url()).pathname.split('/').at(-1)!;
  const number = await page.getByRole('heading', { name: /ORD-2026-/ }).textContent();
  await switchOrg(page, 'P07 Company');
  await page.goto(`/company/orders/${oid}`);
  await expect(page.getByText('Viewed', { exact: true }).first()).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Confirmed quantity · P07 Tea' }).fill('3');
  await page.getByRole('spinbutton', { name: 'Discount', exact: true }).fill('5');
  await page.getByLabel('Discount reason', { exact: true }).fill('Partial delivery promotion');
  await page.getByRole('button', { name: 'Review confirmation' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Total: 32.00 TJS')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start assembling' })).toBeVisible();
  await login(page, data.warehouseEmail);
  await page.goto('/company/warehouse/orders');
  await page.getByRole('link', { name: number!, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start assembling' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Price', exact: true })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('TJS');
  await page.getByRole('button', { name: 'Start assembling' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ready for delivery' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Print pick list' }).click();
  const popup = await popupPromise;
  await expect(popup.getByText('P07 Tea', { exact: true })).toBeVisible();
  await expect(popup.locator('body')).not.toContainText('TJS');
  await popup.close();
  await login(page, data.email);
  await page.goto(`/company/orders/${oid}`);
  await page.getByRole('button', { name: 'Cancel order' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason').fill('Customer postponed delivery');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto(`/company/warehouse/stock/${data.product}`);
  await expect(page.getByText('100.000', { exact: true }).first()).toBeVisible();
  await switchOrg(page, 'P07 Shop');
  await page.goto(`/store/orders/${oid}`);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Repeat order' }).click();
  await page.getByRole('link', { name: 'Open cart', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Quantity · P07 Tea' })).toHaveValue('8.000');
  await page.setViewportSize({ width: 1280, height: 900 });
  await switchOrg(page, 'P07 Company');
  await page.goto('/company/orders/new');
  await page.getByRole('spinbutton', { name: 'Quantity · P07 Tea' }).fill('5');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByRole('button', { name: 'Review order' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send order' }).click();
  await expect(page.getByRole('heading', { name: /ORD-2026-/ })).toBeVisible();
  await page.getByRole('button', { name: 'Reject order' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Reschedule requested');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Rejected', { exact: true }).first()).toBeVisible();
});
