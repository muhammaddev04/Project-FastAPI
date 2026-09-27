import { CheckCircle2, CircleDashed, Clock3, PauseCircle, ShieldCheck, XCircle, type LucideIcon } from 'lucide-react';
import type { BadgeTone } from './badge';

export type Preset = { label: string; tones: Record<string, BadgeTone>; icons?: Record<string, LucideIcon> };

/**
 * FND-035 StatusBadge: one chip per domain status family, so the same status looks the same everywhere.
 * Labels come from the existing translation groups of each family.
 */
export const PRESETS = {
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
