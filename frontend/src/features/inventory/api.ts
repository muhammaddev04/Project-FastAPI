import type { components } from '@/shared/api/schema';
export type Stock = components['schemas']['StockOut'];
export type StockDetail = components['schemas']['StockDetail'];
export type Movement = components['schemas']['MovementOut'];

function scaled(value: string): bigint | null {
  if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole ?? '0') * 1000n + BigInt(fraction.padEnd(3, '0'));
}
function decimal(value: bigint): string {
  const sign = value < 0 ? '-' : '';
  const absolute = value < 0 ? -value : value;
  return `${sign}${absolute / 1000n}.${String(absolute % 1000n).padStart(3, '0')}`;
}
export function baseQuantity(quantity: string, coefficient: string): string | null {
  const qty = scaled(quantity),
    coef = scaled(coefficient);
  if (qty === null || coef === null || qty <= 0n || coef <= 0n) return null;
  const result = (qty * coef + 500n) / 1000n;
  return result > 0n && result <= 99999999999999n ? decimal(result) : null;
}
export function quantityDifference(actual: string, current: string): string | null {
  const next = scaled(actual),
    before = scaled(current);
  return next !== null && before !== null ? decimal(next - before) : null;
}
