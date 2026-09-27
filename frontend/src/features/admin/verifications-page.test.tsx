import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';

const ADMIN = meFixture([], { id: 'admin-1', is_superadmin: true, full_name: 'Admin User' });

function detail(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    organization_id: 'org-1',
    org_type: 'STORE',
    org_name: 'Corner Market',
    status,
    submitted_at: '2026-09-26T10:00:00Z',
    reviewer_id: status === 'SUBMITTED' ? null : 'admin-1',
    reviewed_at: null,
    submitted_by: 'u-1',
    review_started_at: null,
    rejection_reason: null,
    legal_snapshot: { legal_name: 'IE Karimova N.', tax_identifier: null, address: 'Lenin St 4' },
    current_profile: { name: 'Corner Market', legal_name: 'IE Karimova N.', phone: '+992901112233', city: 'Khujand', address: 'Lenin St 4' },
    org_verification_status: 'PENDING',
    documents: [{ id: 'doc-1', doc_type: 'REGISTRATION_CERTIFICATE', file: { id: 'f-1', display_name: 'reg.pdf', size_bytes: 2048, content_type: 'application/pdf', category: 'VERIFICATION', created_at: '2026-09-26T10:00:00Z' } }],
    history: [],
    version: 1,
    ...extra,
  };
}

const QUEUE = { count: 1, limit: 100, offset: 0, results: [{ id: 'req-1', organization_id: 'org-1', org_type: 'STORE', org_name: 'Corner Market', status: 'SUBMITTED', submitted_at: '2026-09-26T10:00:00Z', reviewer_id: null, reviewed_at: null }] };

describe('admin verification queue (P02 §5/§8)', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: 'token', activeOrgId: null, endedReason: null, restoring: false }));

  it('is closed to anyone who is not SUPERADMIN', async () => {
    const { calls } = mockApi([{ path: '/me', body: meFixture([]) }]);
    const { current } = renderRoutes(routes, '/admin/verifications');
    await waitFor(() => expect(current.location?.pathname).toBe('/403'));
    expect(calls.some((call) => call.path.startsWith('/api/v1/admin'))).toBe(false);
  });

  it('lists the queue, opens a request and walks it through review to approval', async () => {
    const { calls } = mockApi([
      { path: '/me', body: ADMIN },
      { path: '/admin/verifications', body: QUEUE },
      { path: '/admin/verifications/req-1', body: detail('SUBMITTED') },
      { method: 'POST', path: '/admin/verifications/req-1/start-review', body: detail('UNDER_REVIEW') },
      { method: 'POST', path: '/admin/verifications/req-1/approve', body: detail('APPROVED', { org_verification_status: 'APPROVED' }) },
      { path: '/admin/verifications/req-1/documents/doc-1/url', body: { url: 'https://storage.example/signed', expires_at: '2026-09-26T10:05:00Z' } },
    ]);
    renderRoutes(routes, '/admin/verifications');

    await userEvent.click(await screen.findByRole('button', { name: 'Corner Market' }));
    expect(await screen.findByText('Legal details at submission')).toBeInTheDocument();
    expect(screen.getAllByText('IE Karimova N.').length).toBeGreaterThan(0);
    expect(screen.getByText(/no automatic registry check/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open reg.pdf' }));
    expect(await screen.findByRole('link', { name: /reg\.pdf/ })).toHaveAttribute('href', 'https://storage.example/signed');

    await userEvent.click(screen.getByRole('button', { name: 'Start review' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/api/v1/admin/verifications/req-1/approve')).toBe(true));
    expect((await screen.findAllByText('Approved')).length).toBeGreaterThan(0);
  });

  it('needs a reason of at least 10 characters to reject', async () => {
    const { calls } = mockApi([
      { path: '/me', body: ADMIN },
      { path: '/admin/verifications', body: QUEUE },
      { path: '/admin/verifications/req-1', body: detail('UNDER_REVIEW') },
      { method: 'POST', path: '/admin/verifications/req-1/reject', body: detail('REJECTED', { rejection_reason: 'Document is unreadable.' }) },
    ]);
    renderRoutes(routes, '/admin/verifications');
    await userEvent.click(await screen.findByRole('button', { name: 'Corner Market' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));

    const confirm = screen.getByRole('button', { name: 'Reject request' });
    await userEvent.type(screen.getByRole('textbox'), 'too short');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), ' — unreadable');
    await userEvent.click(confirm);

    await waitFor(() =>
      expect(calls.find((call) => call.path === '/api/v1/admin/verifications/req-1/reject')?.body).toEqual({ reason: 'too short — unreadable' }),
    );
  });

  it('does not offer approval to an administrator who is not the reviewer', async () => {
    mockApi([
      { path: '/me', body: ADMIN },
      { path: '/admin/verifications', body: QUEUE },
      { path: '/admin/verifications/req-1', body: detail('UNDER_REVIEW', { reviewer_id: 'someone-else' }) },
    ]);
    renderRoutes(routes, '/admin/verifications');
    await userEvent.click(await screen.findByRole('button', { name: 'Corner Market' }));

    expect(await screen.findByText(/another administrator is reviewing/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});
