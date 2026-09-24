import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setLanguage } from '@/shared/i18n';
import { THEME_STORAGE_KEY, initTheme, resolveTheme, useThemeStore } from './theme';
import { ThemeSwitcher } from './theme-switcher';

type Listener = (event: { matches: boolean }) => void;

function mockSystemDark(initial: boolean) {
  let matches = initial;
  const listeners: Listener[] = [];
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
      removeEventListener: vi.fn(),
      // Legacy API still used by Framer Motion's reduced-motion detection.
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
  return {
    change(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
  };
}

describe('theme', () => {
  beforeEach(() => {
    setLanguage('en');
    document.documentElement.classList.remove('dark');
    useThemeStore.setState({ mode: 'system', resolved: 'light' });
  });

  it('follows the system preference on first visit', () => {
    mockSystemDark(true);
    expect(resolveTheme('system')).toBe('dark');
    mockSystemDark(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('persists the choice and applies it to <html>', async () => {
    mockSystemDark(false);
    render(<ThemeSwitcher />);
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    await userEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('is an accessible radiogroup operable with arrow keys', async () => {
    mockSystemDark(false);
    render(<ThemeSwitcher />);
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    screen.getByRole('radio', { name: 'System' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(useThemeStore.getState().mode).toBe('dark');
    expect(group).toBeInTheDocument();
  });

  it('tracks OS changes only while in system mode', () => {
    const system = mockSystemDark(false);
    initTheme();
    system.change(true);
    expect(document.documentElement).toHaveClass('dark');
    useThemeStore.getState().setMode('light');
    system.change(true);
    expect(document.documentElement).not.toHaveClass('dark');
  });
});
