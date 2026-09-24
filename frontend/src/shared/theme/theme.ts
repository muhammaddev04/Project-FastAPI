import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'tezfarmo.theme';
const MODES: ThemeMode[] = ['light', 'dark', 'system'];

function readMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

/** Puts the resolved theme on <html> (`.dark` + color-scheme). `animate` cross-fades colors for a moment. */
export function applyTheme(resolved: ResolvedTheme, animate = false): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 320);
  }
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

type ThemeState = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /** Re-evaluates "system" after the OS preference changes. */
  syncSystem: () => void;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readMode(),
  resolved: resolveTheme(readMode()),
  setMode: (mode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      /* storage unavailable: keep the in-memory choice */
    }
    const resolved = resolveTheme(mode);
    applyTheme(resolved, true);
    set({ mode, resolved });
  },
  syncSystem: () => {
    if (get().mode !== 'system') return;
    const resolved = resolveTheme('system');
    applyTheme(resolved, true);
    set({ resolved });
  },
}));

/** Applies the stored theme and follows OS changes while in "system" mode. Call once at startup. */
export function initTheme(): void {
  applyTheme(useThemeStore.getState().resolved);
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => useThemeStore.getState().syncSystem());
  }
}
