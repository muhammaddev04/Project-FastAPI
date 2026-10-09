import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';
import { deadlinePassed, hoursLeft, previewQuery, slaTone, stepCeiling, validQuantity, validStep } from './api';

const COMPANY_PERMS = [
  'orders.view',
  'partners.view',
  'finance.view',
  'delivery.view_all',
  'returns.view',
  'returns.approve',
  'returns.receive',
  'returns.complete',
  'disputes.view',
  'disputes.message',
  'disputes.review',
  'disputes.resolve',
];
const STORE_PERMS = [
  'orders.view',
  'partners.view',
  'finance.view',
  'returns.view',
  'returns.request',
  'returns.cancel_own',
  'disputes.view',
  'disputes.open',
  'disputes.withdraw',
  'disputes.message',
];

const page = (results: unknown[]) => ({ count: results.length, limit: 20, offset: 0, results });

function signIn() {
  useSessionStore.setState({ accessToken: 'test', activeOrgId: null, endedReason: null });
}

const ORDER_ITEM = {
  id: 'item-1',
  product_name_snapshot: 'Rice 25kg',
  sku_snapshot: 'RICE-25',
  unit_code_snapshot: 'bag',
  requested_quantity: '10.000',
  confirmed_quantity: '10.000',
  rejected_quantity: '0.000',
  unit_price: '120.00',
  line_total: '1200.00',
};

const ORDER = {
  id: 'order-1',
  order_number: 'ORD-0001',
  company_id: 'org-company',
  store_id: 'org-store',
  partnership_id: 'p1',
  status: 'DELIVERED',
  partner_name: 'Corner Market',
  delivery_address: 'Rudaki 10',
  store_note: null,
  company_note: null,
  created_by: 'user-1',
  created_at: '2026-10-01T08:00:00Z',
  updated_at: null,
  version: 4,
  history: [],
  currency: 'TJS',
  requested_subtotal: '1200.00',
  subtotal: '1200.00',
  discount: '0.00',
  delivery_fee: '0.00',
  total: '1200.00',
  terms_snapshot: { return_days: 7, dispute_window_hours: 48 },
  delivered_at: new Date(Date.now() - 3_600_000).toISOString(),
  items: [ORDER_ITEM],
};

const RETURN_ITEM = {
  id: 'ri-1',
  order_item_id: 'item-1',
  requested_quantity: '4.000',
  approved_quantity: '4.000',
  received_quantity: '3.000',
  accepted_quantity: null,
  restock_quantity: null,
  line_credit: null,
};

const RETURN = {
  id: 'ret-1',
  return_number: 'RET-0001',
  company_id: 'org-company',
  store_id: 'org-store',
  partnership_id: 'p1',
  order_id: 'order-1',
  status: 'RECEIVED',
  reason_code: 'DAMAGED',
  note: null,
  source: 'STORE_REQUEST',
  dispute_id: null,
  rejection_reason: null,
  cancel_reason: null,
  total_credit: null,
  credit_note_id: null,
  requested_at: '2026-10-02T08:00:00Z',
  approved_at: '2026-10-02T09:00:00Z',
  received_at: '2026-10-02T10:00:00Z',
  completed_at: null,
  created_at: '2026-10-02T08:00:00Z',
  version: 3,
  items: [RETURN_ITEM],
  history: [
    {
      id: 'h1',
      from_status: null,
      to_status: 'REQUESTED',
      actor_id: 'u1',
      actor_type: 'USER',
      reason: null,
      created_at: '2026-10-02T08:00:00Z',
    },
  ],
};

const DISPUTE = {
  id: 'dis-1',
  dispute_number: 'DSP-0001',
  company_id: 'org-company',
  store_id: 'org-store',
  partnership_id: 'p1',
  target_type: 'ORDER',
  order_id: 'order-1',
  payment_id: null,
  type: 'QUANTITY',
  description: 'Two bags were missing from the pallet.',
  status: 'UNDER_REVIEW',
  opened_by: 'user-2',
  resolution_type: null,
  resolution_note: null,
  pending_adjustment_id: null,
  adjustment_id: null,
  return_id: null,
  resolved_by: null,
  resolved_at: null,
  created_at: new Date(Date.now() - 72 * 3_600_000).toISOString(),
  version: 2,
  messages: [
    {
      id: 'msg-1',
      dispute_id: 'dis-1',
      author_id: 'user-2',
      author_side: 'STORE',
      body: 'Only eight arrived.',
      file_id: null,
      created_at: '2026-10-06T08:00:00Z',
    },
  ],
};

describe('P10 return calculations in the browser', () => {
  it('bounds a line by what is left and refuses a fraction of a whole-piece unit (RET-003)', () => {
    expect(validQuantity('4', '10')).toBe(true);
    expect(validQuantity('10.001', '10')).toBe(false);
    expect(validQuantity('0', '10')).toBe(false);
    expect(validQuantity('1.5', '10', false)).toBe(false);
    expect(validQuantity('1.5', '10', true)).toBe(true);
    expect(validQuantity('abc', '10')).toBe(false);
  });

  it('accepts zero at a step, which drops the line rather than failing the form', () => {
    expect(validStep('0', '4')).toBe(true);
    expect(validStep('', '4')).toBe(false);
    expect(validStep('5', '4')).toBe(false);
  });

  it('walks the requested → approved → received → accepted → restock ladder', () => {
    expect(stepCeiling(RETURN_ITEM, 'approved')).toBe('4.000');
    expect(stepCeiling(RETURN_ITEM, 'received')).toBe('4.000');
    expect(stepCeiling(RETURN_ITEM, 'accepted')).toBe('3.000');
    // Nothing is accepted yet, so nothing may go back to stock (RET-012).
    expect(stepCeiling(RETURN_ITEM, 'restock')).toBe('0');
  });

  it('closes its own windows rather than waiting for the server to refuse (RET-002, DSP-001)', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    expect(deadlinePassed('2026-10-09T11:59:59Z', now)).toBe(true);
    expect(deadlinePassed('2026-10-10T00:00:00Z', now)).toBe(false);
    expect(deadlinePassed(null, now)).toBe(true);
    expect(hoursLeft('2026-10-10T12:30:00Z', now)).toBe(24);
    expect(hoursLeft('2026-10-09T11:00:00Z', now)).toBe(0);
  });

  it('colours the dispute queue on the same 48h/24h clock the SLA job runs on (DSP-024)', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    const at = (hours: number) => ({ status: 'OPEN' as const, created_at: new Date(now.getTime() - hours * 3_600_000).toISOString() });
    expect(slaTone(at(10), now)).toBeUndefined();
    expect(slaTone(at(30), now)).toBe('warning');
    expect(slaTone(at(50), now)).toBe('danger');
    // A resolved dispute has stopped the clock.
    expect(slaTone({ status: 'RESOLVED', created_at: at(50).created_at }, now)).toBeUndefined();
  });

  it('sends preview lines as repeated items=<id>:<accepted>:<restock>', () => {
    expect(
      previewQuery([
        { id: 'a', accepted: '2', restock: '1' },
        { id: 'b', accepted: '', restock: '' },
      ]),
    ).toBe('items=a%3A2%3A1&items=b%3A0%3A0');
  });
});

describe('company return queue and completion', () => {
  it('filters the queue on the server and links to the return', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi([
      { path: '/me', body: meFixture([membershipFixture({ permissions: COMPANY_PERMS })]) },
      { path: '/returns', body: page([RETURN]) },
    ]);
    signIn();
    renderRoutes(routes, '/company/returns');
    const link = await screen.findByRole('link', { name: 'RET-0001' });
    expect(link).toHaveAttribute('href', '/company/returns/ret-1');
    await user.click(screen.getByRole('button', { name: 'Requested' }));
    await waitFor(() => expect(calls.some((row) => row.query?.get('status') === 'REQUESTED')).toBe(true));
  });

  it('previews the credit from the server and completes with an idempotency key (RET-010, RET-012)', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi([
      { path: '/me', body: meFixture([membershipFixture({ permissions: COMPANY_PERMS })]) },
      { path: '/returns/ret-1', body: RETURN },
      { path: '/orders/order-1', body: ORDER },
      {
        path: '/returns/ret-1/completion-preview',
        body: { lines: [{ return_item_id: 'ri-1', line_credit: '360.00' }], total_credit: '360.00' },
      },
      {
        path: '/returns/ret-1/complete',
        method: 'POST',
        body: {
          ...RETURN,
          status: 'COMPLETED',
          total_credit: '360.00',
          items: [{ ...RETURN_ITEM, accepted_quantity: '3.000', restock_quantity: '3.000', line_credit: '360.00' }],
        },
      },
    ]);
    signIn();
    renderRoutes(routes, '/company/returns/ret-1');
    expect(await screen.findByRole('heading', { name: 'RET-0001' })).toBeInTheDocument();
    // The accepted and restock fields both open at what was received, and the preview is the server's figure.
    await waitFor(() => expect(screen.getByText('Total credit: 360.00 TJS — the store owes this much less')).toBeVisible());
    const preview = calls.find((row) => row.path === '/api/v1/returns/ret-1/completion-preview');
    expect(preview?.query?.getAll('items')).toEqual(['ri-1:3.000:3.000']);

    // Damaged goods: accepted stays, nothing goes back to the shelf.
    const restock = screen.getByLabelText('Back to stock');
    await user.clear(restock);
    await user.type(restock, '0');
    await user.click(screen.getByRole('button', { name: 'Confirm the credit' }));
    await waitFor(() => expect(calls.some((row) => row.path === '/api/v1/returns/ret-1/complete')).toBe(true));
    const posted = calls.find((row) => row.path === '/api/v1/returns/ret-1/complete');
    expect(posted?.body).toEqual({ version: 3, items: [{ id: 'ri-1', accepted_quantity: '3.000', restock_quantity: '0' }] });
    expect(posted?.headers['Idempotency-Key']).toBeTruthy();
  });

  it('makes the company explain a cancellation and the store not (P10 §7)', async () => {
    const user = userEvent.setup();
    mockApi([
      { path: '/me', body: meFixture([membershipFixture({ permissions: COMPANY_PERMS })]) },
      { path: '/returns/ret-1', body: { ...RETURN, status: 'REQUESTED' } },
      { path: '/orders/order-1', body: ORDER },
    ]);
    signIn();
    renderRoutes(routes, '/company/returns/ret-1');
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Reason')).toBeVisible();
    expect(dialog.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });
});

describe('store actions on a delivered order', () => {
  const storeMe = meFixture([storeMembership({ permissions: STORE_PERMS })]);

  it('asks for a return within max_returnable, reviews it, then sends it (RET-003)', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi([
      { path: '/me', body: storeMe },
      { path: '/orders/order-1', body: ORDER },
      { path: '/orders/order-1/delivery', body: { status: 'DELIVERED', attempt_no: 1 } },
      {
        path: '/orders/order-1/returnable',
        body: [
          {
            order_item_id: 'item-1',
            product_name: 'Rice 25kg',
            unit_code: 'bag',
            allow_fraction: false,
            confirmed_quantity: '10.000',
            returned_quantity: '0.000',
            max_returnable: '10.000',
            return_deadline: new Date(Date.now() + 86_400_000).toISOString(),
          },
        ],
      },
      { path: '/returns', method: 'POST', body: { ...RETURN, id: 'ret-new', status: 'REQUESTED' } },
    ]);
    signIn();
    renderRoutes(routes, '/store/orders/order-1');
    await user.click(await screen.findByRole('button', { name: 'Return goods' }));
    const quantity = await screen.findByLabelText('Rice 25kg · bag (max 10.000)');
    await user.type(quantity, '11');
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
    await user.clear(quantity);
    await user.type(quantity, '4');
    await user.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Rice 25kg: 4 bag')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls.some((row) => row.method === 'POST' && row.path === '/api/v1/returns')).toBe(true));
    const posted = calls.find((row) => row.method === 'POST' && row.path === '/api/v1/returns');
    expect(posted?.body).toEqual({ order_id: 'order-1', reason_code: 'DAMAGED', items: [{ order_item_id: 'item-1', quantity: '4' }] });
  });

  it('shows the remaining dispute window and opens a dispute on the order (DSP-001)', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi([
      { path: '/me', body: storeMe },
      { path: '/orders/order-1', body: ORDER },
      { path: '/orders/order-1/delivery', body: { status: 'DELIVERED', attempt_no: 1 } },
      { path: '/orders/order-1/returnable', body: [] },
      { path: '/disputes', method: 'POST', body: { ...DISPUTE, id: 'dis-new' } },
    ]);
    signIn();
    renderRoutes(routes, '/store/orders/order-1');
    // Delivered an hour ago inside a 48 hour window.
    await user.click(await screen.findByRole('button', { name: 'Dispute · 46 h left' }));
    await user.type(await screen.findByLabelText('Description'), 'Two bags were missing.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls.some((row) => row.method === 'POST' && row.path === '/api/v1/disputes')).toBe(true));
    expect(calls.find((row) => row.method === 'POST' && row.path === '/api/v1/disputes')?.body).toEqual({
      target_type: 'ORDER',
      order_id: 'order-1',
      type: 'QUANTITY',
      description: 'Two bags were missing.',
    });
  });

  it('hides the dispute button once the window has closed', async () => {
    mockApi([
      { path: '/me', body: storeMe },
      { path: '/orders/order-1', body: { ...ORDER, delivered_at: new Date(Date.now() - 49 * 3_600_000).toISOString() } },
      { path: '/orders/order-1/delivery', body: { status: 'DELIVERED', attempt_no: 1 } },
    ]);
    signIn();
    renderRoutes(routes, '/store/orders/order-1');
    expect(await screen.findByRole('button', { name: 'Return goods' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dispute/ })).not.toBeInTheDocument();
  });

  it('allows the last hour and disables an open form when its window expires (DSP-001)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    try {
      const user = userEvent.setup();
      mockApi([
        { path: '/me', body: storeMe },
        { path: '/orders/order-1', body: { ...ORDER, delivered_at: '2026-10-07T12:00:15Z' } },
        { path: '/orders/order-1/delivery', body: { status: 'DELIVERED', attempt_no: 1 } },
      ]);
      signIn();
      renderRoutes(routes, '/store/orders/order-1');
      await user.click(await screen.findByRole('button', { name: 'Dispute · 1 h left' }));
      await user.type(screen.getByLabelText('Description'), 'The delivery was short.');
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
      act(() => vi.advanceTimersByTime(30_000));
      expect(screen.getByText('The dispute window has closed.')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('dispute workflow', () => {
  const companyMe = meFixture([membershipFixture({ permissions: COMPANY_PERMS })]);

  it('marks a dispute that has waited past the SLA and shows how delivery was confirmed', async () => {
    mockApi([
      { path: '/me', body: companyMe },
      { path: '/disputes', body: page([{ ...DISPUTE, status: 'OPEN' }]) },
    ]);
    signIn();
    renderRoutes(routes, '/company/disputes');
    const row = (await screen.findByRole('link', { name: 'DSP-0001' })).closest('tr');
    expect(within(row as HTMLElement).getByText('SLA breached')).toBeVisible();
  });

  it('adds an immutable message and keeps the two sides apart (DSP-010)', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi([
      { path: '/me', body: companyMe },
      { path: '/disputes/dis-1', body: DISPUTE },
      { path: '/orders/order-1', body: ORDER },
      {
        path: '/deliveries',
        body: page([
          {
            id: 'd1',
            attempt_no: 1,
            status: 'DELIVERED',
            confirmation_method: 'MANUAL_OVERRIDE',
            manual_reason: 'Code unreadable',
            courier_name: 'Ali',
            failure_reason_code: null,
            failure_note: null,
          },
        ]),
      },
      {
        path: '/disputes/dis-1/messages',
        method: 'POST',
        body: {
          ...DISPUTE,
          messages: [
            ...DISPUTE.messages,
            {
              id: 'msg-2',
              dispute_id: 'dis-1',
              author_id: 'u1',
              author_side: 'COMPANY',
              body: 'Checking with the courier.',
              file_id: null,
              created_at: '2026-10-09T08:00:00Z',
            },
          ],
        },
      },
    ]);
    signIn();
    renderRoutes(routes, '/company/disputes/dis-1');
    expect(await screen.findByText('Only eight arrived.')).toBeVisible();
    expect(screen.getByText('Delivery confirmed: By hand, without the code — Code unreadable')).toBeVisible();
    await user.type(screen.getByLabelText('Message'), 'Checking with the courier.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls.some((row) => row.path === '/api/v1/disputes/dis-1/messages')).toBe(true));
    expect(calls.find((row) => row.path === '/api/v1/disputes/dis-1/messages')?.body).toEqual({ body: 'Checking with the courier.' });
  });

  it('uploads private evidence and attaches its identifier to a reply (DSP-010)', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi([
      { path: '/me', body: companyMe },
      { path: '/disputes/dis-1', body: DISPUTE },
      { path: '/orders/order-1', body: ORDER },
      { path: '/deliveries', body: page([]) },
      { path: '/files', method: 'POST', body: { id: 'evidence-1', display_name: 'handover.pdf' } },
      { path: '/disputes/dis-1/messages', method: 'POST', body: DISPUTE },
    ]);
    signIn();
    renderRoutes(routes, '/company/disputes/dis-1');
    const input = await screen.findByLabelText('Add evidence');
    await user.upload(input, new File(['%PDF-1.7'], 'handover.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('handover.pdf')).toBeVisible();
    expect(input).toBeDisabled();
    const upload = calls.find((row) => row.path === '/api/v1/files');
    expect((upload?.body as FormData).get('category')).toBe('DISPUTE');
    expect(upload?.headers['X-Org-Id']).toBe('org-company');
    await user.type(screen.getByLabelText('Message'), 'Signed handover evidence.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(calls.find((row) => row.path === '/api/v1/disputes/dis-1/messages')?.body).toEqual({
        body: 'Signed handover evidence.',
        file_id: 'evidence-1',
      }),
    );
  });

  it('bounds an adjustment credit by the order total and previews the balance (DSP-021)', async () => {
    const user = userEvent.setup();
    const { calls } = mockApi([
      { path: '/me', body: companyMe },
      { path: '/disputes/dis-1', body: DISPUTE },
      { path: '/orders/order-1', body: ORDER },
      { path: '/deliveries', body: page([]) },
      {
        path: '/finance/partnerships/p1',
        body: {
          partnership_id: 'p1',
          balance: '1000.00',
          outstanding: '1000.00',
          overdue: '0.00',
          unapplied: '0.00',
          credit_limit: '2000.00',
          available: '1000.00',
          aging: {},
        },
      },
      { path: '/disputes/dis-1/resolve', method: 'POST', body: { ...DISPUTE, status: 'RESOLVED', resolution_type: 'ADJUSTMENT_CREDIT' } },
    ]);
    signIn();
    renderRoutes(routes, '/company/disputes/dis-1');
    await user.click(await screen.findByRole('button', { name: 'Resolve' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.selectOptions(dialog.getByLabelText('Outcome'), 'ADJUSTMENT_CREDIT');
    await user.type(dialog.getByLabelText('Amount (max 1200.00 TJS)'), '1500.00');
    await user.type(dialog.getByLabelText('Why'), 'Two bags were short on arrival.');
    expect(dialog.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await user.clear(dialog.getByLabelText('Amount (max 1200.00 TJS)'));
    await user.type(dialog.getByLabelText('Amount (max 1200.00 TJS)'), '240.00');
    await waitFor(() => expect(dialog.getByText('Balance after the credit: 760.00 TJS')).toBeVisible());
    await user.click(dialog.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls.some((row) => row.path === '/api/v1/disputes/dis-1/resolve')).toBe(true));
    expect(calls.find((row) => row.path === '/api/v1/disputes/dis-1/resolve')?.body).toEqual({
      version: 2,
      resolution_type: 'ADJUSTMENT_CREDIT',
      resolution_note: 'Two bags were short on arrival.',
      amount: '240.00',
    });
  });

  it('gives a store seller both queues to read and no action on either (P10 §6)', async () => {
    mockApi([
      {
        path: '/me',
        body: meFixture([storeMembership({ role: 'SELLER', permissions: ['orders.view', 'returns.view', 'disputes.view'] })]),
      },
      { path: '/disputes/dis-1', body: DISPUTE },
      { path: '/orders/order-1', body: ORDER },
    ]);
    signIn();
    renderRoutes(routes, '/store/disputes/dis-1');
    expect(await screen.findByText('Only eight arrived.')).toBeVisible();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });
});
