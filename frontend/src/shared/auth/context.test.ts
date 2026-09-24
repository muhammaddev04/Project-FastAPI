import { meFixture, membershipFixture, storeMembership } from '@/test/fixtures';
import { areaFor, homePath, resolveActiveMembership, safeNextPath } from './context';

describe('context resolution', () => {
  it('sends users without organizations to onboarding', () => {
    expect(homePath(meFixture([]), null)).toBe('/welcome');
  });

  it('routes Company members to /company and Store members to /store', () => {
    expect(homePath(meFixture([membershipFixture()]), null)).toBe('/company');
    expect(homePath(meFixture([storeMembership({ role: 'SELLER' })]), null)).toBe('/store');
  });

  it('routes company couriers to the courier area', () => {
    expect(areaFor(membershipFixture({ role: 'COURIER' }))).toBe('courier');
  });

  it('prefers the remembered organization and falls back when it is no longer usable', () => {
    const me = meFixture([membershipFixture(), storeMembership()]);
    expect(resolveActiveMembership(me, 'org-store')?.org_type).toBe('STORE');
    expect(resolveActiveMembership(me, 'org-unknown')?.org_type).toBe('COMPANY');
    const suspended = meFixture([membershipFixture({ status: 'SUSPENDED' }), storeMembership()]);
    expect(resolveActiveMembership(suspended, 'org-company')?.org_type).toBe('STORE');
  });

  it('never resolves a blocked organization', () => {
    expect(homePath(meFixture([membershipFixture({ org_status: 'BLOCKED' })]), null)).toBe('/welcome');
  });

  it('accepts only same-app relative next paths', () => {
    expect(safeNextPath('/company/team')).toBe('/company/team');
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
