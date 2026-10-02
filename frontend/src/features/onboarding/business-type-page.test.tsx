import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { meFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes } from '@/test/render';

/** Step 3 of 5: one question, two answers, nothing else (Phase D). */
describe('onboarding step 3: business type (/welcome)', () => {
  beforeEach(() => useSessionStore.setState({ accessToken: 'fixture-token', activeOrgId: null, endedReason: null, restoring: false }));

  it('asks how the account will be used and explains both sides', async () => {
    mockApi([{ path: '/me', body: meFixture([]) }]);
    renderRoutes(routes, '/welcome');

    expect(await screen.findByRole('heading', { level: 1, name: 'How will you use TezFarmo?' })).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^company/i })).toBeChecked();
    expect(screen.getByText('A shop that buys from its suppliers.')).toBeInTheDocument();
    // Nothing about the organization itself is asked here; that is step 4.
    expect(screen.queryByLabelText(/legal name|tax identifier|address/i)).not.toBeInTheDocument();
  });

  it('marks the selected card without relying on colour alone', async () => {
    mockApi([{ path: '/me', body: meFixture([]) }]);
    renderRoutes(routes, '/welcome');

    const company = await screen.findByRole('radio', { name: /^company/i });
    const store = screen.getByRole('radio', { name: /^store/i });
    expect(company).toBeChecked();
    expect(store).not.toBeChecked();
    await userEvent.click(store);
    expect(store).toBeChecked();
    expect(company).not.toBeChecked();
  });

  it.each([
    ['COMPANY', /^company/i, '/welcome/company'],
    ['STORE', /^store/i, '/welcome/store'],
  ])('sends %s on to its own setup step', async (_type, label, path) => {
    mockApi([{ path: '/me', body: meFixture([]) }]);
    const { current } = renderRoutes(routes, '/welcome');

    await userEvent.click(await screen.findByRole('radio', { name: label }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(current.location?.pathname).toBe(path));
  });

  it('offers the organizations the user already belongs to', async () => {
    const me = meFixture([storeMembership({ verification_status: 'APPROVED' })]);
    mockApi([{ path: '/me', body: me }]);
    const { current } = renderRoutes(
      [...routes.filter((route) => route.path !== '*' && route.path !== '/store'), { path: '/store', element: <p>store area</p> }],
      '/welcome',
    );

    await userEvent.click(await screen.findByRole('button', { name: /Corner Market/ }));
    await waitFor(() => expect(current.location?.pathname).toBe('/store'));
    expect(useSessionStore.getState().activeOrgId).toBe('org-store');
  });
});
