import { test, expect } from '@playwright/test';

for (const entry of [
  { path: '/', asset: 'distribution', selector: '.day-hero-landscape' },
  { path: '/login', asset: 'product-office', selector: '.auth-access' },
  { path: '/how-it-works', asset: 'partnership', selector: '.day-page-hero-image' },
]) {
  test(`local background remains visible while media is delayed: ${entry.path}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/\/(media|brand)\//.test(request.url())) requests.push(request.url());
    });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/media/*.webp', async (route) => {
      await pending;
      await route.continue();
    });
    try {
      await page.goto(entry.path, { waitUntil: 'domcontentloaded' });
      const background = page.locator(entry.selector).first();
      await expect(background).toBeVisible();
      const layers = await background.evaluate((node) => getComputedStyle(node).backgroundImage);
      expect(layers).toContain('data:image/webp;base64,');
      expect(layers).toContain(`tezfarmo-${entry.asset}-640.webp`);
      await expect(page.locator(`link[rel="preload"][as="image"]`)).toHaveAttribute('href', `/media/tezfarmo-${entry.asset}-640.webp`);
      release();
      await expect
        .poll(() =>
          page.evaluate(async (asset) => {
            const image = new Image();
            image.src = `/media/tezfarmo-${asset}-640.webp`;
            try {
              await image.decode();
              return image.naturalWidth;
            } catch {
              return 0;
            }
          }, entry.asset),
        )
        .toBeGreaterThan(0);
      expect(requests.some((url) => url.endsWith('.png'))).toBe(false);
      expect(requests.some((url) => url.endsWith(`${entry.asset}.webp`))).toBe(false);
    } finally {
      release();
    }
  });
}

test('background preview survives a failed media request', async ({ page }) => {
  await page.route('**/media/*.webp', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.locator('.day-hero-landscape')).toBeVisible();
  expect(await page.locator('.day-hero-landscape').evaluate((node) => getComputedStyle(node).backgroundImage)).toContain(
    'data:image/webp;base64,',
  );
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
