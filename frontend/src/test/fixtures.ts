import type { Me, Membership } from '@/shared/auth/types';

/** Test fixtures shaped like GET /api/v1/me. Never used by application code. */
export function membershipFixture(overrides: Partial<Membership> = {}): Membership {
  return {
    id: 'm-company',
    organization_id: 'org-company',
    org_type: 'COMPANY',
    org_name: 'Pamir Distribution',
    org_status: 'ACTIVE',
    role: 'OWNER',
    status: 'ACTIVE',
    joined_at: '2026-09-01T08:00:00Z',
    permissions: [
      'members.change_role',
      'members.invite',
      'members.revoke',
      'members.suspend',
      'members.view',
      'subscription.view',
      'subscription.manage',
      'catalog.view',
      'catalog.manage',
      'pricing.view',
      'pricing.manage',
      'import.run',
      'stock.view',
      'stock.receive',
      'stock.adjust',
      'stock.write_off',
      'stock.settings',
      'partners.view',
      'partners.manage',
      'partners.terminate',
      'terms.view',
      'terms.manage',
      'terms.manage_credit',
    ],
    verification_status: 'APPROVED',
    ...overrides,
  };
}

export function meFixture(memberships: Membership[] = [membershipFixture()], overrides: Partial<Me> = {}): Me {
  return {
    id: 'user-1',
    email: 'dilshod@pamir.tj',
    phone: '+992900000001',
    full_name: 'Dilshod Rahimov',
    email_verified: true,
    language: 'en',
    status: 'ACTIVE',
    is_superadmin: false,
    phone_verified_at: '2026-09-01T08:00:00Z',
    last_login_at: null,
    created_at: '2026-09-01T08:00:00Z',
    memberships,
    onboarding: { org_type: null, org_name: null },
    ...overrides,
  };
}

export const storeMembership = (overrides: Partial<Membership> = {}) =>
  membershipFixture({
    id: 'm-store',
    organization_id: 'org-store',
    org_type: 'STORE',
    org_name: 'Corner Market',
    permissions: [
      'members.change_role',
      'members.invite',
      'members.revoke',
      'members.suspend',
      'members.view',
      'partners.view',
      'partners.manage',
      'partners.terminate',
      'terms.view',
    ],
    ...overrides,
  });
