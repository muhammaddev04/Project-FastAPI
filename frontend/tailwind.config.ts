import type { Config } from 'tailwindcss';

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
        /* Public site display face only. Noto Serif is the one serif here with the Tajik Cyrillic range. */
        serif: ['"Noto Serif Variable"', '"Noto Serif"', 'ui-serif', 'Georgia', 'serif'],
      },
      /*
       * Named type scale (CR-002 revision). Before this there were 23 distinct `text-[…rem]` values used 202
       * times with no line-height, so every heading had to re-state `leading-tight` by hand. Each step below
       * carries its own line-height and is named for the role it plays, not for its size, so hierarchy is a
       * choice rather than an arithmetic accident. Sizes match what the product already rendered; only the
       * naming, the line-heights and the tracking are new.
       */
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        /* Chips, badges, counters. */
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        /* Hints, metadata, table captions. */
        caption: ['0.75rem', { lineHeight: '1.125rem' }],
        /* The dominant UI text: field labels, table cells, secondary copy. */
        label: ['0.8125rem', { lineHeight: '1.125rem' }],
        /* Body copy; equals the global body size. */
        body: ['0.875rem', { lineHeight: '1.25rem' }],
        /* Card titles and the larger labels of the sign-in forms. */
        'body-lg': ['0.9375rem', { lineHeight: '1.375rem' }],
        /* Primary action labels, choice-tile titles. */
        'title-sm': ['1.0625rem', { lineHeight: '1.5rem' }],
        title: ['1.25rem', { lineHeight: '1.625rem', letterSpacing: '-0.01em' }],
        /* Page h1 on phones. */
        'title-lg': ['1.5rem', { lineHeight: '1.875rem', letterSpacing: '-0.015em' }],
        'display-sm': ['1.75rem', { lineHeight: '2rem', letterSpacing: '-0.02em' }],
        /* Page h1 from sm upwards. */
        display: ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
        'display-lg': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.025em' }],
        /*
         * Public site display steps (Phase E). Fluid with clamp() rather than the reference's raw `vw`, which
         * needs a separate rule per breakpoint regime and has no floor or ceiling: three of those regimes is
         * how a viewport-height variant gets invented. One clamp per step covers 320px to 2560px, so these
         * sizes need no breakpoint of their own.
         *
         * Tracking is tighter than the body scale but looser than the reference's -0.07em: at that value
         * Cyrillic descenders and the ҳ/ҷ cedillas start colliding with the next letter.
         */
        hero: ['clamp(2.25rem, 1.35rem + 3.6vw, 4.25rem)', { lineHeight: '1.05', letterSpacing: '-0.032em' }],
        section: ['clamp(1.75rem, 1.25rem + 2vw, 2.75rem)', { lineHeight: '1.1', letterSpacing: '-0.028em' }],
        /* The typographic moments: one sentence, alone in its band, between the hero and a section heading. */
        statement: ['clamp(1.875rem, 1.1rem + 3vw, 3.5rem)', { lineHeight: '1.12', letterSpacing: '-0.03em' }],
        'section-sm': ['clamp(1.375rem, 1.1rem + 1.1vw, 1.875rem)', { lineHeight: '1.2', letterSpacing: '-0.022em' }],
        /* Lead paragraph under a display heading; sans, because it is read rather than looked at. */
        lead: ['clamp(1.0625rem, 1rem + 0.45vw, 1.3125rem)', { lineHeight: '1.6' }],
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
      /*
       * Two radii carry the whole product: 10px for anything you click or type into, 12px for the surface
       * that holds them. `rounded-full` stays for avatars, status dots and counters. The 1.75rem/2rem panel
       * radii are gone: at that size a corner reads as decoration rather than as a container edge.
       */
      borderRadius: {
        DEFAULT: '0.25rem',
        sm: '0.125rem',
        md: '0.375rem',
        lg: '0.5rem',
        /* Controls: inputs, buttons, menu items, nav rows. */
        xl: '0.625rem',
        /* Surfaces: cards, dialogs, drawers, tables. */
        '2xl': '0.75rem',
      },
      /*
       * Elevation is for things that genuinely float above the page, and nothing else. The teal `glow` /
       * `glow-teal` lifts and the deep `panel` shadow were decoration: an active nav item is already marked
       * by a solid plate, so a coloured shadow added nothing but render cost. `float` had no call sites.
       */
      boxShadow: {
        /* Resting surface: a hairline of depth so a card separates from the canvas without a hard edge. */
        card: '0 1px 2px 0 rgb(15 27 58 / 0.05), 0 1px 3px -1px rgb(15 27 58 / 0.04)',
        raised: '0 1px 3px 0 rgb(15 27 58 / 0.06), 0 1px 2px -1px rgb(15 27 58 / 0.04)',
        /* Overlays only: dialog, drawer, dropdown, toast. */
        pop: '0 16px 32px -12px rgb(15 23 42 / 0.18), 0 4px 8px -4px rgb(15 23 42 / 0.1)',
      },
      transitionTimingFunction: {
        /*
         * The one easing curve on the public site and the authentication screens: every reveal, wipe, draw and
         * cross-fade uses it. Phase E4 retired the second curve (0.2, 0.8, 0.2, 1) that Phase C had left in the
         * page transition and the code input, because two curves in one flow is two motion personalities.
         */
        paper: 'cubic-bezier(0.23, 1, 0.32, 1)',
      },
      maxWidth: {
        /* Outer frame of every public section. */
        frame: '80rem',
        /* Reading measure: a paragraph wider than this loses the line it is on. */
        measure: '65ch',
      },
      transitionDuration: {
        /* Two speeds: `fast` for state on a control, `base` for something entering or leaving. */
        fast: '120ms',
        base: '180ms',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        /* Opacity only: safe on elements positioned with transforms (centered dialogs, drawers). */
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        caret: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        'toast-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
        fade: 'fade 120ms ease-out both',
        caret: 'caret 1.1s step-end infinite',
        'toast-in': 'toast-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  /*
   * No plugins. The `short:` variant (`@media (max-height: 920px)`) lived here for Phase C and earlier: the
   * sign-in card was tall enough to overflow a laptop viewport, so 45 rules across nine files shaved padding,
   * heights and line-heights off it, and two of them hid content outright. Phase D made the authentication
   * screens one column of fields on the page canvas with no card to fit inside, which removed every call site.
   * A viewport-height variant is a workaround for a layout that is too tall, so it goes with the layout.
   */
  plugins: [],
} satisfies Config;
