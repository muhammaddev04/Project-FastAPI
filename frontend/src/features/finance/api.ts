import Decimal from 'decimal.js';
import type { components } from '@/shared/api/schema';

export type Balance = components['schemas']['BalanceOut'];
export type PartnerBalance = components['schemas']['PartnerBalanceOut'];
export type Summary = components['schemas']['SummaryOut'];
export type Charge = components['schemas']['ChargeOut'];
export type Payment = components['schemas']['FinancePaymentOut'];
export type Adjustment = components['schemas']['AdjustmentOut'];
export type Preview = components['schemas']['PreviewOut'];
export type Statement = components['schemas']['StatementOut'];
export function validAmount(value: string): boolean {
  return /^\d{1,8}(\.\d{1,2})?$/.test(value) && new Decimal(value).gt(0) && new Decimal(value).lte('10000000');
}
export function limitWarning(balance: Pick<Balance, 'balance' | 'credit_limit' | 'overdue'>): 'danger' | 'warning' | undefined {
  if (new Decimal(balance.overdue).gt(0)) return 'danger';
  if (new Decimal(balance.credit_limit).gt(0) && new Decimal(balance.balance).gt(new Decimal(balance.credit_limit).mul('0.8')))
    return 'warning';
}
export function adjustmentBalance(balance: string, amount: string, type: string): string {
  return new Decimal(balance).plus(new Decimal(amount).mul(type === 'CREDIT' ? -1 : 1)).toFixed(2);
}
export function dushanbeToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}
