import type { components } from '@/shared/api/schema';

export type Order = components['schemas']['OrderOut'];
export type WarehouseOrder = components['schemas']['OrderWarehouseView'];
export type OrderView = Order | WarehouseOrder;
export type Cart = components['schemas']['CartOut'];
export type Product = components['schemas']['CatalogProduct'];
export type Preview = components['schemas']['ConfirmationPreview'];
export type Status = Order['status'];
export const statuses: Status[] = [
  'NEW',
  'VIEWED',
  'CONFIRMED',
  'PARTIALLY_CONFIRMED',
  'ASSEMBLING',
  'READY_FOR_DELIVERY',
  'IN_TRANSIT',
  'DELIVERED',
  'DELIVERY_FAILED',
  'DISPUTED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
];
export const early = ['NEW', 'VIEWED'];
export const reserved = ['CONFIRMED', 'PARTIALLY_CONFIRMED', 'ASSEMBLING', 'READY_FOR_DELIVERY', 'DELIVERY_FAILED'];
export const money = (value: number | string | null | undefined) => Number(value ?? 0).toFixed(2);
export const lineTotal = (quantity: number, price: number) => Math.round((quantity * price + Number.EPSILON) * 100) / 100;

export function totals(order: Order, quantities: Record<string, string>, preview: Preview, discount: string) {
  const subtotal = order.items.reduce((sum, row) => sum + lineTotal(Number(quantities[row.id] ?? 0), Number(row.unit_price)), 0);
  const terms = preview.terms;
  const threshold = terms.free_delivery_threshold;
  const deliveryFee = threshold != null && subtotal >= Number(threshold) ? 0 : Number(terms.delivery_fee ?? 0);
  const total = subtotal - Number(discount || 0) + deliveryFee;
  return {
    subtotal,
    deliveryFee,
    total,
    minimum: Number(terms.minimum_order_amount ?? 0),
    creditExceeded: Number(preview.credit.outstanding) + total - Number(preview.credit.unapplied) > Number(preview.credit.limit),
  };
}
