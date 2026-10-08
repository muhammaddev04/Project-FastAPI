import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';
import { adjustmentBalance, limitWarning, validAmount } from './api';

const balance = {
  partnership_id: 'p1',
  balance: '1000.00',
  outstanding: '1000.00',
  overdue: '200.00',
  unapplied: '0.00',
  credit_limit: '1200.00',
  available: '200.00',
  aging: { current: '800.00', '1-30': '200.00', '31-60': '0.00', '61-90': '0.00', '90+': '0.00' },
};
const page = (results: unknown[]) => ({ count: results.length, limit: 20, offset: 0, results });
function signIn() {
  useSessionStore.setState({ accessToken: 'test', activeOrgId: null, endedReason: null });
}
function partnerMocks() {
  return [
    { path: '/me', body: meFixture() },
    { path: '/finance/partnerships/p1', body: balance },
    { path: '/partnerships/p1', body: { partner: { name: 'Shop' }, current_terms: { payment_methods: ['CASH', 'BANK_TRANSFER'] } } },
    { path: '/finance/partnerships/p1/charges', body: page([]) },
  ];
}
it('validates exact cents and prioritizes overdue over credit utilization', () => {
  for (const value of ['0', '-1', '1.001', '1e3', 'NaN', '10000000.01']) expect(validAmount(value)).toBe(false);
  expect(validAmount('12.30')).toBe(true);
  expect(validAmount('10000000.00')).toBe(true);
  expect(limitWarning(balance)).toBe('danger');
  expect(limitWarning({ ...balance, overdue: '0' })).toBe('warning');
  expect(adjustmentBalance('1000.00', '0.10', 'CREDIT')).toBe('999.90');
});
it('reads service summaries, highlights overdue partners and applies server filters', async () => {
  const user = userEvent.setup();
  const { calls } = mockApi([
    { path: '/me', body: meFixture() },
    { path: '/finance/summary', body: balance },
    { path: '/finance/partnerships', body: page([{ ...balance, partner_name: 'Shop' }]) },
  ]);
  signIn();
  renderRoutes(routes, '/company/finance');
  const partner = await screen.findByRole('link', { name: 'Shop' });
  expect(partner).toHaveAttribute('href', '/company/finance/p1');
  expect(partner.closest('tr')).toHaveClass('bg-danger/10');
  expect(screen.getByText('1–30: 200.00 TJS')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Overdue only' }));
  await waitFor(() => expect(calls.some((row) => row.query?.get('overdue') === 'true')).toBe(true));
  expect(calls.some((row) => row.path === '/api/v1/finance/summary')).toBe(true);
  expect(calls.some((row) => row.path === '/api/v1/orders')).toBe(false);
});
it('requires FIFO preview and bank reference, and records with an idempotency key', async () => {
  const user = userEvent.setup();
  const { calls } = mockApi([
    ...partnerMocks(),
    {
      path: '/finance/partnerships/p1/allocation-preview',
      body: {
        amount: '1200.00',
        allocated: '1000.00',
        unapplied: '200.00',
        lines: [{ charge_id: 'c1', amount: '1000.00', due_date: '2026-10-08' }],
      },
    },
    { method: 'POST', path: '/payments', body: { id: 'payment' } },
  ]);
  signIn();
  renderRoutes(routes, '/company/finance/p1');
  await user.click(await screen.findByRole('button', { name: 'Record payment' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Amount'), '1200');
  await user.selectOptions(dialog.getByLabelText('Method'), 'BANK_TRANSFER');
  expect(dialog.getByRole('button', { name: 'Record and confirm' })).toBeDisabled();
  await user.type(dialog.getByLabelText('Reference'), 'BANK-123');
  expect(await dialog.findByText('Unapplied credit: 200.00 TJS')).toBeVisible();
  await waitFor(() => expect(dialog.getByRole('button', { name: 'Record and confirm' })).toBeEnabled());
  await user.click(dialog.getByRole('button', { name: 'Record and confirm' }));
  const call = calls.find((row) => row.method === 'POST' && row.path.endsWith('/payments'))!;
  expect(call.body).toMatchObject({ amount: '1200', method: 'BANK_TRANSFER', reference: 'BANK-123', confirm: true });
  expect(call.headers['Idempotency-Key']).toBeTruthy();
});
it('shows store payment reporting without confirmation or adjustment controls', async () => {
  const user = userEvent.setup();
  mockApi([
    ...partnerMocks().filter((row) => row.path !== '/me'),
    { path: '/me', body: meFixture([storeMembership({ permissions: ['finance.view', 'payments.record'] })]) },
  ]);
  signIn();
  renderRoutes(routes, '/store/finance/p1');
  await user.click(await screen.findByRole('button', { name: 'Report payment' }));
  expect(screen.queryByRole('button', { name: 'Record and confirm' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Adjustments' })).not.toBeInTheDocument();
});
it('prevents forbidden finance reads', async () => {
  const { calls } = mockApi([{ path: '/me', body: meFixture([membershipFixture({ role: 'WAREHOUSE', permissions: [] })]) }]);
  signIn();
  renderRoutes(routes, '/company/finance');
  expect(await screen.findByText("You don't have access")).toBeVisible();
  expect(calls.some((row) => row.path.includes('/finance/'))).toBe(false);
});
it('shows Dushanbe statement opening and closing balances with date filters', async () => {
  const user = userEvent.setup();
  const { calls } = mockApi([
    ...partnerMocks(),
    {
      path: '/finance/partnerships/p1/statement',
      body: {
        opening_balance: '500.00',
        closing_balance: '1000.00',
        entries: [
          {
            id: 'l1',
            created_at: '2026-10-08T00:00:00Z',
            entry_type: 'CHARGE',
            direction: 'DEBIT',
            amount: '500.00',
            balance_after: '1000.00',
          },
        ],
      },
    },
  ]);
  signIn();
  renderRoutes(routes, '/company/finance/p1');
  await user.click(await screen.findByRole('button', { name: 'Statement' }));
  expect(await screen.findByText('Opening balance: 500.00 TJS')).toBeVisible();
  expect(screen.getByText('Closing balance: 1000.00 TJS')).toBeVisible();
  await user.type(screen.getByLabelText('From date (Dushanbe)'), '2026-10-01');
  await waitFor(() => expect(calls.some((row) => row.query?.get('date_from') === '2026-10-01')).toBe(true));
});
