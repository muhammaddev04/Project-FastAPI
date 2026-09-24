import { create } from 'zustand';
import type { AuthResponse, User } from './types';
import { apiFetch, friendlyAuthError } from './api';

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  isRestoring: boolean;
  setSession: (session: AuthResponse) => void;
  restore: () => Promise<void>;
  refreshAccess: () => Promise<string | null>;
  logout: () => Promise<void>;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  refreshToken: typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('tezfarmo.refresh') : null,
  user: null,
  isRestoring: true,
  setSession: (session) => {
    sessionStorage.setItem('tezfarmo.refresh', session.refresh_token);
    set({ accessToken: session.access_token, refreshToken: session.refresh_token, user: session.user, isRestoring: false });
  },
  restore: async () => {
    const refreshToken = get().refreshToken;
    if (!refreshToken) {
      set({ isRestoring: false });
      return;
    }
    try {
      const session = await apiFetch<AuthResponse>('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) });
      const user = await apiFetch<User>('/api/v1/me', {}, session.access_token);
      sessionStorage.setItem('tezfarmo.refresh', session.refresh_token);
      set({ accessToken: session.access_token, refreshToken: session.refresh_token, user, isRestoring: false });
    } catch {
      sessionStorage.removeItem('tezfarmo.refresh');
      set({ accessToken: null, refreshToken: null, user: null, isRestoring: false });
    }
  },
  refreshAccess: async () => {
    const refreshToken = get().refreshToken;
    if (!refreshToken) return null;
    try {
      const session = await apiFetch<AuthResponse>('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) });
      sessionStorage.setItem('tezfarmo.refresh', session.refresh_token);
      set({ accessToken: session.access_token, refreshToken: session.refresh_token, isRestoring: false });
      return session.access_token;
    } catch {
      get().clearSession();
      return null;
    }
  },
  logout: async () => {
    const { accessToken } = get();
    try {
      if (accessToken) await apiFetch('/api/v1/auth/logout', { method: 'POST' }, accessToken);
    } catch {
      friendlyAuthError(new Error('logout_failed'));
    } finally {
      sessionStorage.removeItem('tezfarmo.refresh');
      set({ accessToken: null, refreshToken: null, user: null });
    }
  },
  clearSession: () => {
    sessionStorage.removeItem('tezfarmo.refresh');
    set({ accessToken: null, refreshToken: null, user: null });
  },
}));
