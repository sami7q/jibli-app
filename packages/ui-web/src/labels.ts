import type {
  CouponFundingSource,
  CouponType,
  DriverAvailability,
  ExpenseCategory,
  RestaurantRole,
  SettlementStatus,
  PlatformRole,
  VehicleType,
} from '@jibli/contracts';

/**
 * Arabic UI labels (plan Appendix A).
 *
 * Release 1 is Arabic-only, but the strings live here rather than inside
 * components so adding Kurdish or English later is a data change, not a rewrite
 * of every screen (plan §2).
 */

/*
 * Order and delivery statuses now live in `@jibli/contracts`, beside the enums
 * they name, so the mobile app can read the same Arabic. Re-exported here so
 * the twenty screens already importing them from this module keep working.
 */
export { DELIVERY_STATUS_LABELS, ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from '@jibli/contracts';

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  DRAFT: 'مسودة',
  ISSUED: 'صادر',
  PARTIALLY_PAID: 'مدفوع جزئياً',
  PAID: 'مدفوع',
  OVERDUE: 'متأخر',
  DISPUTED: 'قيد الاعتراض',
  VOID: 'ملغي',
};

/**
 * Driver availability, typed on the enum rather than on `string`.
 *
 * The order board and the drivers page each carried their own map keyed on
 * `string`, and both were wrong in the same way: they listed an `ONLINE` that
 * the enum does not have and omitted `AVAILABLE`, `ON_DELIVERY` and `BREAK`.
 * A driver in any of those three rendered as a raw English word to an Arabic
 * user. Typed on `DriverAvailability`, a new state now fails the build instead.
 */
export const DRIVER_AVAILABILITY_LABELS: Record<DriverAvailability, string> = {
  OFFLINE: 'خارج الدوام',
  AVAILABLE: 'متاح',
  BUSY: 'مشغول',
  ON_DELIVERY: 'في توصيل',
  BREAK: 'استراحة',
};

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  MOTORCYCLE: 'دراجة نارية',
  CAR: 'سيارة',
  BICYCLE: 'دراجة هوائية',
  ON_FOOT: 'مشياً',
};

export const RESTAURANT_ROLE_LABELS: Record<RestaurantRole, string> = {
  OWNER: 'المالك',
  MANAGER: 'مدير',
  CASHIER: 'كاشير',
  KITCHEN: 'المطبخ',
  INVENTORY_MANAGER: 'مسؤول المخزون',
  ACCOUNTANT: 'محاسب',
};

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  SUPER_ADMIN: 'مدير النظام',
  OPERATIONS_ADMIN: 'مدير العمليات',
  FINANCE_ADMIN: 'مدير مالي',
  RESTAURANT_ONBOARDING: 'مسؤول انضمام المطاعم',
  SUPPORT_AGENT: 'الدعم الفني',
  MARKETING: 'التسويق',
  ANALYST: 'محلل بيانات',
  AUDITOR: 'مدقق',
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  SALARIES: 'رواتب',
  RENT: 'إيجار',
  INGREDIENTS: 'مواد أولية',
  UTILITIES: 'خدمات ومرافق',
  MARKETING: 'تسويق',
  MAINTENANCE: 'صيانة',
  DELIVERY: 'توصيل',
  OTHER: 'أخرى',
};

/** Restaurant Portal navigation (plan §131). */
/**
 * The portal's sidebar.
 *
 * One entry's label is not a constant: a grocer's catalog is «المنتجات» and a
 * cook's is «القائمة», and the same sidebar serves both. `catalogLabel` marks
 * the entry whose label comes from the merchant's type instead — see
 * `MERCHANT_TYPE_LABELS` in @jibli/contracts and the `words` on the portal
 * session.
 *
 * Marked rather than removed, so the array stays the single description of the
 * sidebar and nothing has to remember to splice an entry back in at the right
 * position.
 */
export const RESTAURANT_NAV = [
  { href: '/', labelAr: 'الرئيسية', icon: 'home' },
  { href: '/orders', labelAr: 'الطلبات', icon: 'orders' },
  { href: '/menu', labelAr: 'المنيو', icon: 'menu', catalogLabel: true },
  { href: '/inventory', labelAr: 'المخزون', icon: 'inventory' },
  { href: '/profits', labelAr: 'الأرباح', icon: 'profits' },
  { href: '/commissions', labelAr: 'المستحق لجيبلي', icon: 'commissions' },
  { href: '/settlements', labelAr: 'التسويات', icon: 'settlements' },
  { href: '/drivers', labelAr: 'السائقون', icon: 'drivers' },
  { href: '/staff', labelAr: 'الموظفون', icon: 'staff' },
  { href: '/reviews', labelAr: 'التقييمات', icon: 'star' },
  { href: '/support', labelAr: 'الدعم', icon: 'support' },
  { href: '/settings', labelAr: 'الإعدادات', icon: 'settings' },
] as const;

/** Admin Portal navigation (plan §130). */
export const ADMIN_NAV = [
  { group: null, items: [{ href: '/', labelAr: 'الرئيسية', icon: 'home' }] },
  /*
   * Both halves of the marketplace, in one group.
   *
   * Markets shipped as a kind of merchant rather than a parallel system — one
   * column on `restaurants` — and the sidebar was the one place that never
   * said so. A group called «إدارة المطاعم» containing only «المطاعم» is a
   * navigation that denies a whole side of the business exists: an operator
   * asked to add a market looked for the word, did not find it, and concluded
   * the feature was missing. It was not missing; it was unreachable, which to
   * the person holding the mouse is the same thing.
   *
   * «المطاعم» keeps showing both kinds — its type filter is set to «مطاعم
   * وماركتات» by default, because somebody searching a partner by name rarely
   * remembers which of the two it is. «الماركتات» is the same directory with
   * the question already answered.
   *
   * «التصنيفات» and «شكل التطبيق» serve both storefronts and carry their own
   * switch, which is why the group can no longer be named after one of them.
   */
  {
    group: 'المتاجر والأقسام',
    items: [
      { href: '/restaurants', labelAr: 'المطاعم', icon: 'restaurants' },
      { href: '/markets', labelAr: 'الماركتات', icon: 'markets' },
      { href: '/cosmetics', labelAr: 'متاجر التجميل', icon: 'cosmetics' },
      { href: '/applications', labelAr: 'طلبات الانضمام', icon: 'applications' },
      { href: '/categories', labelAr: 'التصنيفات', icon: 'categories' },
      { href: '/appearance', labelAr: 'شكل التطبيق', icon: 'live' },
    ],
  },
  {
    group: 'إدارة الطلبات',
    items: [
      { href: '/orders', labelAr: 'جميع الطلبات', icon: 'orders' },
      { href: '/orders/live', labelAr: 'الطلبات الحية', icon: 'live' },
      { href: '/orders/cancelled', labelAr: 'الطلبات الملغاة', icon: 'cancelled' },
    ],
  },
  {
    group: 'الأشخاص',
    items: [
      // Markets have owners too, and they appear on this screen.
      { href: '/users', labelAr: 'ملاك المتاجر', icon: 'users' },
      { href: '/drivers', labelAr: 'المندوبون', icon: 'drivers' },
    ],
  },
  {
    group: 'الدعم والتقييم',
    items: [
      { href: '/support', labelAr: 'رسائل المطاعم', icon: 'support' },
      { href: '/reviews', labelAr: 'التقييمات', icon: 'star' },
    ],
  },
  {
    group: 'المالية والتقارير',
    items: [
      { href: '/finance/settlements', labelAr: 'العمولات', icon: 'commissions' },
      { href: '/finance/reports', labelAr: 'التقارير المالية', icon: 'reports' },
      { href: '/finance/invoices', labelAr: 'الفواتير', icon: 'invoices' },
    ],
  },
  {
    group: 'التغطية الجغرافية',
    items: [{ href: '/geography', labelAr: 'المناطق والتغطية', icon: 'geography' }],
  },
  {
    group: 'التسويق والعروض',
    items: [{ href: '/coupons', labelAr: 'الكوبونات والعروض', icon: 'coupons' }],
  },
  {
    group: 'الإعدادات',
    items: [
      { href: '/settings', labelAr: 'إعدادات المنصة', icon: 'settings' },
      { href: '/settings/roles', labelAr: 'الأدوار والصلاحيات', icon: 'roles' },
      { href: '/audit', labelAr: 'السجلات والأنشطة', icon: 'audit' },
    ],
  },
] as const;

/** Live-order lanes on the restaurant board (plan §29). */
export const ORDER_LANES = [
  { key: 'PENDING_RESTAURANT', labelAr: 'طلبات جديدة', tone: 'new' },
  { key: 'ACCEPTED', labelAr: 'مقبول', tone: 'progress' },
  { key: 'PREPARING', labelAr: 'قيد التحضير', tone: 'progress' },
  { key: 'READY', labelAr: 'جاهز', tone: 'ready' },
  { key: 'OUT_FOR_DELIVERY', labelAr: 'قيد التوصيل', tone: 'progress' },
  { key: 'COMPLETED', labelAr: 'مكتمل مؤخراً', tone: 'done' },
] as const;

/** Common action labels (plan Appendix A). */
export const ACTIONS_AR = {
  accept: 'قبول',
  reject: 'رفض',
  startPreparing: 'تم بدء التحضير',
  markReady: 'تم التجهيز',
  markDelivered: 'تم التسليم',
  assignDriver: 'تعيين سائق',
  save: 'حفظ',
  cancel: 'إلغاء',
  confirm: 'تأكيد',
  edit: 'تعديل',
  delete: 'حذف',
  search: 'بحث',
  viewAll: 'عرض الكل',
  refresh: 'تحديث',
  export: 'تصدير',
  retry: 'إعادة المحاولة',
  enableSound: 'تفعيل تنبيهات الطلبات',
  print: 'طباعة',
} as const;

/** Empty and error states — never a bare "something went wrong" (plan §112). */
export const EMPTY_STATES_AR = {
  noOrders: 'لا توجد طلبات حالياً',
  noNewOrders: 'لا توجد طلبات جديدة',
  noRestaurants: 'لا توجد مطاعم متاحة في هذه المدينة حالياً',
  noResults: 'لا توجد نتائج مطابقة',
  noInventory: 'لم تتم إضافة أصناف للمخزون بعد',
  noSettlements: 'لا توجد تسويات بعد',
  noDrivers: 'لم تتم إضافة سائقين بعد',
  offline: 'لا يوجد اتصال بالإنترنت',
  reconnecting: 'جاري إعادة الاتصال…',
  loadFailed: 'تعذّر تحميل البيانات',
} as const;

/** Plan §60: whose money a discount comes out of, which sets the commission base. */
export const COUPON_FUNDING_LABELS: Record<CouponFundingSource, string> = {
  PLATFORM: 'تموّله جيبلي',
  RESTAURANT: 'يموّله المطعم',
  SHARED: 'تمويل مشترك',
};

export const COUPON_TYPE_LABELS: Record<CouponType, string> = {
  PERCENTAGE: 'نسبة مئوية',
  FIXED_AMOUNT: 'مبلغ ثابت',
};

export const COUPON_STATE_LABELS: Record<string, string> = {
  ACTIVE: 'فعّال',
  SCHEDULED: 'مجدول',
  EXPIRED: 'منتهي',
  DISABLED: 'موقوف',
  EXHAUSTED: 'استُنفد',
};

/**
 * Audit actions, in Arabic.
 *
 * Keyed by the value stored in `audit_logs.action` — the dotted string, not the
 * constant's name. The dashboard had its own copy keyed by the *name*, so every
 * row on the main screen rendered the raw `restaurant.create` instead of
 * Arabic, and the audit page had a second copy that was correct but covered
 * fewer than half the actions.
 *
 * One map, here, covering every action the domain can write. A new action added
 * without a label shows its raw value, which is the visible reminder to add one.
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'config.update': 'تعديل إعدادات المنصة',

  'coupon.create': 'إنشاء كوبون',
  'coupon.update': 'تعديل كوبون',

  'customer.block': 'حظر عميل',
  'customer.phone.unmask': 'كشف رقم هاتف عميل',

  'delivery.pin.override': 'تجاوز رمز التسليم',

  'driver.create': 'إضافة مندوب',
  'driver.suspend': 'إيقاف مندوب',

  'export.create': 'تصدير بيانات',

  'geography.governorate.update': 'تعديل تغطية محافظة',
  'geography.city.update': 'تعديل تغطية مدينة',

  'inventory.adjust': 'تسوية مخزون',

  'order.override': 'تدخّل إداري في طلب',

  'password.change': 'تغيير كلمة مرور',

  'portal_user.create': 'إنشاء حساب بوابة',
  'portal_user.reset_password': 'إعادة تعيين كلمة مرور حساب بوابة',
  'portal_user.suspend': 'إيقاف حساب بوابة',
  'portal_user.reactivate': 'إعادة تفعيل حساب بوابة',

  'restaurant.create': 'إضافة مطعم',
  'restaurant.approve': 'اعتماد مطعم',
  'restaurant.reject': 'رفض طلب انضمام',
  'restaurant.request_info': 'طلب معلومات إضافية',
  'restaurant.suspend': 'إيقاف مطعم',
  'restaurant.reactivate': 'إعادة تفعيل مطعم',
  'restaurant.commission.update': 'تعديل نسبة عمولة',
  'restaurant.location_change.approve': 'اعتماد تغيير موقع مطعم',

  'roles.grant': 'منح صلاحية',
  'roles.revoke': 'سحب صلاحية',

  'staff.invite': 'دعوة موظف',
  'staff.deactivate': 'إيقاف موظف',

  'finance.settlement.generate': 'توليد كشف تسوية',
  'finance.settlement.issue': 'إصدار كشف تسوية',
  'finance.settlement.void': 'إلغاء كشف تسوية',
  'finance.adjustment.create': 'إضافة تسوية مالية',
  'finance.payment.record': 'تسجيل دفعة',
};

/**
 * Which family an audit action belongs to, for colouring it in a feed.
 * Derived from the prefix so a new action is classified without a code change.
 */
export function auditActionTone(action: string): 'positive' | 'negative' | 'money' | 'neutral' {
  if (/\.(approve|reactivate|create|grant|invite)$/.test(action)) return 'positive';
  if (/\.(reject|suspend|void|block|deactivate|revoke|override|unmask)$/.test(action)) {
    return 'negative';
  }
  if (action.startsWith('finance.')) return 'money';
  return 'neutral';
}
