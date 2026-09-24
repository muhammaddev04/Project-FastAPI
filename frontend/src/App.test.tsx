import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { RoleSelector } from './components/RoleSelector';
import { useAuthStore } from './lib/auth-store';
import { changeLanguage } from './i18n';

const user = {
  id: 'user-1', phone: '+992123456789', full_name: 'Test User', language: 'en', status: 'ACTIVE',
  is_superadmin: false, roles: ['OWNER'], permissions: ['members.view'], phone_verified_at: '', last_login_at: null, created_at: '', account_type: 'COMPANY',
  memberships: [{ id: 'membership-1', organization_id: 'org-1', organization_type: 'COMPANY', organization_name: 'Test Company', role: 'OWNER', status: 'ACTIVE' }],
};
const session = { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 1800, user };

function mockFetch(response: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, headers: new Headers({ 'content-type': 'application/json' }), json: async () => response }));
}

describe('authentication frontend', () => {
  beforeEach(() => {
    localStorage.setItem('tezfarmo.language', 'en');
    changeLanguage('en');
    sessionStorage.clear();
    useAuthStore.getState().clearSession();
    vi.restoreAllMocks();
  });

  it('renders a dedicated login page with Google and registration navigation', () => {
    render(<App />, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/login']}>{children}</MemoryRouter> });
    expect(screen.getByRole('heading', { name: /sign in to tezfarmo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create one/i })).toHaveAttribute('href', '/register');
  });

  it('renders registration role choices and switches to Store', () => {
    const onChange = vi.fn();
    render(<RoleSelector value="COMPANY" onChange={onChange} />);
    const storeCard = screen.getByText('Retail store').closest('button');
    if (!storeCard) throw new Error('Store role card was not rendered');
    fireEvent.click(storeCard);
    expect(onChange).toHaveBeenCalledWith('STORE');
  });

  it('shows login validation before calling the backend', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<App />, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/login']}>{children}</MemoryRouter> });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid phone number/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits login, stores session, and shows the protected welcome route', async () => {
    mockFetch(session);
    render(<App />, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/login']}>{children}</MemoryRouter> });
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: user.phone } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'UniqueStrongPass123' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(useAuthStore.getState().user?.full_name).toBe('Test User'));
  });

  it('shows a backend error in user-friendly language', async () => {
    mockFetch({ detail: { code: 'invalid_credentials', message: 'Invalid phone or password' } }, false);
    render(<App />, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/login']}>{children}</MemoryRouter> });
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: user.phone } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not correct/i);
  });

  it('completes the phone, OTP, profile, and Store registration flow', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ debug_code: '123456' }) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ registration_token: 'registration-token' }) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => session });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/register']}>{children}</MemoryRouter> });
    fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: user.phone } });
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    fireEvent.change(await screen.findByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify phone/i }));
    fireEvent.change(await screen.findByLabelText(/full name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/create password/i), { target: { value: 'UniqueStrongPass123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'UniqueStrongPass123' } });
    const storeCard = screen.getAllByText('Retail store').map((element) => element.closest('button')).find(Boolean);
    if (!storeCard) throw new Error('Store role card was not rendered');
    fireEvent.click(storeCard);
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(useAuthStore.getState().user?.full_name).toBe('Test User'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
