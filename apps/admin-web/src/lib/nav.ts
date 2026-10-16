import type { AdminPermission } from '@jibli/contracts';
import { ADMIN_NAV } from '@jibli/ui-web';

/**
 * Which permission each admin screen requires (ADMIN-11).
 *
 * `ADMIN_NAV` lives in `packages/ui-web` and carries no permission field, so
 * the sidebar used to show all twenty links to every role and three roles even
 * landed on a dashboard they could not read. This map is the admin-local
 * overlay: it keys the same `href`s to the read permission the matching API
 * route enforces, so the shell can hide a link a role cannot open and a page
 * can show a `ForbiddenState` instead of an English error box.
 *
 * It mirrors the server exactly — e.g. the categories and banner *views* need
 * only `restaurant.read` (every role has it); their mutations need
 * `config.write`, which the pages gate on separately.
 */
export const NAV_PERMISSION: Record<string, AdminPermission> = {
  '/': 'reports.read.global',
  '/restaurants': 'restaurant.read',
  '/markets': 'restaurant.read',
  '/cosmetics': 'restaurant.read',
  '/applications': 'restaurant.read',
  '/categories': 'restaurant.read',
  '/appearance': 'restaurant.read',
  '/orders': 'order.read.global',
  '/orders/live': 'order.read.global',
  '/orders/cancelled': 'order.read.global',
  '/users': 'customer.read',
  '/drivers': 'driver.read.global',
  '/support': 'restaurant.read',
  '/reviews': 'restaurant.read',
  '/finance/settlements': 'finance.read.global',
  '/finance/reports': 'finance.read.global',
  '/finance/invoices': 'finance.read.global',
  '/geography': 'geography.read',
  '/coupons': 'coupon.manage',
  '/settings': 'config.read',
  '/settings/roles': 'roles.read',
  '/audit': 'audit.read',
};

/** Whether a screen is permitted. An unmapped path (e.g. own security page) is open. */
export function canOpen(href: string, can: (permission: AdminPermission) => boolean): boolean {
  const permission = NAV_PERMISSION[href];
  return permission ? can(permission) : true;
}

/**
 * The first screen this role may open, in sidebar order (ADMIN-11).
 *
 * A role without `reports.read.global` has no business on the dashboard; send
 * it here instead of showing it an error. Every platform role holds
 * `restaurant.read`, so in practice this resolves to «المطاعم» at worst; the
 * own-security page is the last resort if somehow nothing matched.
 */
export function firstPermittedPath(can: (permission: AdminPermission) => boolean): string {
  for (const section of ADMIN_NAV) {
    for (const item of section.items) {
      if (canOpen(item.href, can)) return item.href;
    }
  }
  return '/settings/mfa';
}
