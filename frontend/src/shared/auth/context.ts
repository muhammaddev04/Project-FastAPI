import type { Me, Membership, OrgType } from './types';

export type Area = 'company' | 'store' | 'courier';

/** A membership that can open an application area right now. */
export function isUsable(membership: Membership): boolean {
  return membership.status === 'ACTIVE' && membership.org_status !== 'BLOCKED';
}

export function usableMemberships(me: Me): Membership[] {
  return me.memberships.filter(isUsable);
}

/** FND-032 areas: couriers of a company get the mobile courier area; everyone else follows the org type. */
export function areaFor(membership: Membership): Area {
  if (membership.org_type === 'STORE') return 'store';
  return membership.role === 'COURIER' ? 'courier' : 'company';
}

export function orgTypeForArea(area: Area): OrgType {
  return area === 'store' ? 'STORE' : 'COMPANY';
}

/** Remembered organization if still usable, otherwise the first usable membership. */
export function resolveActiveMembership(me: Me, activeOrgId: string | null): Membership | null {
  const usable = usableMemberships(me);
  return usable.find((membership) => membership.organization_id === activeOrgId) ?? usable[0] ?? null;
}

export function areaHome(area: Area): string {
  return `/${area}`;
}

/** Where an authenticated user lands: their active area, or onboarding when they have no organization. */
export function homePath(me: Me, activeOrgId: string | null): string {
  const membership = resolveActiveMembership(me, activeOrgId);
  return membership ? areaHome(areaFor(membership)) : '/welcome';
}

/** Only same-app relative paths are accepted as post-login destinations (no open redirects). */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  return next;
}
