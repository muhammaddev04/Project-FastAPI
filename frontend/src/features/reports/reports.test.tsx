import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';

const REPORT_PERMISSIONS = [
  'reports.sales',
  'reports.funnel',
  'reports.finance',
  'reports.returns',
  'reports.delivery',
  'reports.inventory',
];

function companyMe() {
  const membership = membershipFixture({
    permissions: [...membershipFixture().permissions, ...REPORT_PERMISSIONS],
  });
  return meFixture([membership]);
}

const reportList = [
  {
    code: 'sales_summary',
    periodic: true,
    group_by: ['day', 'week', 'month'],
    columns: [
      { key: 'period', kind: 'date' },
      { key: 'orders', kind: 'int' },
      { key: 'total', kind: 'money' },
    ],
  },
  {
    code: 'receivables_aging',
    periodic: false,
    group_by: [],
    columns: [
      { key: 'store_name', kind: 'text' },
      { key: 'current', kind: 'money' },
      { key: 'outstanding', kind: 'money' },
    ],
  },
];

const salesSummary = {
  code: 'sales_summary',
  date_from: '2026-09-10',
  date_to: '2026-10-09',
  group_by: 'day',
  columns: reportList[0]!.columns,
  rows: [{ period: '2026-10-09', orders: 2, total: '420.00' }],
  totals: { orders: 2, total: '420.00' },
};

beforeEach(() => {
  useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: 'org-company', restoring: false });
});
afterEach(() => vi.restoreAllMocks());

it('lists only the reports the member may open', async () => {
  mockApi([
    { path: '/me', body: companyMe() },
    { path: '/reports', body: [reportList[0]] },
  ]);
  renderRoutes(routes, '/company/reports');
  expect(await screen.findByText('Sales by period')).toBeInTheDocument();
  expect(screen.queryByText('Receivables aging')).not.toBeInTheDocument();
});

it('shows a report with its totals, table and chart, and queues an export of the same period', async () => {
  const user = userEvent.setup();
  const { calls } = mockApi([
    { path: '/me', body: companyMe() },
    { path: '/reports', body: reportList },
    { path: '/reports/sales_summary', body: salesSummary },
    {
      method: 'POST',
      path: '/exports',
      status: 202,
      body: {
        id: 'export-1',
        kind: 'sales_summary',
        format: 'CSV',
        status: 'PENDING',
        params: {},
        row_count: null,
        error: null,
        created_at: '2026-10-09T10:00:00Z',
        started_at: null,
        ready_at: null,
        expires_at: null,
      },
    },
  ]);
  renderRoutes(routes, '/company/reports/sales_summary');

  expect(await screen.findByRole('heading', { name: 'Sales by period' })).toBeInTheDocument();
  expect((await screen.findAllByText('420.00')).length).toBeGreaterThan(0);
  // RPT-005: the diagram is drawn from the rows the table lists.
  expect(await screen.findByRole('img', { name: 'Sales by period' })).toBeInTheDocument();

  const report = calls.find((call) => call.path === '/api/v1/reports/sales_summary');
  expect(report?.query?.get('date_to')).toBeTruthy();
  expect(report?.query?.get('group_by')).toBe('day');
  expect(report?.headers['X-Org-Id']).toBe('org-company');

  await user.click(screen.getByRole('button', { name: 'Export CSV' }));
  await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path === '/api/v1/exports')).toBe(true));
  const created = calls.find((call) => call.method === 'POST' && call.path === '/api/v1/exports');
  expect(created?.body).toMatchObject({ kind: 'sales_summary', format: 'CSV' });
  expect((created?.body as { params: Record<string, string> }).params.date_to).toBe(report?.query?.get('date_to'));
  expect(created?.headers['Idempotency-Key']).toBeTruthy();
});

it('refuses a report the member may not open', async () => {
  mockApi([
    { path: '/me', body: meFixture() },
    { path: '/reports', body: [] },
  ]);
  renderRoutes(routes, '/company/reports/sales_summary');
  expect(await screen.findByText("You don't have access")).toBeInTheDocument();
});

it('polls the export list and downloads a ready file through its signed URL', async () => {
  const user = userEvent.setup();
  const open = vi.fn();
  vi.stubGlobal('open', open);
  const ready = {
    id: 'export-1',
    kind: 'sales_summary',
    format: 'CSV' as const,
    status: 'READY' as const,
    params: {},
    row_count: 12,
    error: null,
    created_at: '2026-10-09T10:00:00Z',
    started_at: '2026-10-09T10:00:05Z',
    ready_at: '2026-10-09T10:00:09Z',
    expires_at: '2026-10-16T10:00:09Z',
  };
  const { calls } = mockApi([
    { path: '/me', body: companyMe() },
    { path: '/exports', body: { count: 1, limit: 20, offset: 0, results: [ready] } },
    {
      path: '/exports/export-1/download',
      body: { url: '/api/v1/files/content/org/export/file.csv?expires=1&signature=x', expires_at: '2026-10-09T10:15:00Z' },
    },
  ]);
  renderRoutes(routes, '/company/exports');

  expect(await screen.findByText('Sales by period')).toBeInTheDocument();
  expect(screen.getByText('Ready')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(calls.some((call) => call.path === '/api/v1/exports/export-1/download')).toBe(true));
  expect(open).toHaveBeenCalledWith(expect.stringContaining('signature=x'), '_blank', 'noopener');
});

it('puts the company dashboard figures on the dashboard and leaves out what the member may not read', async () => {
  mockApi([
    { path: '/me', body: companyMe() },
    { path: '/reports', body: reportList },
    {
      path: '/dashboard',
      body: {
        type: 'COMPANY',
        new_orders: 3,
        deliveries_today: 1,
        sales_this_month: '1200.00',
        receivables: '800.00',
        overdue: '150.00',
        low_stock_products: 2,
        payments_to_confirm: null,
        open_disputes: 0,
      },
    },
  ]);
  renderRoutes(routes, '/company');
  expect(await screen.findByText('New orders')).toBeInTheDocument();
  expect(screen.getByText('1200.00 TJS')).toBeInTheDocument();
  expect(screen.getByText('Attention')).toBeInTheDocument();
  expect(screen.queryByText('Payments to confirm')).not.toBeInTheDocument();
});
