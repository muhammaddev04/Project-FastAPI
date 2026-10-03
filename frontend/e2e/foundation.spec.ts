import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const area of ['company', 'store', 'courier', 'admin']) {
  test(`P00 ${area} area works against the real API`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      if (!localStorage.getItem('tezfarmo.language')) localStorage.setItem('tezfarmo.language', 'en');
    });
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(`p00-${area}@example.tj`);
    await page.getByLabel(/^password/i).fill('P00Demo2026!');
    await page.getByRole('button', { name: 'Login now', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login$/);
    await page.goto(`/${area}`);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('Something went wrong');
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.getByRole('radio', { name: 'RU', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await page.getByRole('radio', { name: 'TG', exact: true }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'tg');
    await expect(page.locator('main h1')).toBeVisible();
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => {
        const focused = document.activeElement;
        if (!focused?.matches(':focus-visible')) return false;
        const style = getComputedStyle(focused);
        return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
      }),
    ).toBe(true);
  });
}

test('P00 status routes and language persistence', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tezfarmo.language', 'ru'));
  await page.goto('/403');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('body')).toContainText('403');
  await page.goto('/p00-missing-page');
  await expect(page.locator('body')).toContainText('404');
});
