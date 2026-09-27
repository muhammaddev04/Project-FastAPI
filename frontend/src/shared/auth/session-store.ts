import { create } from 'zustand';
import { apiRequest, configureApiSession } from '@/shared/api/client';

const ACTIVE_ORG_KEY = 'tezfarmo.activeOrgId';

function readActiveOrg(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ORG_KEY);
  } catch {
    return null;
  }
}

type SessionState = {
  /** SEC-004: the access token lives only in memory, never in localStorage/sessionStorage. */
  accessToken: string | null;
  /** P01 §10: the active organization is remembered across reloads. */
  activeOrgId: string | null;
  /** Set when the server rejected the session (401), so the login screen can explain why. */
  endedReason: string | null;
  /** True while the startup session restoration runs; guards wait instead of deciding "guest". */
  restoring: boolean;
  /** Set by login and by the FE-008 refresh; nothing in the app fabricates a token. */
  setAccessToken: (token: string) => void;
  setActiveOrg: (orgId: string | null) => void;
  endSession: (reason?: string | null) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  accessToken: null,
  activeOrgId: readActiveOrg(),
  endedReason: null,
  restoring: false,
  setAccessToken: (token) => set({ accessToken: token, endedReason: null }),
  setActiveOrg: (orgId) => {
    try {
      if (orgId) localStorage.setItem(ACTIVE_ORG_KEY, orgId);
      else localStorage.removeItem(ACTIVE_ORG_KEY);
    } catch {
      /* storage unavailable: keep the in-memory choice */
    }
    set({ activeOrgId: orgId });
  },
  endSession: (reason = null) => set({ accessToken: null, endedReason: reason }),
}));

/** SEC-005: the readable `csrf_token` cookie set at login, echoed as X-CSRF-Token. */
function readCookie(name: string): string | null {
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}

let refreshing: Promise<string | null> | null = null;

/**
 * FE-008: exchange the httpOnly refresh cookie for a new access token once. Concurrent 401s share one request:
 * refresh rotates the cookie, and sending the old one twice would be reported as reuse (IAM-007).
 */
function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const csrf = readCookie('csrf_token');
      if (!csrf) return null;
      try {
        const body = await apiRequest<{ access_token: string }>('/auth/refresh', {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrf },
          authEndpoint: true,
        });
        useSessionStore.getState().setAccessToken(body.access_token);
        return body.access_token;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

let restoreStarted = false;

/**
 * App startup: the access token lives in memory only (SEC-004), so a reload loses it while the httpOnly refresh
 * cookie survives. One FE-008 refresh brings the session back; the user then comes from GET /me as usual.
 * Runs at most once per page load. Without the CSRF cookie (never signed in, or logged out) nothing is sent;
 * a refused refresh simply leaves a guest, with no "signed out" notice and no retry.
 */
export async function restoreSession(): Promise<void> {
  if (restoreStarted) return;
  restoreStarted = true;
  if (useSessionStore.getState().accessToken || !readCookie('csrf_token')) return;
  useSessionStore.setState({ restoring: true });
  try {
    await refreshAccessToken();
  } finally {
    useSessionStore.setState({ restoring: false });
  }
}

/**
 * Sign out on this device (IAM-008 logout): the server revokes this session's refresh family and deletes the
 * refresh and CSRF cookies. The readable CSRF cookie is also expired here, so even if the request fails (offline)
 * the next page load does not restore the session. The in-memory access token is dropped either way.
 */
export async function logoutSession(): Promise<void> {
  const csrf = readCookie('csrf_token');
  if (csrf) {
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, authEndpoint: true });
    } catch {
      /* the local sign-out below still happens */
    }
  }
  document.cookie = 'csrf_token=; Max-Age=0; Path=/; SameSite=Strict';
  useSessionStore.getState().endSession(null);
}

/** Test hook: lets each test start a fresh "page load". */
export function resetSessionRestoreForTests(): void {
  restoreStarted = false;
}

configureApiSession({
  getAccessToken: () => useSessionStore.getState().accessToken,
  getOrgId: () => useSessionStore.getState().activeOrgId,
  onUnauthorized: (error) => useSessionStore.getState().endSession(error.code),
  refreshAccessToken,
});
