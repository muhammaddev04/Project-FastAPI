# CR-002 — One design system based on the sign-in screens

| Field | Value |
|---|---|
| change_id | CR-002 |
| requester | Project owner (muhammaddev04) |
| date | 2026-09-27 |
| status | Approved by the project owner (decisions 1–4 of the design-system plan) |

## Reason

The Login and Register screens were designed first and carry the TezFarmo identity (navy/teal palette, glass
surfaces, Montserrat display type, rounded surfaces, teal→blue brand gradient, controlled motion). The rest of the
frontend followed the older "Modern Precision Commerce" rules in DESIGN.md (4px radius, no shadows, a serif display
face, a dark-slate company sidebar), so the product looked like two applications. The owner decided that the
sign-in screens are the single visual reference for the whole product.

## What changed before → after

| Topic | Before (DESIGN.md / FND-038) | After |
|---|---|---|
| Palette | Canvas `#F8F9FF`, teal `#0F766E`, slate chrome | Sign-in palette for the whole app: canvas `#F3F7FC`, teal `#0B7D72`; night theme navy `#061129` with bright teal `#2DD4BF` |
| Display font | Space Grotesk (spec) / Noto Serif (code) | Montserrat (covers Tajik Cyrillic); Inter body; JetBrains Mono for data |
| Radius | 4px controls, 6–8px surfaces | Controls `rounded-xl`, cards `rounded-2xl`, hero panels `rounded-[1.75rem]`; pills only for status chips |
| Depth | No shadows on cards | Soft navy card shadow, glass (translucent + blur) for shell chrome, teal glow on primary actions and active plates |
| Shell | Dark-slate company sidebar, white store sidebar | One shell for every area: white glass (light) / navy glass (night); the area is shown by its chip and icon |
| Dark mode | FND-038: no dark mode in MVP | Light and night themes are both supported (the night theme is the sign-in reference look); system preference is the default |

Unchanged: order-status colors (kept as tokens for P07), accessibility rules (AA contrast, visible focus,
reduced motion), responsive range 360–1920px (FE-007), the five screen states (FE-001).

## Affected requirement IDs

FND-032 (layouts), FND-035 (shared components), FND-038 (theme). DESIGN.md is updated to describe the new system.

## Impact

| Area | Impact |
|---|---|
| DB / API / security / financial / migration | none — frontend presentation only |
| Frontend | tokens (`src/app/styles.css`, `tailwind.config.ts`), shared UI components, the application shell and every page's styling |
| Tests | frontend tests assert text and roles; structural changes (dialogs, tables) update their tests |
