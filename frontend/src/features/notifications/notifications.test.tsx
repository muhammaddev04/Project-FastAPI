import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { createQueryClient } from '@/app/query-client';
import { useSessionStore } from '@/shared/auth/session-store';
import { notificationResources } from '@/shared/i18n/notifications';
import { meFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';
import type { Notification } from './api';
import { useNotifications } from './api';

const notification: Notification = {
  id: 'notification-1',
  organization_id: 'org-company',
  event_type: 'ORDER_CREATED',
  title_key: 'notifications.events.ORDER_CREATED',
  body_key: 'notifications.eventBody',
  params: { order_number: 'ORD-2026-000001', total: '123.50', due_date: '2026-10-09' },
  link: '/company/orders/order-1',
  read_at: null,
  created_at: '2026-10-09T07:00:00Z',
};

beforeEach(() => {
  useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: 'org-company', restoring: false });
});
afterEach(() => vi.restoreAllMocks());

function baseRoutes() {
  return [
    { path: '/me', body: meFixture() },
    { path: '/notifications/unread-count', body: { count: 1 } },
  ];
}

it('shows personal notifications and sends user-scoped read and unread-filter requests', async () => {
  const user = userEvent.setup();
  const { calls } = mockApi([
    ...baseRoutes(),
    { path: '/notifications', body: { count: 1, limit: 20, offset: 0, results: [notification] } },
    { method: 'POST', path: '/notifications/notification-1/read', body: { ...notification, read_at: '2026-10-09T08:00:00Z' } },
    { method: 'POST', path: '/notifications/read-all', status: 204 },
  ]);
  renderRoutes(routes, '/notifications');
  expect(await screen.findByText('Order: created')).toBeInTheDocument();
  expect(screen.getByText(/ORD-2026-000001/)).toBeInTheDocument();
  expect(screen.getByText('09.10.2026')).toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: 'Unread only' }));
  await waitFor(() =>
    expect(calls.some((call) => call.path === '/api/v1/notifications' && call.query?.get('unread') === 'true')).toBe(true),
  );
  await user.click(screen.getByRole('button', { name: 'Mark read' }));
  await waitFor(() => expect(calls.some((call) => call.path === '/api/v1/notifications/notification-1/read')).toBe(true));
  await user.click(screen.getByRole('button', { name: 'Mark all read' }));
  await waitFor(() => expect(calls.some((call) => call.path === '/api/v1/notifications/read-all')).toBe(true));
  expect(calls.filter((call) => call.path.startsWith('/api/v1/notifications')).every((call) => !call.headers['X-Org-Id'])).toBe(true);
});

it('saves Telegram preferences and always displays locked in-app delivery without SMS', async () => {
  const preferences = [
    { event_group: 'orders', channel: 'IN_APP', enabled: true, locked: true },
    { event_group: 'orders', channel: 'TELEGRAM', enabled: true, locked: false },
  ];
  const { calls } = mockApi([
    ...baseRoutes(),
    { path: '/notifications/preferences', body: preferences },
    { method: 'PUT', path: '/notifications/preferences', body: [preferences[0], { ...preferences[1], enabled: false }] },
  ]);
  renderRoutes(routes, '/profile/notifications');
  const toggle = await screen.findByRole('checkbox', { name: 'Telegram · Orders' });
  expect(toggle).toBeChecked();
  expect(screen.getByText('Always on')).toBeInTheDocument();
  expect(screen.queryByText('SMS')).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(toggle).toBeDisabled();
  expect(await screen.findByRole('status')).toHaveTextContent('Settings saved');
  expect(toggle).not.toBeChecked();
  expect(calls.find((call) => call.method === 'PUT')?.body).toEqual([{ event_group: 'orders', channel: 'TELEGRAM', enabled: false }]);
});

it('keeps Telegram optional when no bot is configured', async () => {
  mockApi([...baseRoutes(), { path: '/telegram/link', body: { configured: false, linked: false, blocked: false } }]);
  renderRoutes(routes, '/profile/telegram');
  expect(await screen.findByText('Telegram is not configured yet. Notifications are available in the app.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Connect Telegram' })).toBeDisabled();
});

it('generates the linking QR locally and offers the one-time deep link', async () => {
  const user = userEvent.setup();
  const deepLink = 'https://t.me/testbot?start=one-time-token';
  mockApi([
    ...baseRoutes(),
    { path: '/telegram/link', body: { configured: true, linked: false, blocked: false } },
    {
      method: 'POST',
      path: '/telegram/link-token',
      body: { deep_link: deepLink, expires_at: new Date(Date.now() + 600_000).toISOString() },
    },
  ]);
  renderRoutes(routes, '/profile/telegram');
  await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
  expect(await screen.findByRole('link', { name: 'Open in Telegram' })).toHaveAttribute('href', deepLink);
  expect(screen.getByRole('timer')).toHaveTextContent(/Link expires in/);
  expect(screen.getByTitle('Connect Telegram').closest('svg')).toBeInTheDocument();
  expect(document.querySelector(`img[src*="one-time-token"]`)).toBeNull();
});

it('does not expose an expired linking token in a QR or a link', async () => {
  const user = userEvent.setup();
  mockApi([
    ...baseRoutes(),
    { path: '/telegram/link', body: { configured: true, linked: false, blocked: false } },
    {
      method: 'POST',
      path: '/telegram/link-token',
      body: { deep_link: 'https://t.me/testbot?start=expired', expires_at: new Date(Date.now() - 1000).toISOString() },
    },
  ]);
  renderRoutes(routes, '/profile/telegram');
  await user.click(await screen.findByRole('button', { name: 'Connect Telegram' }));
  expect(await screen.findByText('Link expired. Create a new one.')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open in Telegram' })).not.toBeInTheDocument();
});

it('shows the unread badge and the latest notifications in the header dropdown', async () => {
  const user = userEvent.setup();
  mockApi([
    ...baseRoutes(),
    { path: '/telegram/link', body: { configured: false, linked: false } },
    { path: '/notifications', body: { count: 1, limit: 10, offset: 0, results: [notification] } },
  ]);
  renderRoutes(routes, '/profile/telegram');
  const bell = await screen.findByRole('button', { name: 'Notifications' });
  await waitFor(() => expect(bell).toHaveTextContent('1'));
  await user.click(bell);
  expect(await screen.findByText('Order: created')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View all notifications' })).toHaveAttribute('href', '/notifications');
});

it('supplies identical event and interface locale keys in all three languages', () => {
  expect(Object.keys(notificationResources.en).sort()).toEqual(Object.keys(notificationResources.tg).sort());
  expect(Object.keys(notificationResources.ru.events).sort()).toEqual(Object.keys(notificationResources.en.events).sort());
  expect(Object.keys(notificationResources.tg.events).sort()).toEqual(Object.keys(notificationResources.en.events).sort());
  expect(notificationResources.en.events.DELIVERY_DISPATCHED).not.toEqual(notificationResources.tg.events.DELIVERY_DISPATCHED);
});

it('restores the previous Telegram preference when saving fails', async () => {
  const user = userEvent.setup();
  mockApi([
    ...baseRoutes(),
    { path: '/notifications/preferences', body: [{ event_group: 'orders', channel: 'TELEGRAM', enabled: true, locked: false }] },
    { method: 'PUT', path: '/notifications/preferences', status: 503, body: { error: { code: 'internal_error' } } },
  ]);
  renderRoutes(routes, '/profile/notifications');
  const toggle = await screen.findByRole('checkbox', { name: 'Telegram · Orders' });
  await user.click(toggle);
  await screen.findByRole('alert');
  expect(toggle).toBeChecked();
});

it('switches personal notification caches when the signed-in user changes', async () => {
  const first = { count: 1, limit: 20, offset: 0, results: [notification] };
  const empty = { count: 0, limit: 20, offset: 0, results: [] };
  const route = { path: '/notifications', body: first };
  mockApi([route]);
  const client = createQueryClient();
  client.setQueryData(['me'], meFixture());
  const { result } = renderHook(() => useNotifications(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(result.current.data?.results[0]?.id).toBe('notification-1'));
  route.body = empty;
  act(() => client.setQueryData(['me'], meFixture([], { id: 'user-2' })));
  await waitFor(() => expect(result.current.data?.results).toEqual([]));
  expect(client.getQueryData(['notifications', 'user-1', 'list', false, 0, 20])).toEqual(first);
  expect(client.getQueryData(['notifications', 'user-2', 'list', false, 0, 20])).toEqual(empty);
});
