import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

function fixture(script: string, ...args: string[]) {
  const guard = `from app.core.config import get_settings
settings = get_settings()
assert settings.app_env == 'development' and settings.database_url.endswith('/tezfarmo_p00')
`;
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
      guard + script,
      ...args,
    ],
    { timeout: 30_000, encoding: 'utf8' },
  );
}

function seedCompany() {
  const email = `p03-${randomUUID()}@example.tj`;
  const name = `P03 Acceptance ${randomUUID().slice(0, 8)}`;
  const script = `import asyncio, json, sys
import app.model_registry
from app.core.db import get_sessionmaker
from app.core.security import hash_password
from app.core.time import utcnow
from app.modules.identity.models import User
from app.modules.organizations.models import Company
from app.modules.organizations.schemas import CompanyCreate
from app.modules.organizations.service import create_organization
from app.modules.organizations.ports import install_handlers
from app.modules.subscriptions.service import install, get_subscription
install_handlers()
install()
async def seed():
    async with get_sessionmaker().begin() as session:
        user = User(email=sys.argv[1], full_name='P03 Acceptance Owner', language='en', email_verified_at=utcnow(), password_hash=hash_password('P00Demo2026!'))
        session.add(user)
        await session.flush()
        payload = CompanyCreate(name=sys.argv[3], legal_name='P03 Acceptance LLC', tax_identifier=sys.argv[2], phone='+992901234567', city='Dushanbe', address='Acceptance Avenue 3')
        result = await create_organization(session, user, 'COMPANY', payload)
        company = await session.get(Company, result.organization.id)
        company.verification_status = 'APPROVED'
        company.verified_at = utcnow()
        sub = await get_subscription(session, company_id=company.id)
        print(json.dumps({'email': user.email, 'subscription_id': str(sub.id), 'company_name': sys.argv[3]}))
asyncio.run(seed())`;
  return JSON.parse(fixture(script, email, String(Date.now()).slice(-12), name)) as {
    email: string;
    subscription_id: string;
    company_name: string;
  };
}

function expire(subscriptionId: string, field: string) {
  fixture(
    `import asyncio, sys
from datetime import timedelta
from uuid import UUID
import app.model_registry
from app.core.db import get_sessionmaker
from app.core.time import utcnow
from app.modules.subscriptions.service import get_subscription, tick
assert sys.argv[2] in ('trial_ends_at', 'grace_ends_at', 'soft_block_ends_at')
async def expire():
    async with get_sessionmaker().begin() as session:
        sub = await get_subscription(session, subscription_id=UUID(sys.argv[1]), lock=True)
        setattr(sub, sys.argv[2], utcnow() - timedelta(seconds=1))
        await session.flush()
        await tick(session)
asyncio.run(expire())`,
    subscriptionId,
    field,
  );
}

async function login(page: Page, email: string) {
  await page.addInitScript(() => localStorage.setItem('tezfarmo.language', 'en'));
  await page.goto('/login');
  await page.getByLabel(/^email/i).fill(email);
  await page.getByLabel(/^password/i).fill('P00Demo2026!');
  await page.getByRole('button', { name: 'Login now', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

test('P03 trial expiry, block banners, manual renewal, plan request and public plan management', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const company = seedCompany();
  await login(page, company.email);
  await page.goto('/company/settings/subscription');
  await expect(page.getByText('Trial', { exact: true })).toBeVisible();
  await expect(page.getByText('Users: 1 / 15')).toBeVisible();
  expire(company.subscription_id, 'trial_ends_at');
  await page.reload();
  await expect(page.getByText('Renew your subscription before the grace period ends.')).toBeVisible();
  expire(company.subscription_id, 'grace_ends_at');
  await page.goto('/company/team');
  await expect(
    page.getByText('New orders, partnerships and invitations are blocked. Existing order fulfillment remains available.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite member', exact: true })).toBeDisabled();
  expire(company.subscription_id, 'soft_block_ends_at');
  await page.reload();
  await expect(page.getByText('Full block', { exact: true })).toBeVisible();

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  try {
    await login(admin, 'p00-admin@example.tj');
    await admin.goto(`/admin/subscriptions/${company.subscription_id}`);
    await expect(admin.getByText('Full block', { exact: true }).first()).toBeVisible();
    await admin.getByRole('button', { name: 'Preview payment', exact: true }).click();
    await expect(admin.getByText('Confirm payment of 700.00 TJS.')).toBeVisible();
    await admin.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(admin.getByText('Payment recorded.')).toBeVisible();
    await expect(admin.getByText('Active', { exact: true }).first()).toBeVisible();
    await page.goto('/company/settings/subscription');
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '700.00 TJS', exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Cancel at the end of the paid period' }).check();
    await expect(page.getByRole('checkbox', { name: 'Cancel at the end of the paid period' })).toBeChecked();
    await page.getByRole('combobox', { name: 'Plan', exact: true }).selectOption('LARGE');
    await page.getByRole('button', { name: 'Request plan change', exact: true }).click();
    await expect(page.getByText('Your request was sent.')).toBeVisible();
    await admin.goto('/admin/plan-requests');
    const row = admin.getByRole('row').filter({ hasText: company.company_name }).filter({ hasText: 'LARGE' });
    await row.getByRole('button', { name: 'Review', exact: true }).click();
    await admin.getByLabel('Reason (at least 10 characters)', { exact: true }).fill('Approved unlimited plan for acceptance');
    await admin.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Large', { exact: true })).toBeVisible();
    await expect(page.getByText('Users: 1 / Unlimited')).toBeVisible();

    await admin.goto('/admin/plans');
    await admin.getByRole('button', { name: 'Add plan', exact: true }).click();
    const code = `TEST_${randomUUID().slice(0, 8).toUpperCase()}`;
    await admin.getByLabel('Plan code', { exact: true }).fill(code);
    for (const language of ['tg', 'ru', 'en'])
      await admin.getByLabel(`Plan name (${language})`, { exact: true }).fill(`Acceptance ${language}`);
    await admin.getByLabel('Monthly price (TJS)', { exact: true }).fill('100');
    await admin.getByLabel('Public plan', { exact: true }).uncheck();
    await admin.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(admin.getByRole('cell', { name: code, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('option', { name: new RegExp(code) })).toHaveCount(0);
  } finally {
    await adminContext.close();
  }
});
