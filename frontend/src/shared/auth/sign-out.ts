import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { logoutSession } from './session-store';

/**
 * Signs out: the server ends this device's session (POST /auth/logout, IAM-008) and clears its cookies, then the
 * cached user data is dropped and the user lands on /login. A reload or a visit to `/` then stays signed out.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async () => {
    if (!(await logoutSession({ warnPending: true }))) return;
    queryClient.clear();
    navigate('/login', { replace: true });
  }, [navigate, queryClient]);
}
