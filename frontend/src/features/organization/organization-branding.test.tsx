import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import type { Membership } from '@/shared/auth/types';
import { useToasts } from '@/shared/ui/toast-store';
import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes, type MockRoute } from '@/test/render';

const OWNER_PERMS = ['org.view', 'org.edit_contacts', 'org.edit_legal', 'org.edit_branding', 'verification.submit', 'verification.view', 'members.view'];
const LOGO = 'https://storage.test/private/org-company/org_logo/a.webp?X-Amz-Expires=300&X-Amz-Signature=a';
const NEW_LOGO = 'https://storage.test/private/org-company/org_logo/b.webp?X-Amz-Expires=300&X-Amz-Signature=b';
const STORE_IMAGE = 'https://storage.test/private/org-store/org_logo/s.webp?X-Amz-Expires=300&X-Amz-Signature=s';

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'org-company',
    type: 'COMPANY',
    name: 'Pamir Distribution',
    status: 'ACTIVE',
    legal_name: 'Pamir Distribution LLC',
    tax_identifier: '510012345',
    public_code: 'PMR4821',
    phone: '+992900000001',
    email: null,
    city: 'Dushanbe',
    address: 'Rudaki 10',
    latitude: null,
    longitude: null,
    verification_status: 'APPROVED',
    verified_at: '2026-09-20T10:00:00Z',
    legal_locked: true,
    version: 3,
    logo_url: null,
    ...overrides,
  };
}

const storeProfile = (overrides: Record<string, unknown> = {}) =>
  profile({ id: 'org-store', type: 'STORE', name: 'Corner Market', public_code: null, ...overrides });

const EMPTY_PAGE = { count: 0, limit: 1, offset: 0, results: [] };

function apiError(code: string, status: number) {
  return { status, body: { error: { code, message: code, details: {}, request_id: 'r' } } };
}

function png(name = 'logo.png') {
  return new File([new Uint8Array(4096)], name, { type: 'image/png' });
}

/** Opens /<area>/settings/profile; `meRoute` stays mutable so a test can change what the next GET /me returns. */
function open(area: 'company' | 'store', membership: Membership, org: Record<string, unknown>, extra: MockRoute[] = []) {
  useSessionStore.setState({ accessToken: 'token', activeOrgId: membership.organization_id, endedReason: null, restoring: false });
  const meRoute: MockRoute = { path: '/me', body: meFixture([membership]) };
  const api = mockApi([
    meRoute,
    { path: '/organization', body: org },
    { path: '/verification', body: { verification_status: 'APPROVED', verified_at: null, required_documents: [], can_submit: false, latest_request: null } },
    { path: '/members', body: EMPTY_PAGE },
    ...extra,
  ]);
  return { ...api, meRoute, ...renderRoutes(routes, `/${area}/settings/profile`) };
}

async function chooseAndSave(inputLabel: string, confirmLabel: string) {
  await userEvent.upload(await screen.findByLabelText(inputLabel, { selector: 'input' }), png());
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: confirmLabel }));
}

const owner = membershipFixture({ permissions: OWNER_PERMS });
const storeOwner = storeMembership({ permissions: OWNER_PERMS });

beforeEach(() => useToasts.setState({ items: [] }));

describe('organization image (CR-003 PUT/DELETE /organization/logo)', () => {
  it('shows the company logo as a company logo', async () => {
    const { container } = open('company', owner, profile({ logo_url: LOGO }));
    expect(await screen.findByRole('heading', { name: 'Company logo' })).toBeInTheDocument();
    const named = await screen.findAllByRole('img', { name: 'Logo of Pamir Distribution' });
    named.forEach((img) => expect(img).toHaveAttribute('src', LOGO));
    expect(screen.getByRole('button', { name: 'Change logo' })).toBeEnabled();
    expect(container.innerHTML).not.toMatch(/Store image/);
  });

  it('shows the store image as a store image, never as a company logo', async () => {
    open('store', storeOwner, storeProfile({ logo_url: STORE_IMAGE }));
    expect(await screen.findByRole('heading', { name: 'Store image' })).toBeInTheDocument();
    const named = await screen.findAllByRole('img', { name: 'Image of Corner Market' });
    named.forEach((img) => expect(img).toHaveAttribute('src', STORE_IMAGE));
    expect(screen.getByRole('button', { name: 'Change image' })).toBeEnabled();
    expect(screen.queryByText(/Company logo/)).not.toBeInTheDocument();
  });

  it('shows the no-image state with an upload action', async () => {
    open('company', owner, profile());
    expect(await screen.findByText('No logo yet — the company mark is shown instead.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument();
  });

  it('uploads for the active organization only and refreshes the profile and the membership chips', async () => {
    const { calls, meRoute, container } = open('company', owner, profile(), [
      { method: 'PUT', path: '/organization/logo', body: profile({ logo_url: NEW_LOGO }) },
    ]);
    meRoute.body = meFixture([membershipFixture({ permissions: OWNER_PERMS, logo_url: NEW_LOGO })]);
    await chooseAndSave('Upload logo', 'Save logo');

    expect(await screen.findByText('Company logo updated.')).toBeInTheDocument();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.path).toBe('/api/v1/organization/logo');
    expect(put?.headers['X-Org-Id']).toBe('org-company'); // the active organization, never one from the body
    expect([...(put?.body as FormData).keys()]).toEqual(['file']);
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Logo of Pamir Distribution' })[0]).toHaveAttribute('src', NEW_LOGO));
    // /me is refetched so the switcher shows the new picture too.
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET' && call.path === '/api/v1/me').length).toBeGreaterThan(1));
    await waitFor(() => expect(container.querySelector(`[aria-label="Switch organization"] img[src="${NEW_LOGO}"]`)).not.toBeNull());
  });

  it('replaces an existing store image', async () => {
    const { calls } = open('store', storeOwner, storeProfile({ logo_url: STORE_IMAGE }), [
      { method: 'PUT', path: '/organization/logo', body: storeProfile({ logo_url: NEW_LOGO }) },
    ]);
    await chooseAndSave('Change image', 'Save image');
    expect(await screen.findByText('Store image updated.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PUT')?.headers['X-Org-Id']).toBe('org-store');
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Image of Corner Market' })[0]).toHaveAttribute('src', NEW_LOGO));
  });

  it('removes the logo after confirmation and shows the mark again', async () => {
    const { calls, container } = open('company', owner, profile({ logo_url: LOGO }), [{ method: 'DELETE', path: '/organization/logo', body: profile() }]);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove logo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove the company logo?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove logo' }));
    expect(await screen.findByText('Company logo removed.')).toBeInTheDocument();
    const del = calls.find((call) => call.method === 'DELETE');
    expect(del?.path).toBe('/api/v1/organization/logo');
    expect(del?.headers['X-Org-Id']).toBe('org-company');
    await waitFor(() => expect(container.querySelector(`main img[src="${LOGO}"], section img[src="${LOGO}"]`)).toBeNull());
    expect(screen.getByText('No logo yet — the company mark is shown instead.')).toBeInTheDocument();
  });

  it.each([
    ['COMPANY', 'MANAGER', ['org.view', 'org.edit_contacts', 'members.view', 'verification.view']],
    ['COMPANY', 'OPERATOR', ['org.view']],
    ['STORE', 'SELLER', ['org.view']],
  ] as const)('a %s %s may view the picture but gets no branding editor', async (type, role, permissions) => {
    const isStore = type === 'STORE';
    const membership = isStore ? storeMembership({ role, permissions: [...permissions] }) : membershipFixture({ role, permissions: [...permissions] });
    const { calls } = open(isStore ? 'store' : 'company', membership, isStore ? storeProfile({ logo_url: STORE_IMAGE }) : profile({ logo_url: LOGO }));
    const alt = isStore ? 'Image of Corner Market' : 'Logo of Pamir Distribution';
    expect((await screen.findAllByRole('img', { name: alt })).length).toBeGreaterThan(0);
    expect(screen.getByText(isStore ? 'Only the owner can change the store image.' : 'Only the owner can change the company logo.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Upload|Change|Remove) (logo|image)$/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^(Upload|Change) (logo|image)$/, { selector: 'input' })).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === 'PUT' || call.method === 'DELETE')).toBe(false);
  });

  it.each([
    ['permission_denied', 403, "You don't have permission for this action."],
    ['organization_blocked', 403, 'This organization is blocked.'],
    ['org_context_required', 400, 'Choose an organization to continue.'],
    ['not_found', 404, 'Not found.'],
    ['image_invalid', 422, "This image is damaged or can't be read. Try another file."],
    ['service_unavailable', 503, 'The service is temporarily unavailable.'],
  ])('explains a refused upload (%s) and keeps the current logo', async (code, status, message) => {
    open('company', owner, profile({ logo_url: LOGO }), [{ method: 'PUT', path: '/organization/logo', ...apiError(code, status) }]);
    await chooseAndSave('Change logo', 'Save logo');
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Company logo updated.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Logo of Pamir Distribution' })[0]).toHaveAttribute('src', LOGO);
  });
});

describe('membership chips (CR-003 memberships[].logo_url)', () => {
  it('uses the organization picture in the switcher and falls back to the mark when null', async () => {
    useSessionStore.setState({ accessToken: 'token', activeOrgId: 'org-company', endedReason: null, restoring: false });
    mockApi([
      { path: '/me', body: meFixture([membershipFixture({ permissions: OWNER_PERMS, logo_url: LOGO }), storeMembership({ permissions: OWNER_PERMS, logo_url: null })]) },
      { path: '/organization', body: profile({ logo_url: LOGO }) },
      { path: '/verification', body: { verification_status: 'APPROVED', verified_at: null, required_documents: [], can_submit: false, latest_request: null } },
      { path: '/members', body: EMPTY_PAGE },
    ]);
    const { container } = renderRoutes(routes, '/company/settings/profile');
    const switcher = await screen.findByRole('button', { name: 'Switch organization' });
    await waitFor(() => expect(switcher.querySelector(`img[src="${LOGO}"]`)).not.toBeNull());
    await userEvent.click(switcher);
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    const company = items.find((item) => item.textContent?.includes('Pamir Distribution'))!;
    const store = items.find((item) => item.textContent?.includes('Corner Market'))!;
    expect(company.querySelector(`img[src="${LOGO}"]`)).not.toBeNull();
    expect(store.querySelector('img')).toBeNull(); // null logo_url: the store mark
    expect(container.innerHTML).not.toContain('storage_key');
  });
});
