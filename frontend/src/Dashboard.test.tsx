import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { useAuthStore } from './lib/auth-store';
import { changeLanguage } from './i18n';

const companySession = {
  access_token: 'company-access', refresh_token: 'company-refresh', expires_in: 1800,
  user: { id: 'company-user', phone: '+992123456789', full_name: 'Company Owner', language: 'en', status: 'ACTIVE', is_superadmin: false, roles: ['OWNER'], permissions: [], phone_verified_at: '', last_login_at: null, created_at: '', account_type: 'COMPANY' as const, memberships: [{ id: 'company-membership', organization_id: 'company-org', organization_type: 'COMPANY' as const, organization_name: 'North Star Supply', role: 'OWNER', status: 'ACTIVE' as const }] },
};

const storeSession = { ...companySession, user: { ...companySession.user, id: 'store-user', full_name: 'Store Owner', account_type: 'STORE' as const, memberships: [{ id: 'store-membership', organization_id: 'store-org', organization_type: 'STORE' as const, organization_name: 'Corner Market', role: 'OWNER', status: 'ACTIVE' as const }] } };

describe('role dashboards', () => {
  beforeEach(() => { changeLanguage('en'); useAuthStore.getState().clearSession(); });

  it('routes a Company membership to the Company workspace', () => {
    useAuthStore.getState().setSession(companySession);
    render(<App />, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/company']}>{children}</MemoryRouter> });
    expect(screen.getByText('Company workspace')).toBeInTheDocument();
    expect(screen.getByText('North Star Supply')).toBeInTheDocument();
  });

  it('routes a Store membership to the Store workspace', () => {
    useAuthStore.getState().setSession(storeSession);
    render(<App />, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/store']}>{children}</MemoryRouter> });
    expect(screen.getByText('Store workspace')).toBeInTheDocument();
    expect(screen.getByText('Corner Market')).toBeInTheDocument();
  });

  it('denies a Store membership from the Company workspace', () => {
    useAuthStore.getState().setSession(storeSession);
    render(<App />, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/company']}>{children}</MemoryRouter> });
    expect(screen.getByText(/do not have access/i)).toBeInTheDocument();
  });
});
