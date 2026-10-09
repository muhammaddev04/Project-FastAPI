import Decimal from 'decimal.js';
import type { components } from '@/shared/api/schema';

export type Returnable = components['schemas']['ReturnableOut'];
export type Return = components['schemas']['ReturnOut'];
export type ReturnDetail = components['schemas']['ReturnDetail'];
export type ReturnItem = components['schemas']['ReturnItemOut'];
export type CompletionPreview = components['schemas']['CompletionPreviewOut'];
export type Dispute = components['schemas']['DisputeOut'];
export type DisputeDetail = components['schemas']['DisputeDetail'];
export type DisputeMessage = components['schemas']['DisputeMessageOut'];
export type ReturnStatus = Return['status'];
export type ReturnReason = Return['reason_code'];
export type DisputeStatus = Dispute['status'];
export type DisputeType = Dispute['type'];
export type ResolutionType = NonNullable<Dispute['resolution_type']>;

export const returnStatuses: ReturnStatus[] = ['REQUESTED', 'APPROVED', 'RECEIVED', 'COMPLETED', 'REJECTED', 'CANCELLED'];
export const returnReasons: ReturnReason[] = ['DAMAGED', 'EXPIRED', 'WRONG_ITEM', 'NOT_ORDERED', 'QUALITY', 'OTHER'];
export const disputeStatuses: DisputeStatus[] = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED', 'WITHDRAWN'];
export const disputeTypes: DisputeType[] = ['QUANTITY', 'PRICE', 'DAMAGED', 'DELIVERY', 'PAYMENT', 'OTHER'];
export const resolutionTypes: ResolutionType[] = ['NO_ACTION', 'ADJUSTMENT_CREDIT', 'CONVERTED_TO_RETURN'];

/** A return is still being decided; the tabs and the "one open return" rule both read this. */
export const openReturnStatuses: ReturnStatus[] = ['REQUESTED', 'APPROVED', 'RECEIVED'];
export const openDisputeStatuses: DisputeStatus[] = ['OPEN', 'UNDER_REVIEW'];

export const money = (value: string | number | null | undefined) => new Decimal(value ?? 0).toFixed(2);

/**
 * RET-003 line entry. Quantities are decimal strings so a `0.001` base unit survives the round trip; a
 * fraction is refused outright for a unit the order priced as whole pieces.
 */
export function validQuantity(value: string, max: string, allowFraction = true): boolean {
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(value)) return false;
  const quantity = new Decimal(value);
  if (!allowFraction && !quantity.isInteger()) return false;
  return quantity.gt(0) && quantity.lte(new Decimal(max));
}

/** Approve, receive and complete all accept zero on a line, which drops it rather than rejecting the form. */
export function validStep(value: string, max: string, allowFraction = true): boolean {
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(value)) return false;
  const quantity = new Decimal(value);
  if (quantity.isZero()) return true;
  if (!allowFraction && !quantity.isInteger()) return false;
  return quantity.lte(new Decimal(max));
}

/** RET-002: the window is a moment in time, so the form closes itself without waiting for a 409. */
export function deadlinePassed(deadline: string | null | undefined, now = new Date()): boolean {
  if (!deadline) return true;
  return new Date(deadline).getTime() <= now.getTime();
}

/** DSP-001 countdown for the store's "open a dispute" button: whole hours left, or 0 once it has closed. */
export function hoursLeft(deadline: string | null | undefined, now = new Date()): number {
  if (!deadline) return 0;
  return Math.max(0, Math.floor((new Date(deadline).getTime() - now.getTime()) / 3_600_000));
}

/**
 * DSP-024 badge: a dispute waiting 48 hours in OPEN is late, and one past 24 hours is close to it. The job
 * owns the warning event; this only colours the queue so the company sees the same clock the SLA uses.
 */
export function slaTone(dispute: Pick<Dispute, 'status' | 'created_at'>, now = new Date()): 'danger' | 'warning' | undefined {
  if (!openDisputeStatuses.includes(dispute.status)) return undefined;
  const hours = (now.getTime() - new Date(dispute.created_at).getTime()) / 3_600_000;
  if (hours >= 48) return 'danger';
  if (hours >= 24) return 'warning';
  return undefined;
}

/** The completion preview is a GET, so its lines travel as repeated `items=<id>:<accepted>:<restock>`. */
export function previewQuery(lines: { id: string; accepted: string; restock: string }[]): string {
  const params = new URLSearchParams();
  lines.forEach((line) => params.append('items', `${line.id}:${line.accepted || '0'}:${line.restock || '0'}`));
  return params.toString();
}

/** A line's own ceiling at each step of the RET-003 ladder: requested ≥ approved ≥ received ≥ accepted ≥ restock. */
export function stepCeiling(item: ReturnItem, step: 'approved' | 'received' | 'accepted' | 'restock'): string {
  if (step === 'approved') return item.requested_quantity;
  if (step === 'received') return item.approved_quantity ?? item.requested_quantity;
  if (step === 'accepted') return item.received_quantity ?? item.approved_quantity ?? item.requested_quantity;
  return item.accepted_quantity ?? '0';
}
