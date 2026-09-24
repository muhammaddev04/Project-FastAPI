import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from './session-store';

/**
 * Forgets the in-memory session and cached user data on this device.
 * Server-side revocation (POST /auth/logout, P01 IAM-008) belongs to the deferred session work.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const endSession = useSessionStore((state) => state.endSession);
  return useCallback(() => {
    endSession(null);
    queryClient.clear();
    navigate('/login', { replace: true });
  }, [endSession, navigate, queryClient]);
}
