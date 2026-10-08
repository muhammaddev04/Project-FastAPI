import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect as baseExpect, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 30_000 });
const sessions = new WeakMap<Page, Record<string, string>>();
export function seed() {
  const email = `p08-${randomUUID()}@example.tj`;
  const warehouseEmail = `p08-warehouse-${randomUUID()}@example.tj`;
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
        owner=User(email=sys.argv[1],full_name='P08 Owner',language='en',email_verified_at=utcnow(),password_hash=hash_password('P00Demo2026!'))
        worker=User(email=sys.argv[2],full_name='P08 Warehouse',language='en',email_verified_at=utcnow(),password_hash=hash_password('P00Demo2026!'))
        session.add_all([owner,worker]); await session.flush()
        company=await create_organization(session,owner,'COMPANY',CompanyCreate(name='P08 Company',legal_name='P08 Company',tax_identifier=sys.argv[3],phone='+992901234567',city='Dushanbe',address='Rudaki 7'))
        store=await create_organization(session,owner,'STORE',StoreCreate(name='P08 Shop',legal_name='P08 Shop',phone='+992901234568',city='Dushanbe',address='Rudaki 8'))
        cp=await session.get(Company,company.organization.id); cp.verification_status='APPROVED'; cp.verified_at=utcnow()
        sp=await session.get(Store,store.organization.id); sp.verification_status='APPROVED'; sp.verified_at=utcnow()
        session.add(Membership(user_id=worker.id,organization_id=cp.id,role='COURIER',joined_at=utcnow()))
        price_list=PriceList(company_id=cp.id,code='DEFAULT',name='P08 standard',is_default=True)
        session.add(price_list); await session.flush()
        partner=Partnership(company_id=cp.id,store_id=sp.id,status='ACTIVE',initiated_by_side='COMPANY',initiated_by=owner.id,activated_at=utcnow())
        session.add(partner); await session.flush()
        session.add(PartnershipTerms(partnership_id=partner.id,version_no=1,price_list_id=price_list.id,credit_limit=Decimal('500'),credit_days=14,payment_methods=['CASH'],minimum_order_amount=Decimal('20'),delivery_fee=Decimal('7'),free_delivery_threshold=Decimal('100'),return_days=14,dispute_window_hours=48,effective_from=utcnow()-timedelta(minutes=5),created_by=owner.id))
        product=Product(company_id=cp.id,sku='P08-TEA',name='P08 Tea',base_unit='PCS',created_by=owner.id)
        session.add(product); await session.flush()
        unit=ProductUnit(product_id=product.id,code='PCS',name={'en':'Piece','tg':'Dona','ru':'Shtuka'},coefficient=Decimal('1'),is_base=True,allow_fraction=False,min_order_qty=Decimal('1'))
        session.add(unit); session.add(Stock(product_id=product.id,company_id=cp.id)); await session.flush()
        session.add(Price(price_list_id=price_list.id,product_unit_id=unit.id,price=Decimal('10'),valid_from=utcnow()-timedelta(days=1),created_by=owner.id))
        await stock_service.receive(session,cp.id,[(product.id,Decimal('100'))],owner.id)
        print(json.dumps({'pid':str(partner.id),'product':str(product.id),'unit':str(unit.id)}))
asyncio.run(seed())`,
      email,
      warehouseEmail,
      String(Date.now()).slice(-12),
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return { email, warehouseEmail, ...(JSON.parse(output.trim().split('\n').at(-1)!) as { pid: string; product: string; unit: string }) };
}
export async function login(page: Page, email: string, courier = false) {
  if (!sessions.has(page)) {
    sessions.set(page, {});
    page.on('request', (request) => {
      const headers = request.headers();
      const current = sessions.get(page)!;
      if (headers.authorization) current.Authorization = headers.authorization;
      if (headers['x-org-id']) current['X-Org-Id'] = headers['x-org-id'];
      if (headers['x-courier-cache-scope']) current['X-Courier-Cache-Scope'] = headers['x-courier-cache-scope'];
    });
  }
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
  if (courier) await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  else await expect(page.getByRole('button', { name: 'Switch organization' })).toBeVisible();
}
export async function switchOrg(page: Page, name: string) {
  await page.getByRole('button', { name: 'Switch organization' }).click();
  await page.getByRole('menuitem').filter({ hasText: name }).click();
  await expect(page.getByRole('button', { name: 'Switch organization' })).toContainText(name);
}

export async function request<T>(page: Page, path: string, method = 'GET', body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ path, method, body, headers }) => {
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json', 'Accept-Language': 'en', 'Idempotency-Key': crypto.randomUUID() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const answer = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(answer));
      return answer;
    },
    { path, method, body, headers: sessions.get(page) ?? {} },
  );
}

export type Order = { id: string; version: number; status: string; items: { id: string }[] };
export type Delivery = { id: string; order_id: string; status: string; version: number };
export async function ready(page: Page, data: ReturnType<typeof seed>) {
  let order = await request<Order>(page, '/orders', 'POST', {
    partnership_id: data.pid,
    items: [{ product_unit_id: data.unit, quantity: '5' }],
  });
  order = await request<Order>(page, `/orders/${order.id}/confirm`, 'POST', {
    version: order.version,
    lines: [{ item_id: order.items[0]!.id, confirmed_quantity: '5' }],
  });
  for (const action of ['start-assembling', 'mark-ready'])
    order = await request<Order>(page, `/orders/${order.id}/${action}`, 'POST', { version: order.version });
  const rows = await request<{ results: Delivery[] }>(page, '/deliveries?limit=100');
  return { order, delivery: rows.results.find((row) => row.order_id === order.id)! };
}

export async function queue(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/features/delivery/offline-queue.ts';
    const { operations } = await import(/* @vite-ignore */ modulePath);
    return operations() as Promise<
      {
        operation_id: string;
        operation_type: string;
        entity_id: string;
        expected_status: string;
        client_created_at: string;
        status: string;
        sealed_code?: unknown;
        payload: unknown;
      }[]
    >;
  });
}
