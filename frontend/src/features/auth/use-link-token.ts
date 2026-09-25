import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Reads the one-time `token` from an email link once, then removes it from the address bar so it does not linger
 * in browser history or leak through the Referer header. The value is kept in memory only.
 */
export function useLinkToken(): string | null {
  const [params, setParams] = useSearchParams();
  const [token] = useState(() => params.get('token'));
  useEffect(() => {
    if (params.has('token')) {
      const next = new URLSearchParams(params);
      next.delete('token');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);
  return token && token.length >= 16 && token.length <= 512 ? token : null;
}
