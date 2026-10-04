import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

function seedOwner(email: string) {
  // Trusted fixtures only: this guard refuses every database except the isolated acceptance database.
  const script = `import asyncio, sys
import app.model_registry
from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.core.security import hash_password
from app.core.time import utcnow
from app.modules.identity.models import User
settings = get_settings()
assert settings.app_env == 'development' and settings.database_url.endswith('/tezfarmo_p00')
async def seed():
    async with get_sessionmaker().begin() as session:
        session.add(User(email=sys.argv[1], full_name='P02 Acceptance Owner', language='en', email_verified_at=utcnow(), password_hash=hash_password('P00Demo2026!')))
asyncio.run(seed())`;
  execFileSync(
    'docker',
    ['compose', '-p', 'tezfarmo-p00', '-f', resolve('../docker-compose.p00.yml'), 'exec', '-T', 'backend', 'python', '-c', script, email],
    { timeout: 30_000 },
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

const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');

for (const type of ['company', 'store']) {
  test(`P02 ${type} creation and verification rejection, resubmission and approval`, async ({ page, browser }) => {
    test.setTimeout(120_000);
    const unique = randomUUID();
    const email = `p02-${unique}@example.tj`;
    const name = `P02 ${type} ${unique.slice(0, 8)}`;
    seedOwner(email);
    await login(page, email);
    await page.goto(`/welcome/${type}`);
    await page.getByLabel(/^(company|store) name/i).fill(name);
    await page.getByLabel(/^legal name/i).fill(`${name} LLC`);
    await page.getByLabel(/^business phone/i).fill('+992901234567');
    await page.getByLabel(/^city/i).fill('Dushanbe');
    await page.getByLabel(/^address/i).fill('Acceptance Avenue 12');
    if (type === 'company') await page.getByLabel(/^tax identifier/i).fill(`${Date.now()}`.slice(-12));
    else {
      await page.getByRole('button', { name: 'Optional details' }).click();
      await page.getByLabel(/^latitude/i).fill('38.559772');
      await page.getByLabel(/^longitude/i).fill('68.787038');
    }
    await page.getByRole('button', { name: `Create ${type}`, exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: `Create ${type}`, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${type}/settings/verification$`));

    async function submit() {
      await page
        .getByLabel('Registration certificate', { exact: true })
        .setInputFiles({ name: 'registration.pdf', mimeType: 'application/pdf', buffer: pdf });
      await expect(page.getByText('registration.pdf', { exact: true })).toBeVisible();
      if (type === 'company') {
        await page
          .getByLabel('Tax registration certificate', { exact: true })
          .setInputFiles({ name: 'tax.pdf', mimeType: 'application/pdf', buffer: pdf });
        await expect(page.getByText('tax.pdf', { exact: true })).toBeVisible();
      }
      await page.getByRole('button', { name: 'Submit for verification', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await submit();
    const adminContext = await browser.newContext({ baseURL: process.env.P00_BASE_URL ?? 'http://127.0.0.1:15174' });
    const admin = await adminContext.newPage();
    try {
      await login(admin, 'p00-admin@example.tj');
      await admin.goto('/admin/verifications');
      await admin.getByRole('button', { name, exact: true }).click();
      await admin.getByRole('button', { name: 'Open registration.pdf', exact: true }).click();
      const preview = admin.getByTitle('registration.pdf');
      await expect(preview).toBeVisible();
      const url = await preview.getAttribute('src');
      expect(url).toBeTruthy();
      expect((await admin.request.get(url!)).status()).toBe(200);
      const unsigned = new URL(url!, admin.url());
      unsigned.searchParams.delete('signature');
      expect((await admin.request.get(unsigned.toString())).status()).toBe(403);
      await admin
        .getByRole('dialog')
        .filter({ has: admin.getByTitle('registration.pdf') })
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      await admin.getByRole('button', { name: 'Start review', exact: true }).click();
      await admin.getByRole('button', { name: 'Reject', exact: true }).click();
      await admin.getByLabel('Reason for rejection', { exact: true }).fill('Please submit a clearer registration certificate.');
      await admin.getByRole('button', { name: 'Reject request', exact: true }).click();
      await page.reload();
      await expect(page.getByText('Please submit a clearer registration certificate.', { exact: true })).toBeVisible();
      await submit();
      await admin.goto('/admin/verifications');
      await admin.getByRole('button', { name, exact: true }).click();
      await admin.getByRole('button', { name: 'Start review', exact: true }).click();
      await admin.getByRole('button', { name: 'Approve', exact: true }).click();
      await expect(admin.getByRole('dialog')).toContainText('Approved');
      await page.reload();
      await expect(
        page.getByText('Your organization is verified. Its legal name and tax identifier are now locked.', { exact: true }),
      ).toBeVisible();
      await page.goto(`/${type}/settings/profile`);
      await expect(page.getByLabel(/^legal name/i)).toHaveAttribute('readonly');
    } finally {
      await adminContext.close();
    }
  });
}
