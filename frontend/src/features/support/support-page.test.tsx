import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, membershipFixture } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';

describe('support', () => {
  it('previews and sends a screenshot with the description', async () => {
    const createUrl = vi.fn(() => 'blob:screenshot');
    const revokeUrl = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = revokeUrl;
    try {
      useSessionStore.setState({ accessToken: 'access-1', restoring: false, activeOrgId: null });
      const { calls } = mockApi([
        { path: '/me', body: meFixture([membershipFixture()]) },
        { path: '/support', body: [] },
        { method: 'POST', path: '/support/with-image', status: 201, body: {} },
      ]);
      renderRoutes(routes, '/support');
      await userEvent.type(await screen.findByLabelText('Description'), 'The page layout is broken.');
      const file = new File(['image bytes'], 'screenshot.png', { type: 'image/png' });
      await userEvent.upload(screen.getByLabelText('Attach screenshot'), file);
      expect(await screen.findByAltText('Bug screenshot')).toHaveAttribute('src', 'blob:screenshot');
      await userEvent.click(screen.getByRole('button', { name: 'Bug screenshot' }));
      expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', 'blob:screenshot');
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('Your message has been sent.')).toBeInTheDocument();
      const request = calls.find((call) => call.path === '/api/v1/support/with-image');
      expect(request?.body).toBeInstanceOf(FormData);
      const body = request?.body as FormData;
      expect(body.get('message')).toBe('The page layout is broken.');
      expect(body.get('image')).toBe(file);
      expect(request?.headers['Content-Type']).toBeUndefined();
      expect(revokeUrl).toHaveBeenCalledWith('blob:screenshot');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('appends multiple images, removes one, and sends the rest without text', async () => {
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
      static revokeObjectURL = vi.fn();
    });
    useSessionStore.setState({ accessToken: 'access-1', restoring: false, activeOrgId: null });
    const { calls } = mockApi([
      { path: '/me', body: meFixture([membershipFixture()]) },
      { path: '/support', body: [] },
      { method: 'POST', path: '/support/with-image', status: 201, body: {} },
    ]);
    renderRoutes(routes, '/support');
    await screen.findByLabelText('Description');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Attach screenshot'), file);
    const second = new File(['second'], 'second.png', { type: 'image/png' });
    const third = new File(['third'], 'third.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Attach screenshot'), [second, third]);
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(send).toBeEnabled();
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove image' })[0]!);
    expect(screen.getAllByRole('img')).toHaveLength(2);
    await userEvent.click(send);
    expect(await screen.findByText('Your message has been sent.')).toBeInTheDocument();
    expect((calls.find((call) => call.method === 'POST')?.body as FormData).get('message')).toBe('');
    expect((calls.find((call) => call.method === 'POST')?.body as FormData).getAll('image')).toEqual([second, third]);
    vi.unstubAllGlobals();
  });

  it('shows every submitted image and opens one at full size', async () => {
    useSessionStore.setState({ accessToken: 'access-1', restoring: false, activeOrgId: null });
    mockApi([
      { path: '/me', body: meFixture([membershipFixture()]) },
      { path: '/support', body: [{ id: 'ticket-1', kind: 'BUG', message: '', has_image: true, image_count: 2, status: 'OPEN', created_at: '2026-10-03T08:00:00Z' }] },
      { path: '/support/ticket-1/image', body: { url: 'https://storage.test/image' } },
    ]);
    renderRoutes(routes, '/support');
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Bug screenshot' })).toHaveLength(2));
    await userEvent.click(screen.getAllByRole('button', { name: 'Bug screenshot' })[1]!);
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', 'https://storage.test/image');
  });

  it('lets an administrator reply and resolve a report', async () => {
    useSessionStore.setState({ accessToken: 'access-1', restoring: false, activeOrgId: null });
    const ticket = { id: 'ticket-1', user_id: 'user-1', kind: 'BUG', subject: 'Broken button', message: 'Clicking does nothing.', page_url: null, status: 'OPEN', reply: null, created_at: '2026-10-03T08:00:00Z' };
    const { calls } = mockApi([
      { path: '/me', body: meFixture([], { is_superadmin: true }) },
      { path: '/admin/support', body: [ticket] },
      { method: 'PATCH', path: '/admin/support/ticket-1', body: { ...ticket, status: 'RESOLVED', reply: 'Fixed today.' } },
    ]);
    renderRoutes(routes, '/admin/support');
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'RESOLVED');
    await userEvent.type(screen.getByLabelText('Reply from support'), 'Fixed today.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ status: 'RESOLVED', reply: 'Fixed today.' });
  });

  it('sends a bug report and confirms receipt', async () => {
    useSessionStore.setState({ accessToken: 'access-1', restoring: false, activeOrgId: null });
    const { calls } = mockApi([
      { path: '/me', body: meFixture([membershipFixture()]) },
      { path: '/support', body: [] },
      { method: 'POST', path: '/support', status: 201, body: {} },
    ]);
    renderRoutes(routes, '/support');
    await userEvent.type(await screen.findByLabelText('Description'), 'Help');
    expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Page (optional)')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Your message has been sent.')).toBeInTheDocument();
    await waitFor(() => expect(calls.find((call) => call.method === 'POST' && call.path === '/api/v1/support')?.body).toEqual({
      kind: 'BUG', message: 'Help',
    }));
  });
});
