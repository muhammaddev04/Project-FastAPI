import { membershipFixture, storeMembership } from '@/test/fixtures';
import type { Role } from '@/shared/auth/types';
import { navFor } from './nav-config';

const keys = (area: 'company' | 'store' | 'courier', role: Role, permissions: string[] = []) =>
  navFor(area, area === 'store' ? storeMembership({ role, permissions }) : membershipFixture({ role, permissions })).flatMap(
    (section) => section.items.map((item) => item.key),
  );

const OWNER_PERMS = ['members.change_role', 'members.invite', 'members.revoke', 'members.suspend', 'members.view'];

describe('role-aware navigation (TZ §4.5, §17, §32.1)', () => {
  it('gives the company owner the whole console', () => {
    expect(keys('company', 'OWNER', OWNER_PERMS)).toEqual([
      'dashboard', 'orders', 'catalog', 'inventory', 'partners', 'delivery', 'finance', 'returns', 'reports',
      'team', 'subscription', 'settings',
    ]);
  });

  it('keeps subscription with the owner only; managers see the team read-only', () => {
    const manager = keys('company', 'MANAGER', ['members.view']);
    expect(manager).toContain('team');
    expect(manager).not.toContain('subscription');
  });

  it('limits operators to orders, catalog, clients, payments and disputes', () => {
    expect(keys('company', 'OPERATOR')).toEqual(['dashboard', 'orders', 'catalog', 'partners', 'finance', 'returns']);
  });

  it('shows warehouse staff stock only (no prices)', () => {
    expect(keys('company', 'WAREHOUSE')).toEqual(['dashboard', 'inventory']);
  });

  it('keeps debt, disputes, team and settings from store sellers', () => {
    expect(keys('store', 'OWNER', OWNER_PERMS)).toEqual([
      'dashboard', 'suppliers', 'catalog', 'cart', 'orders', 'debt', 'returns', 'team', 'settings',
    ]);
    expect(keys('store', 'SELLER')).toEqual(['dashboard', 'suppliers', 'catalog', 'cart', 'orders']);
  });

  it('gives couriers their run screens', () => {
    expect(keys('courier', 'COURIER')).toEqual(['today', 'history']);
  });
});
