import { create } from 'zustand';
import { configureApiSession } from '@/shared/api/client';

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
  /**
   * Entry point for the P01 session service (login/registration/refresh). That service is deferred;
   * nothing in the app calls this with a fabricated token.
   */
  setAccessToken: (token: string) => void;
  setActiveOrg: (orgId: string | null) => void;
  endSession: (reason?: string | null) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  accessToken: null,
  activeOrgId: readActiveOrg(),
  endedReason: null,
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

configureApiSession({
  getAccessToken: () => useSessionStore.getState().accessToken,
  getOrgId: () => useSessionStore.getState().activeOrgId,
  onUnauthorized: (error) => useSessionStore.getState().endSession(error.code),
});
