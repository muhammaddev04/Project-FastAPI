import type { components } from '@/shared/api/schema';

export type Partnership = components['schemas']['PartnershipOut'];
export type Terms = components['schemas']['TermsOut'];
export type TermsInput = components['schemas']['TermsIn'];
export type Lookup = components['schemas']['LookupOut'];
export const statuses = ['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'DECLINED', 'CANCELLED'] as const;
export const termFields = [
  'price_list_id',
  'credit_limit',
  'credit_days',
  'payment_methods',
  'minimum_order_amount',
  'delivery_fee',
  'free_delivery_threshold',
  'return_days',
  'dispute_window_hours',
  'effective_from',
  'note',
] as const;

export function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function initialTerms(current?: Terms | null): TermsInput {
  return {
    price_list_id: current?.price_list_id ?? '',
    credit_limit: current?.credit_limit ?? '0.00',
    credit_days: current?.credit_days ?? 0,
    payment_methods: current?.payment_methods ?? ['CASH'],
    minimum_order_amount: current?.minimum_order_amount ?? '0.00',
    delivery_fee: current?.delivery_fee ?? '0.00',
    free_delivery_threshold: current?.free_delivery_threshold ?? null,
    return_days: current?.return_days ?? 14,
    dispute_window_hours: current?.dispute_window_hours ?? 48,
    effective_from: new Date().toISOString(),
    note: current?.note ?? null,
  };
}

export function canAct(partner: Partnership, side: 'COMPANY' | 'STORE', permissions: string[], action: string) {
  if (action === 'terminate') return permissions.includes('partners.terminate') && ['ACTIVE', 'SUSPENDED'].includes(partner.status);
  if (!permissions.includes('partners.manage')) return false;
  if (action === 'accept' || action === 'decline') return partner.status === 'PENDING' && partner.initiated_by_side !== side;
  if (action === 'cancel') return partner.status === 'PENDING' && partner.initiated_by_side === side;
  if (action === 'suspend') return side === 'COMPANY' && partner.status === 'ACTIVE';
  if (action === 'reactivate') return side === 'COMPANY' && partner.status === 'SUSPENDED';
  return false;
}
