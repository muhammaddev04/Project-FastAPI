import Decimal from 'decimal.js';
import { formatMoney, formatQuantity, toDecimal, toMoneyString, toQuantityString } from './money';

const NBSP = ' ';
const shown = (value: string | null) => value?.replaceAll(NBSP, ' ');

describe('FND-036 money format (GLOBAL §12: "1 250,00 TJS")', () => {
  it('formats the API strings the backend MoneyStr sends', () => {
    expect(shown(formatMoney('1250.00'))).toBe('1 250,00 TJS');
    expect(shown(formatMoney('0.00'))).toBe('0,00 TJS');
    expect(shown(formatMoney('9999999999.99'))).toBe('9 999 999 999,99 TJS');
    expect(shown(formatMoney('1250.5'))).toBe('1 250,50 TJS');
    expect(shown(formatMoney('999'))).toBe('999,00 TJS');
    expect(shown(formatMoney('-1250.00'))).toBe('-1 250,00 TJS');
  });

  it('never breaks an amount across lines (no-break spaces)', () => {
    expect(formatMoney('1250.00')).toBe(`1${NBSP}250,00${NBSP}TJS`);
  });

  it('can omit the currency', () => {
    expect(shown(formatMoney('1250.00', { currency: false }))).toBe('1 250,00');
  });

  it('rounds half up like the backend q2, without float error', () => {
    expect(shown(formatMoney('2.345'))).toBe('2,35 TJS');
    expect(shown(formatMoney('10.125'))).toBe('10,13 TJS'); // banker's rounding would give 10,12
    expect(shown(formatMoney(new Decimal('0.1').plus('0.2')))).toBe('0,30 TJS'); // 0.1 + 0.2 in float is 0.30000000000000004
  });

  it('refuses anything that is not a decimal string or Decimal (FE-009: no floats)', () => {
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
    expect(formatMoney('')).toBeNull();
    expect(formatMoney('1,50')).toBeNull();
    expect(formatMoney('1e3')).toBeNull();
    expect(formatMoney('abc')).toBeNull();
    expect(formatMoney(1250 as unknown as string)).toBeNull();
    expect(toDecimal(new Decimal(NaN))).toBeNull();
  });
});

describe('FND-035 quantity format (same separators, trailing zeros removed)', () => {
  it('formats the API strings the backend QuantityStr sends', () => {
    expect(shown(formatQuantity('12.500'))).toBe('12,5');
    expect(shown(formatQuantity('1250.000'))).toBe('1 250');
    expect(shown(formatQuantity('0.125'))).toBe('0,125');
    expect(shown(formatQuantity('0.000'))).toBe('0');
    expect(shown(formatQuantity('1.0005'))).toBe('1,001'); // ROUND_HALF_UP to 3 places, like q3
    expect(formatQuantity('x')).toBeNull();
  });
});

describe('Decimal -> API strings', () => {
  it('produces exactly what the backend accepts', () => {
    expect(toMoneyString(new Decimal('1250.5'))).toBe('1250.50');
    expect(toMoneyString(new Decimal('2.345'))).toBe('2.35');
    expect(toQuantityString(new Decimal('12.5'))).toBe('12.500');
  });
});
