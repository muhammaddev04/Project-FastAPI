import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: process.env.P00_BASE_URL ?? 'http://127.0.0.1:15174',
    trace: 'retain-on-failure',
  },
  reporter: 'list',
});
