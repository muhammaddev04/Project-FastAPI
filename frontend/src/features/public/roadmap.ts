import type { Phase } from '@/app/shell/nav-config';

/**
 * What the public site is allowed to claim (Phase E).
 *
 * Every capability named on these pages comes from here, and `phase` is copied from the same TZ phase that
 * `app/shell/nav-config.ts` uses to decide whether a sidebar entry opens a working page or a placeholder. An
 * item without a phase works today; an item with one does not, and the pages say so.
 *
 * This file exists so that the claim and the implementation cannot drift apart silently. When a phase ships,
 * its entry loses `phase` in nav-config and here, and the marketing copy stops promising and starts stating.
 */
export type ModuleKey =
  | 'organizations'
  | 'verification'
  | 'team'
  | 'areas'
  | 'catalog'
  | 'partnerships'
  | 'orders'
  | 'inventory'
  | 'delivery'
  | 'finance'
  | 'returns'
  | 'notifications'
  | 'reports'
  | 'subscriptions';

export type ModuleEntry = {
  key: ModuleKey;
  /** Absent when the capability is in the product today. */
  phase?: Phase | 'P11';
  /** Which side of the market the capability is mainly for; `both` when it is shared. */
  side: 'company' | 'store' | 'both';
};

export const ROADMAP: ModuleEntry[] = [
  { key: 'organizations', side: 'both' },
  { key: 'verification', side: 'both' },
  { key: 'team', side: 'both' },
  { key: 'areas', side: 'both' },
  { key: 'catalog', side: 'company' },
  { key: 'partnerships', phase: 'P06', side: 'both' },
  { key: 'orders', phase: 'P07', side: 'both' },
  { key: 'inventory', phase: 'P05', side: 'company' },
  { key: 'delivery', phase: 'P08', side: 'company' },
  { key: 'finance', phase: 'P09', side: 'both' },
  { key: 'returns', phase: 'P10', side: 'both' },
  { key: 'notifications', phase: 'P11', side: 'both' },
  { key: 'reports', phase: 'P12', side: 'company' },
  { key: 'subscriptions', phase: 'P03', side: 'company' },
];

export const LIVE_MODULES = ROADMAP.filter((entry) => !entry.phase);
export const PLANNED_MODULES = ROADMAP.filter((entry) => entry.phase);
