import { CheckCircle2, CircleDashed, Clock3, PauseCircle, ShieldCheck, XCircle, type LucideIcon } from 'lucide-react';
import type { BadgeTone } from './badge';

/**
 * A status family. `icons` is required, not optional: a status that is only a colour fails for anyone who
 * cannot distinguish the hues, and making the field mandatory means a future preset cannot forget it.
 */
export type Preset = { label: string; tones: Record<string, BadgeTone>; icons: Record<string, LucideIcon> };

/**
 * One entry per domain status family, so a given status looks identical everywhere it appears (FND-035).
 * Labels resolve against each family's existing translation group, so adding a family costs a preset and a
 * translation block, not a new component.
 *
 * Families are added as their TZ phase lands. P07 orders, P08 delivery, P09 payments, P10 disputes and
 * partnership states all map onto this registry; the tones they need already exist in `badge.tsx`. No
 * preset is declared before the phase that renders it, so nothing here points at translation keys that do
 * not yet exist.
 */
export const PRESETS = {
  subscription: {
    label: 'billing.status',
    tones: { TRIAL: 'info', ACTIVE: 'success', GRACE: 'warning', SOFT_BLOCK: 'warning', FULL_BLOCK: 'danger', CANCELLED: 'danger' },
    icons: { TRIAL: Clock3, ACTIVE: CheckCircle2, GRACE: Clock3, SOFT_BLOCK: PauseCircle, FULL_BLOCK: XCircle, CANCELLED: XCircle },
  },
  /** P02 organization verification (NOT_SUBMITTED → PENDING → APPROVED | REJECTED). */
  verification: {
    label: 'verification.status',
    tones: { NOT_SUBMITTED: 'neutral', PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' },
    icons: { NOT_SUBMITTED: CircleDashed, PENDING: Clock3, APPROVED: ShieldCheck, REJECTED: XCircle },
  },
  /** P02 verification request (SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED). */
  request: {
    label: 'admin.verifications.requestStatus',
    tones: { SUBMITTED: 'info', UNDER_REVIEW: 'warning', APPROVED: 'success', REJECTED: 'danger' },
    icons: { SUBMITTED: CircleDashed, UNDER_REVIEW: Clock3, APPROVED: CheckCircle2, REJECTED: XCircle },
  },
  /** P01 membership status. */
  member: {
    label: 'team.statuses',
    tones: { ACTIVE: 'success', SUSPENDED: 'warning', REVOKED: 'neutral' },
    icons: { ACTIVE: CheckCircle2, SUSPENDED: PauseCircle, REVOKED: XCircle },
  },
} satisfies Record<string, Preset>;

export type StatusKind = keyof typeof PRESETS;

export function statusTone(kind: StatusKind, value: string): BadgeTone {
  return (PRESETS[kind].tones as Record<string, BadgeTone>)[value] ?? 'neutral';
}
