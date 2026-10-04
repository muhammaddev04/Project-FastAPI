import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSessionStore } from '@/shared/auth/session-store';
import { mockApi, renderWithProviders } from '@/test/render';
import { useUpdateOrganization } from './api';

function Editor() {
  const update = useUpdateOrganization('original-org');
  return <button onClick={() => update.mutate({ city: 'Dushanbe', version: 1 })}>Save profile</button>;
}

it('keeps a profile mutation scoped to its original organization after an organization switch', async () => {
  useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: 'different-org', endedReason: null });
  const { calls } = mockApi([{ method: 'PATCH', path: '/organization', body: {} }]);
  renderWithProviders(<Editor />);
  await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]?.headers['X-Org-Id']).toBe('original-org');
});
