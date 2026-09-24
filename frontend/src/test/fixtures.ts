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
    permissions: ['members.change_role', 'members.invite', 'members.revoke', 'members.suspend', 'members.view'],
    ...overrides,
  };
}

export function meFixture(memberships: Membership[] = [membershipFixture()], overrides: Partial<Me> = {}): Me {
  return {
    id: 'user-1',
    phone: '+992900000001',
    full_name: 'Dilshod Rahimov',
    email: null,
    email_verified: false,
    language: 'en',
    status: 'ACTIVE',
    is_superadmin: false,
    phone_verified_at: '2026-09-01T08:00:00Z',
    last_login_at: null,
    created_at: '2026-09-01T08:00:00Z',
    memberships,
    ...overrides,
  };
}

export const storeMembership = (overrides: Partial<Membership> = {}) =>
  membershipFixture({
    id: 'm-store',
    organization_id: 'org-store',
    org_type: 'STORE',
    org_name: 'Corner Market',
    ...overrides,
  });
