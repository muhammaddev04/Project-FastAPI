import { membershipFixture, storeMembership } from '@/test/fixtures';
import type { Role } from '@/shared/auth/types';
import { navByAvailability, navFor } from './nav-config';

const keys = (
  area: 'company' | 'store' | 'courier',
  role: Role,
  permissions: string[] = [
    'partners.view',
    'orders.view',
    'store_catalog.view',
    'cart.manage',
    'finance.view',
    'returns.view',
    'disputes.view',
  ],
) =>
  navFor(area, area === 'store' ? storeMembership({ role, permissions }) : membershipFixture({ role, permissions })).flatMap((section) =>
    section.items.map((item) => item.key),
  );

const OWNER_PERMS = [
  'members.change_role',
  'members.invite',
  'members.revoke',
  'members.suspend',
  'members.view',
  'stock.view',
  'partners.view',
  'orders.view',
  'orders.assemble',
  'store_catalog.view',
  'cart.manage',
  'finance.view',
  'delivery.view_all',
  'returns.view',
  'disputes.view',
  'reports.sales',
  'reports.purchases',
];

describe('role-aware navigation (TZ §4.5, §17, §32.1)', () => {
  it('gives the company owner the whole console', () => {
    expect(keys('company', 'OWNER', OWNER_PERMS)).toEqual([
      'dashboard',
      'orders',
      'warehouseOrders',
      'catalog',
      'inventory',
      'partners',
      'delivery',
      'finance',
      'returns',
      'disputes',
      'reports',
      'exports',
      'team',
      'subscription',
      'settings',
    ]);
  });

  it('lets owners and managers view subscriptions; managers see the team read-only', () => {
    const manager = keys('company', 'MANAGER', ['members.view']);
    expect(manager).toContain('team');
    expect(manager).toContain('subscription');
  });

  it('limits operators to orders, catalog, clients, payments and disputes', () => {
    expect(keys('company', 'OPERATOR')).toEqual(['dashboard', 'orders', 'catalog', 'partners', 'finance', 'returns', 'disputes']);
  });

  it('shows warehouse staff catalog and stock without prices', () => {
    expect(keys('company', 'WAREHOUSE', ['stock.view', 'orders.view', 'orders.assemble'])).toEqual([
      'dashboard',
      'warehouseOrders',
      'catalog',
      'inventory',
    ]);
  });

  it('keeps debt, team and settings from store sellers, who may still read returns and disputes', () => {
    expect(keys('store', 'OWNER', OWNER_PERMS)).toEqual([
      'dashboard',
      'suppliers',
      'catalog',
      'cart',
      'orders',
      'debt',
      'returns',
      'disputes',
      'reports',
      'exports',
      'team',
      'settings',
    ]);
    // P10 §6: a seller reads both queues but opens neither, so the pages are visible and their actions are not.
    expect(keys('store', 'SELLER')).toEqual(['dashboard', 'suppliers', 'catalog', 'cart', 'orders', 'returns', 'disputes']);
  });

  it('gives couriers their run screens', () => {
    expect(keys('courier', 'COURIER')).toEqual(['today', 'issues']);
  });

  it('lets operators and warehouse staff reach their permitted reports and exports', () => {
    expect(keys('company', 'OPERATOR', ['reports.funnel'])).toEqual(['dashboard', 'catalog', 'reports', 'exports']);
    expect(keys('company', 'WAREHOUSE', ['reports.inventory'])).toEqual(['dashboard', 'catalog', 'reports', 'exports']);
    expect(keys('company', 'WAREHOUSE', [])).not.toContain('reports');
  });
});

/**
 * Phase C8: the sidebar must state what works today. A company owner previously opened the product to nine
 * entries of which seven led to placeholder pages, which reads as a broken application rather than an early
 * one. These lock the split so a later phase cannot quietly put a planned module back into working navigation.
 */
describe('honest navigation (Phase C8)', () => {
  const owner = membershipFixture({ role: 'OWNER', permissions: OWNER_PERMS });

  it('keeps every unbuilt module out of the working navigation', () => {
    const { available, planned } = navByAvailability('company', owner);
    const availableKeys = available.flatMap((section) => section.items.map((item) => item.key));

    expect(availableKeys).toEqual([
      'dashboard',
      'orders',
      'warehouseOrders',
      'catalog',
      'inventory',
      'partners',
      'delivery',
      'finance',
      'returns',
      'disputes',
      'reports',
      'exports',
      'team',
      'subscription',
      'settings',
    ]);
    // Nothing in the working navigation may carry a phase, which is what marks a placeholder.
    expect(available.flatMap((section) => section.items).every((item) => !item.phase)).toBe(true);
    // ...and everything that does carry one is still reachable, in the roadmap.
    expect(planned.map((item) => item.key)).toEqual([]);
    expect(planned.every((item) => Boolean(item.phase))).toBe(true);
  });

  it('loses no item: available plus planned is exactly what the role could see', () => {
    for (const [area, membership] of [
      ['company', owner],
      ['store', storeMembership({ role: 'OWNER', permissions: OWNER_PERMS })],
      ['courier', membershipFixture({ role: 'COURIER' })],
    ] as const) {
      const { available, planned } = navByAvailability(area, membership);
      const split = [...available.flatMap((section) => section.items), ...planned].map((item) => item.key).sort();
      const all = navFor(area, membership)
        .flatMap((section) => section.items)
        .map((item) => item.key)
        .sort();
      expect(split).toEqual(all);
    }
  });

  it('drops a section that has nothing available rather than leaving an empty heading', () => {
    // Inventory is delivered in P05 and requires the stock.view permission.
    const { available, planned } = navByAvailability('company', membershipFixture({ role: 'WAREHOUSE', permissions: [] }));
    expect(available.flatMap((section) => section.items.map((item) => item.key))).toEqual(['dashboard', 'catalog']);
    expect(available.every((section) => section.items.length > 0)).toBe(true);
    expect(planned.map((item) => item.key)).toEqual([]);
  });
});
