import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect as baseExpect } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 30_000 });

test('P11 personal notifications, pagination, preferences, optional Telegram and responsive layout', async ({ page }) => {
  test.setTimeout(180_000);
  const email = `p11-${randomUUID()}@example.tj`;
  const project = process.env.P11_COMPOSE_PROJECT;
  const override = process.env.P11_COMPOSE_OVERRIDE;
  if (!project) throw new Error('Run with python scripts/check_p11_browser.py for isolated acceptance');
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
      '-c',
      `
import asyncio, sys
import app.model_registry
from app.core.db import get_sessionmaker
from app.core.events import event_bus, DomainEvent
from app.core.outbox import dispatch_pending
from app.core.security import hash_password
from app.core.time import utcnow
from app.modules.identity.models import User
from app.modules.organizations.service import create_organization
from app.modules.organizations.schemas import CompanyCreate
from app.modules.organizations.ports import install_handlers
from app.modules.subscriptions.service import install as install_subscriptions
from app.modules.notifications.service import install as install_notifications
install_handlers()
install_subscriptions()
install_notifications()

async def seed():
    async with get_sessionmaker()() as session, session.begin():
        owner = User(email=sys.argv[1], full_name='P11 Owner', language='en', email_verified_at=utcnow(), password_hash=hash_password('P11Browser2026!'))
        session.add(owner)
        await session.flush()
        company = await create_organization(session, owner, 'COMPANY', CompanyCreate(name='P11 Company', legal_name='P11 Company', tax_identifier=sys.argv[2], phone='+992901234567', city='Dushanbe', address='Rudaki 11'))
        for number in range(23):
            await event_bus.publish(session, DomainEvent('LOW_STOCK', {'company_id': str(company.organization.id)}, company.organization.id))
    await dispatch_pending()
asyncio.run(seed())
`,
      email,
      String(Date.now()).slice(-12),
    ],
    { encoding: 'utf8', timeout: 90_000 },
  );

  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  const personalHeaders: Record<string, string>[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/notifications')) personalHeaders.push(request.headers());
  });
  await page.addInitScript(() => localStorage.setItem('tezfarmo.language', 'en'));
  const loggedIn = await page.request.post('/api/v1/auth/login', { data: { email, password: 'P11Browser2026!' } });
  expect(loggedIn.ok()).toBe(true);
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.getByText('Stock: low stock').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Mark read', exact: true }).first().click();
  await page.getByRole('checkbox', { name: 'Unread only' }).check();
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await expect(page.getByText('No notifications', { exact: true })).toBeVisible();
  await page.goto('/profile/notifications');
  const orders = page.getByRole('checkbox', { name: 'Telegram · Orders', exact: true });
  await expect(orders).toBeChecked();
  let releaseSave!: () => void;
  const saving = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.route('**/api/v1/notifications/preferences', async (route) => {
    if (route.request().method() === 'PUT') await saving;
    await route.continue();
  });
  await orders.uncheck();
  await expect(orders).not.toBeChecked();
  await expect(orders).toBeDisabled();
  releaseSave();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.reload();
  await expect(orders).not.toBeChecked();
  await expect(page.getByText('Always on').first()).toBeVisible();
  await expect(page.getByText('SMS', { exact: true })).toHaveCount(0);
  await page.goto('/profile/telegram');
  if (process.env.P11_TELEGRAM_CONFIGURED === '1') {
    await page.getByRole('button', { name: 'Connect Telegram', exact: true }).click();
    const deepLink = page.getByRole('link', { name: 'Open in Telegram', exact: true });
    await expect(deepLink).toBeVisible();
    const token = new URL((await deepLink.getAttribute('href'))!).searchParams.get('start');
    expect(token).toHaveLength(43);
    await expect(page.getByRole('img', { name: 'Connect Telegram', exact: true })).toBeVisible();
    let updateId = 100;
    const telegramId = 123456;
    const webhook = async (text: string) => {
      const response = await page.request.post('/api/v1/telegram/webhook/isolated-test-path', {
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'isolated-test-secret' },
        data: {
          update_id: updateId++,
          message: {
            message_id: updateId,
            date: Math.floor(Date.now() / 1000),
            chat: { id: telegramId, type: 'private' },
            from: { id: telegramId, is_bot: false, first_name: 'Isolated tester', language_code: 'en' },
            text,
          },
        },
      });
      expect(response.ok()).toBe(true);
      return response.json();
    };
    expect((await webhook(`/start ${token}`)).text).toBe('Account linked. /org');
    await expect(page.getByText('Linked', { exact: true })).toBeVisible();
    await expect(deepLink).toHaveCount(0);
    const organizations = await webhook('/org');
    const orgButton = organizations.reply_markup.inline_keyboard[0][0];
    expect(orgButton.text).toBe('P11 Company');
    const selected = await page.request.post('/api/v1/telegram/webhook/isolated-test-path', {
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'isolated-test-secret' },
      data: {
        update_id: updateId++,
        callback_query: {
          id: 'isolated-selection',
          chat_instance: 'isolated',
          data: orgButton.callback_data,
          from: { id: telegramId, is_bot: false, first_name: 'Isolated tester' },
          message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: telegramId, type: 'private' } },
        },
      },
    });
    expect(selected.ok()).toBe(true);
    expect((await selected.json()).method).toBe('answerCallbackQuery');
    expect((await webhook('/orders')).text).toBe('No data');
    expect((await webhook('/debt')).text).toContain('TJS');
    // Exercise the committed outbox -> notification -> delivery pipeline with a fake external sender.
    const deliveryOutput = execFileSync(
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
        '-c',
        `
import asyncio, sys
import app.model_registry
from sqlalchemy import select
from app.core.db import get_sessionmaker
from app.core.events import DomainEvent, EventBus
from app.core.outbox import dispatch_pending
from app.modules.identity.models import User, Membership
from app.modules.notifications.service import install
from app.modules.notifications.delivery import send_pending
install()
class Sender:
    def __init__(self): self.messages = []
    async def send(self, chat_id, message):
        self.messages.append((chat_id, message))
        return 'isolated-message'
async def check():
    async with get_sessionmaker()() as session, session.begin():
        user = await session.scalar(select(User).where(User.email == sys.argv[1]))
        org = await session.scalar(select(Membership.organization_id).where(Membership.user_id == user.id))
        await EventBus().publish(session, DomainEvent('VERIFICATION_APPROVED', {}, org))
    await dispatch_pending()
    sender = Sender()
    await send_pending(sender)
    assert any(chat_id == 123456 and message.startswith('Account: approved') for chat_id, message in sender.messages)
    assert await send_pending(sender) == 0
    print('isolated delivery passed')
asyncio.run(check())
`,
        email,
      ],
      { encoding: 'utf8', timeout: 90_000 },
    );
    expect(deliveryOutput).toContain('isolated delivery passed');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByText('Not linked', { exact: true })).toBeVisible();
    expect((await webhook('/orders')).text).toContain('First link');
  } else {
    await expect(page.getByText('Telegram is not configured yet. Notifications are available in the app.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Telegram', exact: true })).toBeDisabled();
  }
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('link', { name: 'View all notifications', exact: true })).toBeVisible();
  expect(personalHeaders.length).toBeGreaterThan(0);
  expect(personalHeaders.every((headers) => !headers['x-org-id'])).toBe(true);
  expect(consoleErrors).toEqual([]);
});
