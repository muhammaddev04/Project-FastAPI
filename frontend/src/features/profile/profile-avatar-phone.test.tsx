import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '@/app/router';
import { useSessionStore } from '@/shared/auth/session-store';
import { useToasts } from '@/shared/ui/toast-store';
import type { Me } from '@/shared/auth/types';
import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { mockApi, renderRoutes, type MockRoute } from '@/test/render';

const META = {
  version: '0.1.0',
  languages: ['tg', 'ru', 'en'],
  default_language: 'tg',
  currency: 'TJS',
  auth: { password_login: true, registration: true, password_reset: true, email_verification: true, google: true },
};
const AVATAR = 'https://storage.test/private/users/u1/user_avatar/a.webp?X-Amz-Expires=300&X-Amz-Signature=abc';
const NEW_AVATAR = 'https://storage.test/private/users/u1/user_avatar/b.webp?X-Amz-Expires=300&X-Amz-Signature=def';

const me = (overrides: Partial<Me> = {}) =>
  meFixture([membershipFixture(), storeMembership({ role: 'SELLER' })], { phone_verified_at: null, avatar_url: null, ...overrides });

function apiError(code: string, status: number) {
  return { status, body: { error: { code, message: code, details: {}, request_id: 'r' } } };
}

function openProfile(profile: Me, extra: MockRoute[] = []) {
  useSessionStore.setState({ accessToken: 'access-1', activeOrgId: null, endedReason: null, restoring: false });
  const api = mockApi([
    { path: '/meta', body: META },
    { path: '/me', body: profile },
    { path: '/auth/google/link', body: { connected: false, status: null, email: null, linked_at: null } },
    ...extra,
  ]);
  return { ...api, ...renderRoutes(routes, '/profile') };
}

function png(name = 'photo.png', size = 2048, type = 'image/png') {
  return new File([new Uint8Array(size)], name, { type });
}

/** jsdom has no blob: URLs; the preview uses them when the browser provides them. */
function stubObjectUrls() {
  const create = vi.fn(() => 'blob:preview-1');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  return { create, revoke };
}

// Toasts live in a global store (5 s lifetime): start every test without the previous test's messages.
beforeEach(() => useToasts.setState({ items: [] }));

describe('profile photo (CR-003 PUT/DELETE /me/avatar)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the signed avatar in the header and account menu, never the storage key', async () => {
    const { container } = openProfile(me({ avatar_url: AVATAR }));
    const named = await screen.findAllByRole('img', { name: 'Profile photo of Dilshod Rahimov' }); // header + photo card
    named.forEach((img) => expect(img).toHaveAttribute('src', AVATAR));
    expect(container.querySelectorAll(`img[src="${AVATAR}"]`).length).toBeGreaterThanOrEqual(2); // header, card, menu
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeEnabled();
    expect(container.innerHTML).not.toContain('storage_key');
  });

  it('shows initials and an upload action when there is no avatar', async () => {
    const { container } = openProfile(me());
    expect(await screen.findByText('No photo yet — your initials are shown instead.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).not.toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('previews the chosen file, uploads only the file and updates every avatar from the answer', async () => {
    const { revoke } = stubObjectUrls();
    const { calls, container } = openProfile(me(), [{ method: 'PUT', path: '/me/avatar', body: me({ avatar_url: NEW_AVATAR }) }]);
    const input = await screen.findByLabelText('Upload photo', { selector: 'input' });
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    await userEvent.upload(input, png());

    const dialog = await screen.findByRole('dialog', { name: 'Use this profile photo?' });
    expect(within(dialog).getByRole('img', { name: 'Preview of the selected image' })).toHaveAttribute('src', 'blob:preview-1');
    expect(within(dialog).getByText('photo.png')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save photo' }));

    expect(await screen.findByText('Profile photo updated.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.path).toBe('/api/v1/me/avatar');
    const body = put?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()]).toEqual(['file']); // never a user id
    expect((body.get('file') as File).name).toBe('photo.png');
    expect(put?.headers['X-Org-Id']).toBeUndefined();
    await waitFor(() => expect(container.querySelectorAll(`img[src="${NEW_AVATAR}"]`).length).toBeGreaterThanOrEqual(2));
    expect(revoke).toHaveBeenCalledWith('blob:preview-1');
  });

  it('shows the uploading state while the request runs', async () => {
    const { fetchMock } = openProfile(me(), [{ method: 'PUT', path: '/me/avatar', body: me({ avatar_url: NEW_AVATAR }) }]);
    const answer = fetchMock.getMockImplementation()!;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'PUT') await gate;
      return answer(input, init);
    });
    await userEvent.upload(await screen.findByLabelText('Upload photo', { selector: 'input' }), png());
    const save = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save photo' });
    await userEvent.click(save);
    await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
    expect(save).toBeDisabled();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    release();
    expect(await screen.findByText('Profile photo updated.')).toBeInTheDocument();
  });

  it.each([
    ['a GIF', png('anim.gif', 100, 'image/gif'), 'Only JPEG, PNG or WebP images are accepted.'],
    ['a file over 5 MB', png('huge.png', 5 * 1024 * 1024 + 1), 'The image is larger than 5 MB.'],
  ])('refuses %s before any request', async (_label, file, message) => {
    const user = userEvent.setup({ applyAccept: false });
    const { calls } = openProfile(me());
    await user.upload(await screen.findByLabelText('Upload photo', { selector: 'input' }), file);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it.each([
    ['image_dimensions_invalid', 422, 'The image must be at least 64×64 pixels and at most 8000 pixels per side.'],
    ['image_invalid', 422, "This image is damaged or can't be read. Try another file."],
    ['image_type_not_allowed', 422, 'Only JPEG, PNG or WebP images are accepted.'],
    ['image_too_large', 422, 'The image is larger than 5 MB.'],
    ['service_unavailable', 503, 'The service is temporarily unavailable.'],
    ['internal_error', 500, 'An internal error occurred. Please try again later.'],
  ])('explains a server refusal (%s) and keeps the current photo', async (code, status, message) => {
    const { container } = openProfile(me({ avatar_url: AVATAR }), [{ method: 'PUT', path: '/me/avatar', ...apiError(code, status) }]);
    await userEvent.upload(await screen.findByLabelText('Change photo', { selector: 'input' }), png());
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save photo' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(container.querySelector(`img[src="${AVATAR}"]`)).not.toBeNull();
    expect(screen.queryByText('Profile photo updated.')).not.toBeInTheDocument();
  });

  it('removes the avatar after confirmation and falls back to initials', async () => {
    const { calls, container } = openProfile(me({ avatar_url: AVATAR }), [{ method: 'DELETE', path: '/me/avatar', body: me() }]);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove photo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove your profile photo?' });
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false); // nothing happens before confirming
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove photo' }));
    expect(await screen.findByText('Profile photo removed.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'DELETE')?.path).toBe('/api/v1/me/avatar');
    await waitFor(() => expect(container.querySelector(`img[src="${AVATAR}"]`)).toBeNull());
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
  });

  it('opens the file chooser from the keyboard', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    openProfile(me());
    const button = await screen.findByRole('button', { name: 'Upload photo' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('keeps the photo card reachable with its accessible hint', async () => {
    openProfile(me());
    const input = await screen.findByLabelText('Upload photo', { selector: 'input' });
    expect(input).toHaveAccessibleDescription(/JPEG, PNG or WebP, up to 5 MB/);
    expect(screen.getByRole('heading', { name: 'Profile photo' })).toBeInTheDocument();
  });
});

describe('contact phone (CR-003 PATCH /me phone)', () => {
  it('shows the current phone as a contact that is not verified, with no verification flow', async () => {
    openProfile(me({ phone: '+992900000001' }));
    const field = await screen.findByLabelText('Phone number');
    await waitFor(() => expect(field).toHaveValue('+992900000001'));
    expect(screen.getAllByText('Not verified').length).toBeGreaterThan(0);
    expect(screen.getByText(/A contact number only — you always sign in with your email/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /verify|send code/i })).not.toBeInTheDocument();
  });

  it('saves an edited phone normalised to E.164 and shows the answer', async () => {
    const { calls } = openProfile(me({ phone: '+992900000001' }), [{ method: 'PATCH', path: '/me', body: me({ phone: '+992900000099' }) }]);
    const field = await screen.findByLabelText('Phone number');
    await waitFor(() => expect(field).toHaveValue('+992900000001'));
    await userEvent.clear(field);
    await userEvent.type(field, '+992 (90) 000-00-99');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Your profile was saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      full_name: 'Dilshod Rahimov',
      language: 'en',
      phone: '+992900000099',
    });
    await waitFor(() => expect(field).toHaveValue('+992900000099'));
  });

  it('clears the phone with an empty field (sent as null)', async () => {
    const { calls } = openProfile(me({ phone: '+992900000001' }), [{ method: 'PATCH', path: '/me', body: me({ phone: null }) }]);
    const field = await screen.findByLabelText('Phone number');
    await waitFor(() => expect(field).toHaveValue('+992900000001'));
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Your profile was saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ full_name: 'Dilshod Rahimov', language: 'en', phone: null });
  });

  it('does not send the phone when only the name changes', async () => {
    const { calls } = openProfile(me({ phone: '+992900000001' }), [
      { method: 'PATCH', path: '/me', body: me({ full_name: 'Nigina Karimova' }) },
    ]);
    const name = await screen.findByLabelText('Full name');
    await waitFor(() => expect(name).toHaveValue('Dilshod Rahimov'));
    await userEvent.clear(name);
    await userEvent.type(name, 'Nigina Karimova');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ full_name: 'Nigina Karimova', language: 'en' }),
    );
  });

  it('shows phone_taken on the phone field instead of a generic error', async () => {
    openProfile(me({ phone: '+992900000001' }), [{ method: 'PATCH', path: '/me', ...apiError('phone_taken', 409) }]);
    const field = await screen.findByLabelText('Phone number');
    await waitFor(() => expect(field).toHaveValue('+992900000001'));
    await userEvent.clear(field);
    await userEvent.type(field, '+992900000055');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('This phone number is already used by another account.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
  });

  it('checks the format before sending', async () => {
    const { calls } = openProfile(me({ phone: null }));
    const field = await screen.findByLabelText('Phone number');
    await userEvent.type(field, '900000001');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a phone number in international format, e.g. +992 90 123 4567.')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('never offers the phone as a sign-in identifier', async () => {
    useSessionStore.setState({ accessToken: null, activeOrgId: null, endedReason: null, restoring: false });
    mockApi([{ path: '/meta', body: META }]);
    renderRoutes(routes, '/login');
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument();
  });
});

describe('membership chips (CR-003 memberships[].logo_url)', () => {
  it('shows each organization picture when present and the kind mark otherwise', async () => {
    const LOGO = 'https://storage.test/private/org-company/org_logo/l.webp?X-Amz-Expires=300&X-Amz-Signature=x';
    const { container } = openProfile(
      meFixture([membershipFixture({ logo_url: LOGO }), storeMembership({ role: 'SELLER', logo_url: null })], { phone_verified_at: null }),
    );
    const list = (await screen.findByRole('heading', { name: 'My organizations' })).closest('div.p-5, [class*="p-5"]') as HTMLElement;
    expect(await within(list).findByText('Pamir Distribution')).toBeInTheDocument();
    expect(container.querySelectorAll(`img[src="${LOGO}"]`)).toHaveLength(1);
    expect(within(list).getByText('Corner Market')).toBeInTheDocument();
    expect(container.querySelectorAll('li img')).toHaveLength(1); // the store falls back to its mark
  });
});
