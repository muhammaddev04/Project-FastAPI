import {
  Archive,
  BarChart3,
  Boxes,
  Building2,
  ClipboardList,
  CreditCard,
  Handshake,
  LayoutDashboard,
  LayoutGrid,
  type LucideIcon,
  Package,
  RotateCcw,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import type { Area } from '@/shared/auth/context';
import type { Membership, Role } from '@/shared/auth/types';

/** TZ phase that delivers a module. Items with a phase render an honest "planned" page until it ships. */
export type Phase = 'P02' | 'P03' | 'P04' | 'P05' | 'P06' | 'P07' | 'P08' | 'P09' | 'P10' | 'P12';

export type NavItem = {
  key: string;
  /** Relative to the area root; '' is the dashboard. */
  path: string;
  icon: LucideIcon;
  /** Roles that see the item (TZ §4.5 / §32.1, stricter rule wins). Omitted = every role in the area. */
  roles?: Role[];
  /** Permission from /me required to see the item (FE-004). */
  permission?: string;
  phase?: Phase;
  /** Shown in the Store mobile tab bar. */
  primary?: boolean;
};

export type NavSection = { key: string; items: NavItem[] };

const COMPANY: NavSection[] = [
  {
    key: 'operations',
    items: [
      { key: 'dashboard', path: '', icon: LayoutDashboard },
      { key: 'orders', path: 'orders', icon: ClipboardList, roles: ['OWNER', 'MANAGER', 'OPERATOR'], phase: 'P07' },
      { key: 'catalog', path: 'catalog', icon: Package, roles: ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE'] },
      { key: 'inventory', path: 'warehouse/stock', icon: Boxes, permission: 'stock.view' },
      { key: 'partners', path: 'partners', icon: Handshake, roles: ['OWNER', 'MANAGER', 'OPERATOR'], phase: 'P06' },
      { key: 'delivery', path: 'delivery', icon: Truck, roles: ['OWNER', 'MANAGER'], phase: 'P08' },
      { key: 'finance', path: 'finance', icon: Wallet, roles: ['OWNER', 'MANAGER', 'OPERATOR'], phase: 'P09' },
      { key: 'returns', path: 'returns', icon: RotateCcw, roles: ['OWNER', 'MANAGER', 'OPERATOR'], phase: 'P10' },
      { key: 'reports', path: 'reports', icon: BarChart3, roles: ['OWNER', 'MANAGER'], phase: 'P12' },
    ],
  },
  {
    key: 'organization',
    items: [
      { key: 'team', path: 'team', icon: Users, permission: 'members.view' },
      { key: 'subscription', path: 'settings/subscription', icon: CreditCard, roles: ['OWNER', 'MANAGER'] },
      { key: 'settings', path: 'settings', icon: Settings, roles: ['OWNER', 'MANAGER'] },
    ],
  },
];

const STORE: NavSection[] = [
  {
    key: 'buying',
    items: [
      { key: 'dashboard', path: '', icon: LayoutGrid, primary: true },
      { key: 'suppliers', path: 'suppliers', icon: Building2, phase: 'P06' },
      { key: 'catalog', path: 'catalog', icon: Archive, phase: 'P07', primary: true },
      { key: 'cart', path: 'cart', icon: ShoppingCart, phase: 'P07', primary: true },
      { key: 'orders', path: 'orders', icon: ClipboardList, phase: 'P07', primary: true },
      { key: 'debt', path: 'debt', icon: Wallet, roles: ['OWNER'], phase: 'P09', primary: true },
      { key: 'returns', path: 'returns', icon: RotateCcw, roles: ['OWNER'], phase: 'P10' },
    ],
  },
  {
    key: 'organization',
    items: [
      { key: 'team', path: 'team', icon: Users, permission: 'members.view' },
      { key: 'settings', path: 'settings', icon: Settings, roles: ['OWNER'] },
    ],
  },
];

const COURIER: NavSection[] = [
  {
    key: 'runs',
    items: [
      { key: 'today', path: '', icon: Truck, primary: true },
      { key: 'history', path: 'history', icon: ClipboardList, phase: 'P08', primary: true },
    ],
  },
];

const BY_AREA: Record<Area, NavSection[]> = { company: COMPANY, store: STORE, courier: COURIER };

export function canSee(item: NavItem, membership: Membership): boolean {
  if (item.roles && !item.roles.includes(membership.role)) return false;
  if (item.permission && !membership.permissions.includes(item.permission)) return false;
  return true;
}

/** Navigation for the active membership, with sections left empty by role filtering removed. */
export function navFor(area: Area, membership: Membership): NavSection[] {
  return BY_AREA[area]
    .map((section) => ({ ...section, items: section.items.filter((item) => canSee(item, membership)) }))
    .filter((section) => section.items.length > 0);
}

/**
 * Splits navigation into what works today and what a later TZ phase delivers.
 *
 * An item carrying a `phase` renders an honest "planned" page, so previously a Company OWNER opened the
 * product to nine sidebar entries of which seven led nowhere. Mixed into the same list, that reads as a
 * broken application rather than an early one. `available` keeps its sections and grouping; `planned`
 * collapses into one quiet list the shell renders apart from the working navigation, so the sidebar answers
 * "what can I do now" at a glance while the roadmap stays discoverable.
 *
 * Both halves keep their routes: a planned path still resolves to its placeholder page if opened directly.
 */
export function navByAvailability(area: Area, membership: Membership): { available: NavSection[]; planned: NavItem[] } {
  const sections = navFor(area, membership);
  return {
    available: sections
      .map((section) => ({ ...section, items: section.items.filter((item) => !item.phase) }))
      .filter((section) => section.items.length > 0),
    planned: sections.flatMap((section) => section.items.filter((item) => item.phase)),
  };
}

export function findItem(area: Area, path: string): NavItem | undefined {
  return BY_AREA[area].flatMap((section) => section.items).find((item) => item.path === path);
}
