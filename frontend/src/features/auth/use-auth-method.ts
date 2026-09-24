import { useMeta, type AuthMethods } from '@/shared/api/meta';

/**
 * Reads GET /api/v1/meta to learn which sign-in methods this server has enabled.
 * `available` is false while loading, on error, and for methods the backend has not implemented yet.
 */
export function useAuthMethod(method: keyof AuthMethods) {
  const meta = useMeta();
  return { available: meta.data?.auth[method] === true, meta };
}
