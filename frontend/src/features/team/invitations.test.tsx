import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSessionStore } from '@/shared/auth/session-store';
import { membershipFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';
import { InvitationsInbox } from './invitations';

const invitation = {
  id: 'invitation-1',
  organization_id: 'org-company',
  org_name: 'Pamir Distribution',
  org_type: 'COMPANY',
  email: 'recipient@example.tj',
  role: 'MANAGER',
  status: 'PENDING',
  invited_by: 'owner',
  created_at: '2026-10-01T00:00:00Z',
  expires_at: '2026-10-08T00:00:00Z',
  responded_at: null,
};
const inbox = { count: 1, limit: 20, offset: 0, results: [invitation] };
const routes = [
  { path: '/invitations', element: <InvitationsInbox /> },
  { path: '/company', element: <p>Company home</p> },
];

describe('P01 invitation inbox', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: null, endedReason: null }));

  it('accepts with an idempotency key, selects the returned membership and opens its area', async () => {
    const { calls } = mockApi([
      { path: '/me/invitations', body: inbox },
      { method: 'POST', path: '/me/invitations/invitation-1/accept', body: membershipFixture({ role: 'MANAGER' }) },
    ]);
    const { current } = renderRoutes(routes, '/invitations');
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Pamir Distribution');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(current.location?.pathname).toBe('/company'));
    expect(useSessionStore.getState().activeOrgId).toBe('org-company');
    expect(calls.find((call) => call.method === 'POST')?.headers['Idempotency-Key']).toBeTruthy();
    expect(calls.find((call) => call.method === 'POST')?.headers['X-Org-Id']).toBeUndefined();
  });

  it('keeps a mismatched email error visible without changing organization', async () => {
    const { calls } = mockApi([
      { path: '/me/invitations', body: inbox },
      {
        method: 'POST',
        path: '/me/invitations/invitation-1/decline',
        status: 403,
        body: { error: { code: 'invitation_email_mismatch', message: 'Wrong account', details: {}, request_id: 'test' } },
      },
    ]);
    const { current } = renderRoutes(routes, '/invitations');
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(current.location?.pathname).toBe('/invitations');
    expect(useSessionStore.getState().activeOrgId).toBeNull();
    expect(calls.find((call) => call.method === 'POST')?.path).toBe('/api/v1/me/invitations/invitation-1/decline');
  });
});
