import type { AdminPermission } from '@jibli/contracts';
import type { IconName } from '@/components/icon';

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
 * The sidebar: seven sections, each a family of screens shown as tabs.
 *
 * It used to be twenty-two links in nine groups — three for orders, five for
 * shops, three for money — so finding a screen meant knowing which group a
 * designer had filed it under. Now the sidebar names the seven jobs an
 * operator does, and the screens inside a job are tabs along the top of it.
 * No screen went away and no URL changed: every old link opens the same page,
 * now with its siblings beside it.
 *
 * `match` lists the path prefixes that belong to a section beyond its tabs —
 * an order's own page belongs to «الطلبات», a shop's to «المتاجر».
 */
export interface AdminSection {
  readonly labelAr: string;
  readonly icon: IconName;
  readonly tabs: readonly { readonly href: string; readonly labelAr: string }[];
  readonly match?: readonly string[];
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { labelAr: 'الرئيسية', icon: 'home', tabs: [{ href: '/', labelAr: 'الرئيسية' }] },
  {
    labelAr: 'الطلبات',
    icon: 'orders',
    tabs: [
      { href: '/orders/live', labelAr: 'الطلبات الحية' },
      { href: '/orders', labelAr: 'جميع الطلبات' },
      { href: '/orders/cancelled', labelAr: 'الملغاة' },
    ],
    match: ['/orders/'],
  },
  {
    labelAr: 'المتاجر',
    icon: 'restaurants',
    tabs: [
      { href: '/restaurants', labelAr: 'المطاعم' },
      { href: '/markets', labelAr: 'الماركتات' },
      { href: '/cosmetics', labelAr: 'متاجر التجميل' },
      { href: '/applications', labelAr: 'طلبات الانضمام' },
      { href: '/users', labelAr: 'الملاك والمستخدمون' },
    ],
    match: ['/restaurants/'],
  },
  { labelAr: 'المندوبون', icon: 'drivers', tabs: [{ href: '/drivers', labelAr: 'المندوبون' }] },
  {
    labelAr: 'الدعم والتقييمات',
    icon: 'support',
    tabs: [
      { href: '/support', labelAr: 'رسائل المتاجر' },
      { href: '/reviews', labelAr: 'التقييمات' },
    ],
    match: ['/support/'],
  },
  {
    labelAr: 'المالية',
    icon: 'commissions',
    tabs: [
      { href: '/finance/settlements', labelAr: 'العمولات' },
      { href: '/finance/reports', labelAr: 'التقارير' },
      { href: '/finance/invoices', labelAr: 'الفواتير' },
    ],
    match: ['/finance/'],
  },
  {
    labelAr: 'الإعدادات',
    icon: 'settings',
    tabs: [
      { href: '/appearance', labelAr: 'شكل التطبيق' },
      { href: '/categories', labelAr: 'التصنيفات' },
      { href: '/geography', labelAr: 'المناطق' },
      { href: '/coupons', labelAr: 'العروض والكوبونات' },
      { href: '/settings', labelAr: 'إعدادات المنصة' },
      { href: '/settings/roles', labelAr: 'الصلاحيات' },
      { href: '/audit', labelAr: 'سجل العمليات' },
    ],
    match: ['/settings/'],
  },
];

/** The section a path belongs to: an exact tab first, then a prefix. */
export function sectionFor(pathname: string): AdminSection | null {
  return (
    ADMIN_SECTIONS.find((section) => section.tabs.some((tab) => tab.href === pathname)) ??
    ADMIN_SECTIONS.find((section) => section.match?.some((prefix) => pathname.startsWith(prefix))) ??
    null
  );
}

/** A section's tabs this role may open; the section is hidden when none are left. */
export function visibleTabs(
  section: AdminSection,
  can: (permission: AdminPermission) => boolean,
): AdminSection['tabs'] {
  return section.tabs.filter((tab) => canOpen(tab.href, can));
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
  for (const section of ADMIN_SECTIONS) {
    for (const tab of section.tabs) {
      if (canOpen(tab.href, can)) return tab.href;
    }
  }
  return '/settings/mfa';
}
