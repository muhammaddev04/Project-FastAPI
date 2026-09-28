import Decimal from 'decimal.js';

/**
 * FND-036 / FE-009: money and quantity stay strings (API) or `Decimal` (arithmetic) - never a JS number.
 * Display format (GLOBAL §12): `1 250,00 TJS` in every language. Groups and the currency are joined with a no-break
 * space so an amount never wraps. Quantities use the same separators with trailing zeros removed (`12.500` -> `12,5`).
 */

const NBSP = ' ';
const DECIMAL_STRING = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export const CURRENCY = 'TJS';

/** API string (`"1250.00"`) or Decimal -> Decimal; `null` for anything else (a JS number is refused on purpose). */
export function toDecimal(value: string | Decimal | null | undefined): Decimal | null {
  if (value instanceof Decimal) return value.isFinite() ? value : null;
  if (typeof value !== 'string' || !DECIMAL_STRING.test(value)) return null;
  return new Decimal(value);
}

function group(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

function localize(fixed: string): string {
  const negative = fixed.startsWith('-');
  const [integer = '', fraction] = (negative ? fixed.slice(1) : fixed).split('.');
  return `${negative ? '-' : ''}${group(integer)}${fraction ? `,${fraction}` : ''}`;
}

/** `"1250.5"` -> `1 250,50 TJS` (ROUND_HALF_UP to 2 places, like the backend `q2`); `null` when not a decimal. */
export function formatMoney(value: string | Decimal | null | undefined, { currency = true } = {}): string | null {
  const amount = toDecimal(value);
  if (!amount) return null;
  const text = localize(amount.toFixed(2, Decimal.ROUND_HALF_UP));
  return currency ? `${text}${NBSP}${CURRENCY}` : text;
}

/** `"12.500"` -> `12,5`, `"1250.000"` -> `1 250` (ROUND_HALF_UP to 3 places, like `q3`); `null` when not a decimal. */
export function formatQuantity(value: string | Decimal | null | undefined): string | null {
  const amount = toDecimal(value);
  if (!amount) return null;
  const fixed = amount.toFixed(3, Decimal.ROUND_HALF_UP).replace(/\.?0+$/, '');
  return localize(fixed === '-0' ? '0' : fixed);
}

/** Decimal -> the API's money string (`"1250.50"`). */
export function toMoneyString(value: Decimal): string {
  return value.toFixed(2, Decimal.ROUND_HALF_UP);
}

/** Decimal -> the API's quantity string (`"12.500"`). */
export function toQuantityString(value: Decimal): string {
  return value.toFixed(3, Decimal.ROUND_HALF_UP);
}
