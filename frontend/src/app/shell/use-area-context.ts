import { useOutletContext } from 'react-router-dom';
import type { AreaContext } from '@/shared/auth/guards';

/** Active user and membership provided by AreaLayout to every page inside an area. */
export function useAreaContext(): AreaContext {
  return useOutletContext<AreaContext>();
}
