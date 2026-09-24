import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../lib/auth-store';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, isRestoring } = useAuthStore();
  if (isRestoring) return <main className="route-loading" aria-busy="true"><span className="auth-button__spinner" /> Restoring your session...</main>;
  return user ? <>{children}</> : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
