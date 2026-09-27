---
name: TezFarmo Commerce Network
change: CR-002 (one design system based on the sign-in screens)
colors:
  light:
    background: '#F3F7FC'
    foreground: '#0F1B3A'
    surface: '#FFFFFF'
    subtle: '#EFF4FA'
    border: '#DDE5F0'
    input: '#CCD6E4'
    muted-foreground: '#515E75'
    primary: '#0B7D72'
    primary-hover: '#086458'
    primary-soft: '#DDF4EF'
    brand-gradient: ['#0B7D72', '#1D4ED8']
  dark:
    background: '#061129'
    foreground: '#F1F5F9'
    surface: '#111C38'
    subtle: '#18244A'
    border: '#23305A'
    input: '#303E5C'
    muted-foreground: '#A9B6CE'
    primary: '#2DD4BF'
    primary-foreground: '#061129'
    primary-soft: '#14353A'
    brand-gradient: ['#0EA5E9', '#06B6D4']
  status:
    success: '#059669'
    warning: '#D97706'
    danger: '#BA1A1A'
    info: '#2563EB'
typography:
  display: { fontFamily: Montserrat, weight: '700-900', letterSpacing: -0.02em }
  page-title: { fontFamily: Montserrat, fontSize: 26-30px, fontWeight: '700' }
  section-title: { fontFamily: Montserrat, fontSize: 18px, fontWeight: '700' }
  card-title: { fontFamily: Inter, fontSize: 15-16px, fontWeight: '600' }
  body: { fontFamily: Inter, fontSize: 14px, lineHeight: 20px }
  secondary: { fontFamily: Inter, fontSize: 13px }
  label: { fontFamily: Inter, fontSize: 13-15px, fontWeight: '500' }
  caption: { fontFamily: Inter, fontSize: 11-12px, fontWeight: '600', letterSpacing: 0.08em, uppercase: true }
  stat: { fontFamily: Montserrat, fontSize: 22-28px, fontWeight: '700' }
  data: { fontFamily: JetBrains Mono, tabularNums: true }
rounded:
  control: 0.75rem  # inputs, buttons, nav items (rounded-xl)
  card: 1rem-1.25rem  # cards, tables (rounded-2xl)
  panel: 1.75rem  # hero panels, sign-in card
  full: 9999px  # status chips only
shadow:
  card: '0 18px 40px -28px rgb(15 27 58 / .28)'
  panel: '0 30px 80px -30px rgb(15 27 58 / .28)'
  glow: '0 12px 30px -12px rgb(29 78 216 / .6)'
  glow-teal: '0 10px 24px -12px rgb(20 184 166 / .9)'
spacing: { grid: 4px/8px, gutter: 16px / 24px / 32px, card-padding: 20px / 24px }
motion: { ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)', enter: 220-450ms, hover: 150-300ms, reducedMotion: respected }
---

## Brand & Style

TezFarmo links wholesale companies and retail stores across Tajikistan. The visual identity was set by the sign-in
screens (Login / Register) and every other screen continues it (CR-002): a pale-blue day canvas and a navy night
canvas, white or navy **glass** surfaces, a deep-teal action color, a **teal→blue brand gradient** used sparingly,
**Montserrat** display type, generously **rounded** surfaces and a soft **teal glow** on the element that matters.

### Balance rules
- The brand is expressive at the edges (sign-in, profile heroes, empty states) and quiet in the work (tables, forms,
  queues). Business pages stay dense, legible and calm.
- One gradient per view at most: the primary call to action or the brand word. Never on cards or tables.
- Glass is for chrome (header, sidebar, sign-in card, dialogs). Content cards are solid surfaces.
- Glow marks the active or primary element only (active nav item, selected tab, primary action).
- Decorative backdrops (drifting circles) belong to the sign-in screens; the app uses a still, softer page glow.

## Colors

Tokens live in `frontend/src/app/styles.css` (HSL CSS variables) and are exposed through `tailwind.config.ts`.
Every component uses tokens; fixed hex values are only allowed for the brand mark (`brand.*`) and third-party logos.

- **Primary (teal):** actions, active states, verified legitimacy. Day `#0B7D72` (white text, AA); night `#2DD4BF`
  (navy text).
- **Brand gradient:** teal→blue by day, sky→cyan at night (`--brand-from` / `--brand-to`): the brand word, the
  primary call to action on sign-in screens and hero moments.
- **Warning (ochre):** pending, interim, under review. **Danger:** errors, rejection, destructive actions.
  **Success:** verified, completed. **Info:** neutral notices.

### Order status colors (P07)
Tokens `status-new`, `status-confirmed`, `status-assembling`, `status-transit`, `status-delivered`,
`status-disputed`, each with a `-soft` background:
- **NEW** cobalt · **CONFIRMED** sky · **ASSEMBLING** amber · **IN_TRANSIT** violet · **DELIVERED** emerald ·
  **DISPUTED** crimson.

## Typography

- **Display (Montserrat):** page titles, entity names, section titles, statistics, the brand word. Covers Tajik
  Cyrillic (ҳ ҷ ӣ ӯ қ ғ).
- **Body & controls (Inter):** all running text, labels, table cells.
- **Data (JetBrains Mono):** codes, phone numbers, INN, public codes, SKUs, amounts (`TJS`/`смн`), with tabular
  digits.
- Captions and chips: uppercase, 10–12px, letter-spaced.
- Long Russian and Tajik strings must wrap or truncate without breaking layouts.

## Layout & Spacing

- 4/8px grid. Page gutters 16px (mobile), 24px (tablet), 32px (desktop); card padding 20px, 24px on wide screens.
- Responsive from 360px to 1920px (FE-007). Content max width 1440px; forms and settings 48rem.
- Page structure everywhere: **PageHeader** (title, description, actions) → main content → supporting sections.
  Entity pages (user, company, store) open with a **ProfileHeader** instead.
- Mobile: the sidebar becomes a drawer; stores and couriers also get a bottom tab bar; cards stack; tables become
  stacked rows; primary actions stay reachable.

## Elevation & Depth

- **Canvas:** background token with a still, soft brand glow in the app.
- **Card:** solid surface, hairline border, soft navy shadow (`shadow-card`); at night a deeper shadow with a 1px
  top highlight.
- **Glass chrome:** translucent surface + `backdrop-blur-xl` for the header, sidebar, sign-in card, dialogs.
- **Float / pop:** dropdowns and dialogs; dialogs sit on a navy scrim.

## Shapes

- **Controls** (inputs, buttons, nav items, segmented controls): `rounded-xl`.
- **Cards, tables, panels:** `rounded-2xl`; hero panels and the sign-in card `rounded-[1.75rem]`.
- **Icon tiles:** `rounded-xl` squares tinted with the primary soft color.
- **Pills:** status chips and the brand tag only.

## Components

### Buttons
- **Primary:** solid teal with a soft glow in the app; on sign-in screens (and hero actions) the brand gradient,
  52–56px tall. Hover lifts 2px, press settles.
- **Secondary / outline:** surface with a border, teal on hover. **Ghost:** no chrome. **Danger:** solid or outline
  crimson for destructive actions. Loading shows a spinner and keeps the width.

### Inputs
- Tinted field (`subtle`) with a border, `rounded-xl`, leading icon when helpful; focus: teal border + 3px teal
  ring; error: danger border + ring and a message below; disabled: 60% opacity. Sign-in fields are 52–56px, app
  fields 44px.

### Status chips
- Pill, uppercase caption type, optional beacon dot. Presets: verified, pending, rejected, not submitted, active,
  suspended, revoked, and the order statuses.

### Cards
- Standard, stat (icon tile + caption + Montserrat value), interactive (lifts and glows on hover), profile header
  (entity mark, name, chips, stats, side panel), settings (form sections with a title row).

### Tables
- Same tokens, denser rhythm: `subtle` header row with caption type, hairline row dividers, hover tint, status chips
  in cells, pagination and empty state in the table frame; stacked cards below 768px.

### Dialogs & toasts
- Dialog: glass panel, `rounded-2xl`, navy scrim, focus trapped, Escape closes. Critical actions follow
  preview → confirm → result (FE-002); destructive ones repeat the object name (FE-003).
- Toast: glass card bottom-right (bottom-center on mobile) with a status icon.

### Empty, loading, error, forbidden, not found (FE-001)
- One state frame: icon tile, Montserrat title, muted description, optional action. Loading uses skeletons with a
  shimmer. Modules of later phases show a "planned" panel with the phase chip — never sample data.

### Ledger cards & balance blocks (P09)
- Upper deck: counterparty and balance in Montserrat (28px) with `смн` in JetBrains Mono; lower deck: reconciliation
  metrics on the `subtle` surface, divided by a hairline border.

### Delivery security verification block (P08)
- Navy block with the verification PIN in JetBrains Mono (32px, letter-spacing 0.15em, teal), a QR scan button and
  a "Confirm handoff" action.

### Order status timeline (P07)
- Segmented pipeline NEW → CONFIRMED → ASSEMBLING → IN_TRANSIT → DELIVERED; completed nodes teal with a check, the
  current node with a pulsing teal ring, pending nodes on the border color.

## Motion

- Framer Motion with ease `(0.2, 0.8, 0.2, 1)`: page content fades and rises 6–8px; cards stagger lightly; tabs and
  nav use a sliding plate (spring); dialogs scale from 98%.
- No motion that delays work: entrances ≤ 450ms, hovers ≤ 300ms, nothing loops in business pages.
- `prefers-reduced-motion` disables animations globally.

## Accessibility

AA contrast in both themes, visible focus ring on every interactive element, semantic landmarks and headings,
labelled controls, errors announced with `role="alert"`, keyboard-operable menus, dialogs and tabs.
