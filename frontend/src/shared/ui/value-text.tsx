import type Decimal from 'decimal.js';
import { formatDate, formatDateTime } from '@/shared/lib/datetime';
import { formatMoney, formatQuantity } from '@/shared/lib/money';
import { cn } from '@/shared/lib/cn';

const EMPTY = '—';

type DecimalValue = string | Decimal | null | undefined;

/** FND-035 MoneyText: `"1250.5"` -> `1 250,50 TJS` (FND-036); `—` when there is no value. */
export function MoneyText({ value, currency = true, className }: { value: DecimalValue; currency?: boolean; className?: string }) {
  return <span className={cn('whitespace-nowrap tabular-nums', className)}>{formatMoney(value, { currency }) ?? EMPTY}</span>;
}

/** FND-035 QuantityText: `"12.500"` -> `12,5`; the caller renders the unit. */
export function QuantityText({ value, className }: { value: DecimalValue; className?: string }) {
  return <span className={cn('whitespace-nowrap tabular-nums', className)}>{formatQuantity(value) ?? EMPTY}</span>;
}

/** FND-035 DateText: `dd.MM.yyyy HH:mm` in Asia/Dushanbe, or `dd.MM.yyyy` with `dateOnly` (GLOBAL §12). */
export function DateText({
  value,
  dateOnly = false,
  className,
}: {
  value: string | null | undefined;
  dateOnly?: boolean;
  className?: string;
}) {
  const text = dateOnly ? formatDate(value) : formatDateTime(value);
  if (!text || !value) return <span className={className}>{EMPTY}</span>;
  return (
    <time dateTime={value} className={cn('whitespace-nowrap tabular-nums', className)}>
      {text}
    </time>
  );
}
