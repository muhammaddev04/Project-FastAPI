import { useAreaContext } from '@/app/shell/use-area-context';

/**
 * P10 §9. Returns and disputes are one subject with two queues, and the same six permissions decide both
 * sides of it, so every P10 screen reads its access from here rather than restating the matrix.
 */
export function useReturnsAccess() {
  const { membership, me } = useAreaContext();
  const company = membership.org_type === 'COMPANY';
  return {
    membership,
    userId: me.id,
    orgId: membership.organization_id,
    company,
    base: company ? '/company' : '/store',
    has: (permission: string) => membership.permissions.includes(permission),
  };
}
