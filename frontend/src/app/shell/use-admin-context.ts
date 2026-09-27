import { useOutletContext } from 'react-router-dom';
import type { Me } from '@/shared/auth/types';

export type AdminContext = { me: Me };

/** The signed-in SUPERADMIN, provided by AdminLayout to every /admin page. */
export function useAdminContext(): AdminContext {
  return useOutletContext<AdminContext>();
}
