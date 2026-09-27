import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Membership } from '@/shared/auth/types';
import { meFixture, membershipFixture } from '@/test/fixtures';
import { mockApi, renderRoutes, type MockRoute } from '@/test/render';

const OWNER_PERMS = ['org.view', 'org.edit_contacts', 'org.edit_legal', 'verification.submit', 'verification.view', 'members.view'];
const owner = membershipFixture({ permissions: OWNER_PERMS });
const manager = membershipFixture({ role: 'MANAGER', permissions: ['org.view', 'org.edit_contacts', 'verification.view', 'members.view'] });

function state(status: string, extra: Record<string, unknown> = {}) {
  return {
    verification_status: status,
    verified_at: status === 'APPROVED' ? '2026-09-20T10:00:00Z' : null,
    required_documents: ['REGISTRATION_CERTIFICATE', 'TAX_CERTIFICATE'],
    can_submit: status === 'NOT_SUBMITTED' || status === 'REJECTED',
    latest_request: null,
    ...extra,
  };
}

function profile(status: string) {
  return { id: 'org-company', type: 'COMPANY', name: 'Pamir Distribution', legal_name: 'Pamir LLC', tax_identifier: '510012345', verification_status: status, legal_locked: status !== 'NOT_SUBMITTED' && status !== 'REJECTED', version: 1 };
}

function open(membership: Membership, status: string, extra: MockRoute[] = [], stateExtra: Record<string, unknown> = {}) {
  useSessionStore.setState({ accessToken: 'token', activeOrgId: 'org-company', endedReason: null, restoring: false });
  const api = mockApi([
    { path: '/me', body: meFixture([membership]) },
    { path: '/organization', body: profile(status) },
    { path: '/verification', body: state(status, stateExtra) },
    ...extra,
  ]);
  const rendered = renderRoutes(routes, '/company/settings/verification');
  return { ...api, ...rendered };
}

const pdf = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' });

describe('verification page (P02 §8, VER-001/003)', () => {
  it('explains the status, requires both company documents and submits after confirmation', async () => {
    let n = 0;
    const { calls, fetchMock } = open(owner, 'NOT_SUBMITTED', [
      { method: 'POST', path: '/verification', status: 201, body: state('PENDING', { latest_request: { id: 'r1', status: 'SUBMITTED', submitted_at: '2026-09-26T10:00:00Z', review_started_at: null, reviewed_at: null, rejection_reason: null, documents: [] } }) },
    ]);
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/files')) {
        n += 1;
        calls.push({ method: 'POST', path: '/api/v1/files', headers: {}, body: init?.body });
        return new Response(JSON.stringify({ id: `file-${n}`, display_name: `doc${n}.pdf`, size_bytes: 2048, content_type: 'application/pdf', category: 'VERIFICATION', created_at: '2026-09-26T10:00:00Z' }), { status: 201 });
      }
      return answer(input, init);
    });

    expect(await screen.findByRole('heading', { name: 'Verification' })).toBeInTheDocument();
    expect(screen.getAllByText('Not submitted').length).toBeGreaterThan(0);
    expect(screen.getByText(/partnerships cannot be activated/i)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Submit for verification' });
    expect(submit).toBeDisabled();

    await userEvent.upload(screen.getByLabelText('Registration certificate'), pdf('reg.pdf'));
    expect(await screen.findByText('doc1.pdf')).toBeInTheDocument();
    expect(submit).toBeDisabled(); // the tax certificate is still missing
    await userEvent.upload(screen.getByLabelText('Tax registration certificate'), pdf('tax.pdf'));
    await screen.findByText('doc2.pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Submit for verification' }));
    expect(screen.getByText('Submit for verification?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(screen.getAllByText('Pending review').length).toBeGreaterThan(0));
    const upload = calls.find((call) => call.path === '/api/v1/files');
    expect(upload?.body).toBeInstanceOf(FormData);
    expect((upload?.body as FormData).get('category')).toBe('VERIFICATION');
    expect(calls.find((call) => call.path === '/api/v1/verification' && call.method === 'POST')?.body).toEqual({
      documents: [
        { doc_type: 'REGISTRATION_CERTIFICATE', file_id: 'file-1' },
        { doc_type: 'TAX_CERTIFICATE', file_id: 'file-2' },
      ],
    });
    // Nothing claims "verified" before the server does.
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });

  it('checks file type and size in the browser before uploading', async () => {
    const { calls } = open(owner, 'NOT_SUBMITTED');
    await screen.findByRole('heading', { name: 'Verification' });

    await userEvent.upload(screen.getByLabelText('Registration certificate'), new File(['x'], 'photo.gif', { type: 'image/gif' }), { applyAccept: false });

    expect(await screen.findByText('Upload a PDF, JPEG or PNG file.')).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/api/v1/files')).toBe(false);
  });

  it('shows the rejection reason and lets the owner submit again', async () => {
    open(owner, 'REJECTED', [], {
      latest_request: { id: 'r1', status: 'REJECTED', submitted_at: '2026-09-20T10:00:00Z', review_started_at: '2026-09-21T10:00:00Z', reviewed_at: '2026-09-21T11:00:00Z', rejection_reason: 'The tax certificate is unreadable.', documents: [] },
    });

    expect(await screen.findByText('Reason for rejection')).toBeInTheDocument();
    expect(screen.getByText('The tax certificate is unreadable.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Submit again' })).toBeInTheDocument();
  });

  it('lets a manager see the status but not submit', async () => {
    open(manager, 'NOT_SUBMITTED');

    expect(await screen.findByText('Only the organization owner can submit documents for verification.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for verification' })).not.toBeInTheDocument();
  });

  it('shows Verified only when the server says APPROVED', async () => {
    open(owner, 'APPROVED');

    expect((await screen.findAllByText('Verified')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Submit for verification' })).not.toBeInTheDocument();
    expect(screen.queryByText('Verification required')).not.toBeInTheDocument();
  });
});

describe('verification banner (P02 §8)', () => {
  it.each([
    ['NOT_SUBMITTED', 'Verification required'],
    ['PENDING', 'Verification pending'],
    ['REJECTED', 'Verification rejected'],
  ])('shows on company pages while %s', async (status, title) => {
    useSessionStore.setState({ accessToken: 'token', activeOrgId: 'org-company', endedReason: null, restoring: false });
    mockApi([
      { path: '/me', body: meFixture([owner]) },
      { path: '/organization', body: profile(status) },
    ]);
    renderRoutes(routes, '/company');

    const banner = (await screen.findByText(title)).closest('[role]') as HTMLElement;
    expect(within(banner).getByText('Verification is required to activate partnerships.')).toBeInTheDocument();
    expect(within(banner).getByRole('link', { name: 'Open verification' })).toHaveAttribute('href', '/company/settings/verification');
  });

  it('is gone once APPROVED', async () => {
    useSessionStore.setState({ accessToken: 'token', activeOrgId: 'org-company', endedReason: null, restoring: false });
    const { calls } = mockApi([
      { path: '/me', body: meFixture([owner]) },
      { path: '/organization', body: profile('APPROVED') },
    ]);
    renderRoutes(routes, '/company');
    await waitFor(() => expect(calls.some((call) => call.path === '/api/v1/organization')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText(/Verification (required|pending|rejected)/)).not.toBeInTheDocument();
  });
});
