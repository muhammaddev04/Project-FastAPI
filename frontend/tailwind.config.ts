import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

/**
 * Tokens follow DESIGN.md (CR-002): the language of the sign-in screens. 4/8px grid; controls rounded-xl,
 * cards rounded-2xl, hero panels rounded-[1.75rem]; pills only for status chips.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Montserrat Variable"', '"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        surface: token('surface'),
        subtle: token('subtle'),
        container: token('container'),
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        slate: { DEFAULT: token('slate') },
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          foreground: token('primary-foreground'),
          soft: token('primary-soft'),
        },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground'), soft: token('accent-soft') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft'), ink: token('danger-ink') },
        success: { DEFAULT: token('success'), soft: token('success-soft'), ink: token('success-ink') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft'), ink: token('warning-ink') },
        info: { DEFAULT: token('info'), soft: token('info-soft'), ink: token('info-ink') },
        'primary-strong': token('primary-strong'),
        'primary-ink': token('primary-ink'),
        /* Fixed brand colors of the TezFarmo mark and gradients (identical in both themes). */
        brand: {
          light: '#2DD4BF',
          DEFAULT: '#0D9488',
          deep: '#0B7D72',
          blue: '#1D4ED8',
          sky: '#0EA5E9',
          cyan: '#06B6D4',
          navy: '#06122B',
          night: '#050D22',
          abyss: '#040A1C',
          violet: '#6D28D9',
        },
        status: {
          new: { DEFAULT: token('status-new'), soft: token('status-new-soft') },
          confirmed: { DEFAULT: token('status-confirmed'), soft: token('status-confirmed-soft') },
          assembling: { DEFAULT: token('status-assembling'), soft: token('status-assembling-soft') },
          transit: { DEFAULT: token('status-transit'), soft: token('status-transit-soft') },
          delivered: { DEFAULT: token('status-delivered'), soft: token('status-delivered-soft') },
          disputed: { DEFAULT: token('status-disputed'), soft: token('status-disputed-soft') },
        },
        sidebar: {
          DEFAULT: token('sidebar'),
          foreground: token('sidebar-foreground'),
          muted: token('sidebar-muted'),
          active: token('sidebar-active'),
          border: token('sidebar-border'),
        },
      },
      borderRadius: { DEFAULT: '0.25rem', sm: '0.125rem', md: '0.375rem', lg: '0.5rem', xl: '0.75rem' },
      boxShadow: {
        /* Soft navy depth of the sign-in cards; `glow` is the teal/blue lift of primary actions and active plates. */
        card: '0 18px 40px -28px rgb(15 27 58 / 0.28), 0 1px 2px 0 rgb(15 27 58 / 0.04)',
        panel: '0 30px 80px -30px rgb(15 27 58 / 0.28)',
        raised: '0 1px 3px 0 rgb(15 27 58 / 0.06), 0 1px 2px -1px rgb(15 27 58 / 0.04)',
        glow: '0 12px 30px -12px rgb(29 78 216 / 0.6)',
        'glow-teal': '0 10px 24px -12px rgb(20 184 166 / 0.9)',
        float: '0 4px 6px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)',
        pop: '0 20px 25px -5px rgb(15 23 42 / 0.1), 0 8px 10px -6px rgb(15 23 42 / 0.06)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        /* Opacity only: safe on elements positioned with transforms (centered dialogs, drawers). */
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        caret: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        'toast-in': { from: { opacity: '0', transform: 'translateY(12px) scale(0.98)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulse_ring: { '0%': { boxShadow: '0 0 0 0 rgb(15 118 110 / 0.35)' }, '100%': { boxShadow: '0 0 0 6px rgb(15 118 110 / 0)' } },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
        fade: 'fade 180ms ease-out both',
        caret: 'caret 1.1s step-end infinite',
        'toast-in': 'toast-in 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        shimmer: 'shimmer 1.4s infinite',
        'pulse-ring': 'pulse_ring 1.6s ease-out infinite',
      },
    },
  },
  plugins: [
    /*
     * `short:` = viewports up to ~920px tall (laptops, most phones): tighter vertical rhythm so auth forms fit.
     * A variant, not a screen: a raw-media screen would switch off Tailwind's min-[…] / max-* width variants.
     */
    plugin(({ addVariant }) => {
      addVariant('short', '@media (max-height: 920px)');
    }),
  ],
} satisfies Config;
