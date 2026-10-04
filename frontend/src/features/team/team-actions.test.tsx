import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Member } from '@/shared/auth/types';
import { membershipFixture } from '@/test/fixtures';
import { mockApi, renderWithProviders } from '@/test/render';
import { InviteDialog, MemberActions } from './team-actions';
import { LeaveMembership } from './leave-membership';

const member: Member = {
  id: 'member-2',
  user_id: 'user-2',
  full_name: 'Recipient',
  email: 'recipient@example.tj',
  phone: null,
  role: 'OPERATOR',
  status: 'ACTIVE',
  joined_at: '2026-09-01T08:00:00Z',
  version: 7,
};

describe('P01 team mutations', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: 'another-org', endedReason: null }));

  it('normalizes an invitation and captures its organization and idempotency key', async () => {
    const { calls } = mockApi([{ method: 'POST', path: '/members/invitations', status: 201, body: {} }]);
    const close = vi.fn();
    renderWithProviders(<InviteDialog membership={membershipFixture()} open onClose={close} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'Recipient@Example.tj');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(calls[0]?.body).toEqual({ email: 'recipient@example.tj', role: 'MANAGER' });
    expect(calls[0]?.headers['X-Org-Id']).toBe('org-company');
    expect(calls[0]?.headers['Idempotency-Key']).toBeTruthy();
  });

  it('only offers the seller role for a store invitation', () => {
    renderWithProviders(<InviteDialog membership={membershipFixture({ org_type: 'STORE' })} open onClose={vi.fn()} />);
    expect(
      within(screen.getByRole('combobox'))
        .getAllByRole('option')
        .map((option) => option.getAttribute('value')),
    ).toEqual(['SELLER']);
  });

  it.each([
    { role: 'MANAGER' as const },
    { role: 'OWNER' as const, own: true },
    { role: 'OWNER' as const, targetOwner: true },
    { role: 'OWNER' as const, revoked: true },
  ])('hides actions from protected targets or actors: %j', ({ role, own, targetOwner, revoked }) => {
    renderWithProviders(
      <MemberActions
        membership={membershipFixture({ role })}
        userId={own ? member.user_id : 'owner'}
        member={{ ...member, role: targetOwner ? 'OWNER' : member.role, status: revoked ? 'REVOKED' : 'ACTIVE' }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Change role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke membership' })).not.toBeInTheDocument();
  });

  it('requires a reason before suspending and sends the captured organization', async () => {
    const { calls } = mockApi([{ method: 'POST', path: '/members/member-2/suspend', body: member }]);
    renderWithProviders(<MemberActions member={member} membership={membershipFixture()} userId="owner" />);
    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), '  Temporary absence  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls[0]?.body).toEqual({ reason: 'Temporary absence' });
    expect(calls[0]?.headers['X-Org-Id']).toBe('org-company');
  });

  it('sends the current version with a role change', async () => {
    const { calls } = mockApi([{ method: 'PATCH', path: '/members/member-2', body: member }]);
    renderWithProviders(<MemberActions member={member} membership={membershipFixture()} userId="owner" />);
    await userEvent.click(screen.getByRole('button', { name: 'Change role' }));
    await userEvent.selectOptions(screen.getByRole('combobox'), 'MANAGER');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ role: 'MANAGER', version: 7 });
  });

  it('keeps an unsuccessful invitation open and reuses the key on retry', async () => {
    const { calls } = mockApi([
      {
        method: 'POST',
        path: '/members/invitations',
        status: 503,
        body: { error: { code: 'email_delivery_failed', message: 'Email unavailable', details: {}, request_id: 'test' } },
      },
    ]);
    const close = vi.fn();
    renderWithProviders(<InviteDialog membership={membershipFixture()} open onClose={close} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'recipient@example.tj');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(close).not.toHaveBeenCalled();
    expect(calls[0]?.headers['Idempotency-Key']).toBe(calls[1]?.headers['Idempotency-Key']);
  });

  it('confirms leaving the selected membership rather than the active organization', async () => {
    const { calls } = mockApi([{ method: 'POST', path: '/members/leave', status: 204 }]);
    renderWithProviders(<LeaveMembership membership={membershipFixture({ role: 'OPERATOR' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Leave organization' }));
    expect(screen.getByText(/Leave Pamir Distribution\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls[0]?.headers['X-Org-Id']).toBe('org-company');
    expect(useSessionStore.getState().activeOrgId).toBe('another-org');
  });
});
