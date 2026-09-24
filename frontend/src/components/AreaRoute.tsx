import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { primaryMembership } from '../lib/types';
import { useAuthStore } from '../lib/auth-store';
import { ProtectedRoute } from './ProtectedRoute';

export function AreaRoute({ area, children }: { area: 'COMPANY' | 'STORE'; children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const membership = primaryMembership(user);
  return <ProtectedRoute>{membership?.organization_type === area ? children : <Navigate to="/403" replace />}</ProtectedRoute>;
}
