import type { PlatformRole, RestaurantRole } from './enums.js';

/**
 * RBAC plus scope (plan §85).
 *
 * A permission answers *what* action a user may take; scope answers *where* it
 * applies. Default is deny: adding a permission here grants it to nobody until a
 * role matrix below lists it explicitly.
 */

// ── Restaurant-scoped permissions (plan §85, §86) ────────────────────────────

export const RESTAURANT_PERMISSIONS = [
  'order.read',
  'order.accept',
  'order.reject',
  'order.prepare',
  'order.ready',
  'order.cancel',
  'menu.read',
  'menu.write',
  'inventory.read',
  'inventory.adjust',
  'inventory.waste',
  'inventory.cost.read',
  'driver.read',
  'driver.manage',
  'driver.assign',
  'driver.cash.read',
  'driver.cash.handover',
  'finance.read',
  'finance.settlement.read',
  'finance.settlement.dispute',
  'expense.read',
  'expense.write',
  'profit.read',
  'staff.read',
  'staff.manage',
  'settings.read',
  'settings.write',
  'restaurant.location.request_change',
  'reports.read',
] as const;

export type RestaurantPermission = (typeof RESTAURANT_PERMISSIONS)[number];

/**
 * Plan §86. Cashier deliberately excludes cost and profit; Kitchen sees only the
 * preparation lane; Accountant gets finance but not operational state changes.
 */
export const RESTAURANT_ROLE_PERMISSIONS: Record<
  RestaurantRole,
  readonly RestaurantPermission[]
> = {
  OWNER: RESTAURANT_PERMISSIONS,

  MANAGER: [
    'order.read',
    'order.accept',
    'order.reject',
    'order.prepare',
    'order.ready',
    'order.cancel',
    'menu.read',
    'menu.write',
    'inventory.read',
    'inventory.adjust',
    'inventory.waste',
    'inventory.cost.read',
    'driver.read',
    'driver.manage',
    'driver.assign',
    'driver.cash.read',
    'driver.cash.handover',
    'finance.read',
    'finance.settlement.read',
    'expense.read',
    'expense.write',
    'profit.read',
    'staff.read',
    'settings.read',
    'settings.write',
    'reports.read',
  ],

  CASHIER: [
    'order.read',
    'order.accept',
    'order.reject',
    'order.prepare',
    'order.ready',
    'menu.read',
    'driver.read',
    'driver.assign',
  ],

  KITCHEN: ['order.read', 'order.prepare', 'order.ready', 'menu.read', 'inventory.read'],

  INVENTORY_MANAGER: [
    'order.read',
    'menu.read',
    'inventory.read',
    'inventory.adjust',
    'inventory.waste',
    'inventory.cost.read',
    'reports.read',
  ],

  ACCOUNTANT: [
    'order.read',
    'finance.read',
    'finance.settlement.read',
    'finance.settlement.dispute',
    'expense.read',
    'expense.write',
    'profit.read',
    'inventory.cost.read',
    'driver.cash.read',
    'driver.cash.handover',
    'reports.read',
  ],
};

// ── Platform-scoped permissions (plan §85, §87) ──────────────────────────────

export const ADMIN_PERMISSIONS = [
  'geography.read',
  'geography.manage',
  'restaurant.read',
  'restaurant.create',
  'restaurant.approve',
  'restaurant.reject',
  'restaurant.suspend',
  'restaurant.commission.update',
  'restaurant.location.approve',
  'order.read.global',
  'order.override',
  'driver.read.global',
  'driver.suspend',
  'customer.read',
  'customer.block',
  'customer.phone.unmask',
  'finance.read.global',
  'finance.settlement.generate',
  'finance.settlement.issue',
  'finance.settlement.void',
  'finance.payment.record',
  'finance.adjustment.create',
  'roles.manage',
  'audit.read',
  'export.create',
  'config.read',
  'config.write',
  'coupon.manage',
  'reports.read.global',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Plan §87. */
export const ADMIN_ROLE_PERMISSIONS: Record<PlatformRole, readonly AdminPermission[]> = {
  SUPER_ADMIN: ADMIN_PERMISSIONS,

  OPERATIONS_ADMIN: [
    'geography.read',
    'geography.manage',
    'restaurant.read',
    'restaurant.create',
    'restaurant.suspend',
    'restaurant.location.approve',
    'order.read.global',
    'order.override',
    'driver.read.global',
    'driver.suspend',
    'customer.read',
    'config.read',
    'reports.read.global',
    'export.create',
  ],

  FINANCE_ADMIN: [
    'geography.read',
    'restaurant.read',
    'restaurant.commission.update',
    'order.read.global',
    'finance.read.global',
    'finance.settlement.generate',
    'finance.settlement.issue',
    'finance.settlement.void',
    'finance.payment.record',
    'finance.adjustment.create',
    'reports.read.global',
    'export.create',
    'audit.read',
  ],

  RESTAURANT_ONBOARDING: [
    'geography.read',
    'restaurant.read',
    'restaurant.create',
    'restaurant.approve',
    'restaurant.reject',
  ],

  SUPPORT_AGENT: [
    'geography.read',
    'restaurant.read',
    'order.read.global',
    'driver.read.global',
    'customer.read',
  ],

  MARKETING: ['geography.read', 'restaurant.read', 'coupon.manage', 'reports.read.global'],

  ANALYST: ['geography.read', 'restaurant.read', 'order.read.global', 'reports.read.global'],

  AUDITOR: [
    'geography.read',
    'restaurant.read',
    'order.read.global',
    'finance.read.global',
    'audit.read',
  ],
};

/**
 * Actions that demand a fresh MFA challenge even inside a valid session
 * (plan §88). These move money or grant power.
 */
export const REAUTHENTICATION_REQUIRED_PERMISSIONS: readonly AdminPermission[] = [
  'finance.settlement.void',
  'finance.adjustment.create',
  'restaurant.commission.update',
  'roles.manage',
  'customer.phone.unmask',
];

/** Roles for which MFA must be enrolled before production launch (plan §88). */
export const MFA_MANDATORY_ROLES: readonly PlatformRole[] = ['SUPER_ADMIN', 'FINANCE_ADMIN'];

export function restaurantPermissionsFor(roles: readonly RestaurantRole[]): Set<RestaurantPermission> {
  const granted = new Set<RestaurantPermission>();
  for (const role of roles) {
    for (const permission of RESTAURANT_ROLE_PERMISSIONS[role] ?? []) granted.add(permission);
  }
  return granted;
}

export function adminPermissionsFor(roles: readonly PlatformRole[]): Set<AdminPermission> {
  const granted = new Set<AdminPermission>();
  for (const role of roles) {
    for (const permission of ADMIN_ROLE_PERMISSIONS[role] ?? []) granted.add(permission);
  }
  return granted;
}

export function requiresReauthentication(permission: AdminPermission): boolean {
  return REAUTHENTICATION_REQUIRED_PERMISSIONS.includes(permission);
}
