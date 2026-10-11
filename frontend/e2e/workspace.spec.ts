import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const area of ['company', 'store', 'courier']) {
  test(`signed-in ${area} navigation and forms at desktop and mobile widths`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => localStorage.setItem('tezfarmo.language', 'en'));
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(`p00-${area}@example.tj`);
    await page.getByLabel(/^password/i).fill('P00Demo2026!');
    await page.getByRole('button', { name: 'Login now', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login$/);
    const routes = [`/${area}`, '/profile', ...(area === 'courier' ? [] : [`/${area}/settings/profile`])];
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of routes) {
        await page.goto(route);
        await expect(page.locator('main h1')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.workspace')).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const controls = page.locator('main form input:visible, main form select:visible');
        for (const control of await controls.all()) {
          const box = await control.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.width).toBeGreaterThan(120);
          expect(box!.height).toBeGreaterThanOrEqual(40);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        }
        await page.screenshot({ path: testInfo.outputPath(`${route.replaceAll('/', '-')}-${width}.png`), fullPage: true });
      }
    }
    await page.goto('/profile');
    const name = page.getByLabel('Full name', { exact: true });
    await name.fill('Workspace Acceptance');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Your profile was saved.', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(name).toHaveValue('Workspace Acceptance');
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.goto(`/${area}`);
    if (area !== 'courier') {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: testInfo.outputPath(`${area}-dark-mobile.png`), fullPage: true });
  });
}
