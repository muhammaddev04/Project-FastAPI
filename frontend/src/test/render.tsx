import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { AppProviders } from '@/app/providers';
import { createQueryClient } from '@/app/query-client';
import { setLanguage } from '@/shared/i18n';

type JsonBody = unknown;
export type MockRoute = { method?: string; path: string; status?: number; body?: JsonBody };

/** Minimal fetch double that answers by method + path and records requests. Test fixtures only. */
export function mockApi(routes: MockRoute[]) {
  const calls: { method: string; path: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}));
    calls.push({ method, path: url.pathname, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const match = routes.find((route) => (route.method ?? 'GET') === method && `/api/v1${route.path}` === url.pathname);
    const status = match?.status ?? (match ? 200 : 404);
    const body = match?.body ?? (match ? {} : { error: { code: 'not_found', message: 'Not found', details: {}, request_id: 'test' } });
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'test' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function renderRoutes(routes: RouteObject[], initialPath: string) {
  setLanguage('en');
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const utils = render(
    <AppProviders client={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...utils, router };
}

export function renderWithProviders(ui: ReactElement) {
  setLanguage('en');
  return render(<AppProviders client={createQueryClient()}>{ui}</AppProviders>);
}
