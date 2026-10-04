import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, area: string) {
  await page.addInitScript(() => localStorage.setItem('tezfarmo.language', 'en'));
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(`p00-${area}@example.tj`);
  await page.getByLabel(/^password/i).fill('P00Demo2026!');
  await page.getByRole('button', { name: 'Login now', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

test('P01 invitation acceptance and immediate role and membership enforcement', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const api = process.env.P00_API_URL ?? 'http://127.0.0.1:18001/api/v1';
  const response = await page.request.post(`${api}/auth/login`, { data: { email: 'p00-company@example.tj', password: 'P00Demo2026!' } });
  expect(response.ok()).toBe(true);
  const owner = await response.json();
  const org = owner.user.memberships.find(
    (membership: { role: string; org_type: string }) => membership.role === 'OWNER' && membership.org_type === 'COMPANY',
  );
  const headers = { Authorization: `Bearer ${owner.access_token}`, 'X-Org-Id': org.organization_id };
  // Restore only the cross-membership and invitations belonging to this acceptance scenario.
  async function cleanup() {
    const members = await page.request.get(`${api}/members?limit=100`, { headers });
    expect(members.ok()).toBe(true);
    for (const member of (await members.json()).results) {
      if (member.email === 'p00-store@example.tj' && member.status !== 'REVOKED') {
        const revoked = await page.request.post(`${api}/members/${member.id}/revoke`, {
          headers,
          data: { reason: 'P01 acceptance cleanup' },
        });
        expect(revoked.ok()).toBe(true);
      }
    }
    const invitations = await page.request.get(`${api}/members/invitations?limit=100`, { headers });
    expect(invitations.ok()).toBe(true);
    for (const invitation of (await invitations.json()).results) {
      if (
        invitation.email === 'p00-store@example.tj' &&
        invitation.status === 'PENDING' &&
        Date.parse(invitation.expires_at) > Date.now()
      ) {
        const revoked = await page.request.post(`${api}/members/invitations/${invitation.id}/revoke`, { headers });
        expect(revoked.ok()).toBe(true);
      }
    }
  }
  await cleanup();
  await page.context().clearCookies();
  const recipientContext = await browser.newContext({ baseURL: process.env.P00_BASE_URL ?? 'http://127.0.0.1:15174' });
  const recipient = await recipientContext.newPage();
  try {
    await login(page, 'company');
    await page.goto('/company/team');
    await page.getByRole('button', { name: 'Invite member', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Email', { exact: true }).fill('p00-store@example.tj');
    await page.getByRole('dialog').getByRole('combobox').selectOption('MANAGER');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await login(recipient, 'store');
    await recipient.getByRole('link', { name: 'Invitations', exact: true }).click();
    await recipient.getByRole('button', { name: 'Accept', exact: true }).click();
    await recipient.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(recipient).toHaveURL(/\/company$/);
    await recipient.goto('/company/team');
    await expect(recipient.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
    await expect(recipient.getByRole('button', { name: 'Invite member', exact: true })).toHaveCount(0);

    await page.reload();
    const row = page
      .getByRole('row')
      .filter({ hasText: 'p00-store@example.tj' })
      .filter({ has: page.getByRole('button', { name: 'Change role', exact: true }) });
    await row.getByRole('button', { name: 'Change role', exact: true }).click();
    await page.getByRole('dialog').getByRole('combobox').selectOption('OPERATOR');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await recipient.reload();
    await expect(recipient.getByText("You don't have access", { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Suspend', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Reason', { exact: true }).fill('Acceptance suspension');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const recipientSession = await recipient.request.post(`${api}/auth/login`, {
      data: { email: 'p00-store@example.tj', password: 'P00Demo2026!' },
    });
    const token = (await recipientSession.json()).access_token;
    const blocked = await recipient.request.get(`${api}/members`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': org.organization_id },
    });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).error.code).toBe('membership_inactive');

    await row.getByRole('button', { name: 'Reactivate', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await row.getByRole('button', { name: 'Revoke membership', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Reason', { exact: true }).fill('Acceptance revocation');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const me = await recipient.request.get(`${api}/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(
      (await me.json()).memberships.some((membership: { organization_id: string }) => membership.organization_id === org.organization_id),
    ).toBe(false);
  } finally {
    await recipientContext.close();
    await cleanup();
  }
});
