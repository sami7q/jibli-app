/**
 * Domain enumerations shared by the API, workers, portals and mobile app.
 *
 * These values are persisted, so renaming one is a migration, not a refactor.
 */

// ── Geography ────────────────────────────────────────────────────────────────

/** Plan §8.5: three independent capabilities, never one `is_active` flag. */
export const GEOGRAPHY_CAPABILITIES = [
  'customer_signup',
  'restaurant_onboarding',
  'ordering',
] as const;
export type GeographyCapability = (typeof GEOGRAPHY_CAPABILITIES)[number];

// ── Identity ─────────────────────────────────────────────────────────────────

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PLATFORM_ROLES = [
  'SUPER_ADMIN',
  'OPERATIONS_ADMIN',
  'FINANCE_ADMIN',
  'RESTAURANT_ONBOARDING',
  'SUPPORT_AGENT',
  'MARKETING',
  'ANALYST',
  'AUDITOR',
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Plan §61. */
export const RESTAURANT_ROLES = [
  'OWNER',
  'MANAGER',
  'CASHIER',
  'KITCHEN',
  'INVENTORY_MANAGER',
  'ACCOUNTANT',
] as const;
export type RestaurantRole = (typeof RESTAURANT_ROLES)[number];

// ── Provider / restaurant ────────────────────────────────────────────────────

/** Plan §16: RESTAURANT in Release 1; the rest are the documented extension points. */
export const PROVIDER_TYPES = [
  'RESTAURANT',
  'WATER_FACTORY',
  'WATER_TANKER',
  'GAS_PROVIDER',
  'GROCERY',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

/**
 * Which storefront a merchant appears in.
 *
 * Narrower than `ProviderType`, and not a duplicate of it. `ProviderType`
 * describes what kind of business a provider is — the extension points in plan
 * §16, most of which do not exist yet. This answers a question the customer
 * app asks on every load: which of the two tabs does this merchant belong to.
 *
 * One value per section of the customer app: food, the market, and cosmetics.
 * A new value means a new section on the chooser, which is a product decision
 * rather than a schema one — and once made, it is this list plus the labels
 * below, because every section runs through the same ordering machinery.
 */
export const MERCHANT_TYPES = ['RESTAURANT', 'MARKET', 'COSMETICS'] as const;
export type MerchantType = (typeof MERCHANT_TYPES)[number];

/**
 * What each is called, and what its catalog is called.
 *
 * Kept together because they are always needed together: a portal screen that
 * says «القائمة» to a grocer is as wrong as one that says «المنتجات» to a
 * cook, and splitting the two labels across files is how one of them gets
 * updated and the other does not.
 */
export const MERCHANT_TYPE_LABELS: Record<
  MerchantType,
  {
    readonly nameAr: string;
    readonly catalogAr: string;
    /** Indefinite — «إضافة صنف», «٢٤ صنفاً». */
    readonly itemAr: string;
    /** Definite — «حذف الصنف», «اسم الصنف». */
    readonly itemDefiniteAr: string;
  }
> = {
  RESTAURANT: {
    nameAr: 'مطعم',
    catalogAr: 'المنيو',
    itemAr: 'صنف',
    itemDefiniteAr: 'الصنف',
  },
  MARKET: {
    nameAr: 'ماركت',
    catalogAr: 'المنتجات',
    itemAr: 'منتج',
    itemDefiniteAr: 'المنتج',
  },
  COSMETICS: {
    nameAr: 'متجر تجميل',
    catalogAr: 'المنتجات',
    itemAr: 'منتج',
    itemDefiniteAr: 'المنتج',
  },
};

export const ONBOARDING_STATUSES = [
  'DRAFT',
  'UNDER_REVIEW',
  'INFO_REQUESTED',
  'APPROVED',
  'REJECTED',
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const OPERATIONAL_STATUSES = ['PENDING', 'ACTIVE', 'PAUSED', 'SUSPENDED'] as const;
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

/** Plan §33. Busy modes add preparation minutes; PAUSED stops new orders. */
export const BUSY_MODES = ['NORMAL', 'BUSY', 'VERY_BUSY', 'PAUSED'] as const;
export type BusyMode = (typeof BUSY_MODES)[number];

export const BUSY_MODE_EXTRA_MINUTES: Record<BusyMode, number> = {
  NORMAL: 0,
  BUSY: 15,
  VERY_BUSY: 30,
  PAUSED: 0,
};

// ── Orders ───────────────────────────────────────────────────────────────────

/** Plan §26. */
export const ORDER_STATUSES = [
  'PLACED',
  'PENDING_RESTAURANT',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH_ON_DELIVERY'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Plan §26. REFUNDED_FUTURE is reserved for the online-payments phase. */
export const PAYMENT_STATUSES = [
  'UNPAID',
  'CASH_EXPECTED',
  'PAID_CASH',
  'FAILED',
  'REFUNDED_FUTURE',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Who caused a state transition — recorded in order_status_history (plan §103). */
export const ACTOR_TYPES = ['CUSTOMER', 'RESTAURANT', 'DRIVER', 'ADMIN', 'SYSTEM'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const ORDER_REJECTION_REASONS = [
  'ITEM_UNAVAILABLE',
  'TOO_BUSY',
  'CLOSING',
  'ADDRESS_ISSUE',
  'CUSTOMER_UNREACHABLE',
  'OTHER',
] as const;
export type OrderRejectionReason = (typeof ORDER_REJECTION_REASONS)[number];

/**
 * Arabic labels for the reason the customer is shown when a shop rejects an
 * order (MERCH-20). Mirrors the owner-side picker so the customer sees the same
 * words the shop chose. A stored reason outside the list (legacy or free text)
 * is surfaced as the generic «سبب آخر».
 */
export const ORDER_REJECTION_REASON_LABELS_AR: Record<OrderRejectionReason, string> = {
  ITEM_UNAVAILABLE: 'صنف غير متوفر',
  TOO_BUSY: 'ضغط كبير الآن',
  CLOSING: 'المتجر يغلق',
  ADDRESS_ISSUE: 'مشكلة في العنوان',
  CUSTOMER_UNREACHABLE: 'تعذّر الوصول للعميل',
  OTHER: 'سبب آخر',
};

/** The Arabic label for a stored rejection reason, falling back to «سبب آخر». */
export function orderRejectionReasonLabelAr(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return (
    ORDER_REJECTION_REASON_LABELS_AR[reason as OrderRejectionReason] ??
    ORDER_REJECTION_REASON_LABELS_AR.OTHER
  );
}

export const ORDER_CANCELLATION_REASONS = [
  'CUSTOMER_CHANGED_MIND',
  'CUSTOMER_UNREACHABLE',
  'RESTAURANT_UNABLE',
  'NO_DRIVER_AVAILABLE',
  'ADDRESS_ISSUE',
  'DUPLICATE_ORDER',
  'ADMIN_OVERRIDE',
  'OTHER',
] as const;
export type OrderCancellationReason = (typeof ORDER_CANCELLATION_REASONS)[number];

// ── Delivery ─────────────────────────────────────────────────────────────────

/** Plan §49. */
export const DELIVERY_ASSIGNMENT_STATUSES = [
  'ASSIGNED',
  'ACCEPTED',
  'REJECTED',
  'PICKED_UP',
  'ARRIVED_CUSTOMER',
  'DELIVERED',
  'CANCELLED',
  'REASSIGNED',
] as const;
export type DeliveryAssignmentStatus = (typeof DELIVERY_ASSIGNMENT_STATUSES)[number];

/** Plan §46: account status is separate from availability. */
export const DRIVER_ACCOUNT_STATUSES = [
  'PENDING_ACTIVATION',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
] as const;
export type DriverAccountStatus = (typeof DRIVER_ACCOUNT_STATUSES)[number];

export const DRIVER_AVAILABILITIES = [
  'OFFLINE',
  'AVAILABLE',
  'BUSY',
  'ON_DELIVERY',
  'BREAK',
] as const;
export type DriverAvailability = (typeof DRIVER_AVAILABILITIES)[number];

export const VEHICLE_TYPES = ['MOTORCYCLE', 'CAR', 'BICYCLE', 'ON_FOOT'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

// ── Inventory ────────────────────────────────────────────────────────────────

/** Plan §35. */
export const INVENTORY_MOVEMENT_TYPES = [
  'OPENING_BALANCE',
  'PURCHASE',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'SALE_CONSUMPTION',
  'ADJUSTMENT',
  'WASTE',
  'RETURN',
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export const INVENTORY_UNITS = ['PIECE', 'GRAM', 'KILOGRAM', 'MILLILITER', 'LITER'] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];

/** Plan §36: when the reservation turns into consumption. */
export const INVENTORY_CONSUMPTION_POLICIES = ['ON_ACCEPT', 'ON_READY', 'ON_DELIVERED'] as const;
export type InventoryConsumptionPolicy = (typeof INVENTORY_CONSUMPTION_POLICIES)[number];

// ── Finance ──────────────────────────────────────────────────────────────────

/** Plan §40. */
export const SETTLEMENT_POLICIES = ['HALF_MONTH', 'MONTHLY'] as const;
export type SettlementPolicy = (typeof SETTLEMENT_POLICIES)[number];

/** Plan §42. */
export const SETTLEMENT_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'DISPUTED',
  'VOID',
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/** Plan §43. */
export const LEDGER_ENTRY_TYPES = [
  'COMMISSION_ACCRUED',
  'COMMISSION_PAYMENT',
  'COMMISSION_CREDIT',
  'COMMISSION_DEBIT',
  'SERVICE_FEE_REVENUE',
  'REVERSAL',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/** DEBIT increases what the restaurant owes Jibli; CREDIT decreases it. */
export const LEDGER_DIRECTIONS = ['DEBIT', 'CREDIT'] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

export const PAYMENT_RECORD_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const;
export type PaymentRecordMethod = (typeof PAYMENT_RECORD_METHODS)[number];

/** Plan §54. */
export const DRIVER_CASH_EVENT_TYPES = [
  'ORDER_CASH_COLLECTED',
  'CASH_HANDED_OVER',
  'CASH_ADJUSTMENT',
] as const;
export type DriverCashEventType = (typeof DRIVER_CASH_EVENT_TYPES)[number];

/** Plan §38. */
export const EXPENSE_CATEGORIES = [
  'SALARIES',
  'RENT',
  'INGREDIENTS',
  'UTILITIES',
  'MARKETING',
  'MAINTENANCE',
  'DELIVERY',
  'OTHER',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Plan §60. */
export const COUPON_FUNDING_SOURCES = ['PLATFORM', 'RESTAURANT', 'SHARED'] as const;
export type CouponFundingSource = (typeof COUPON_FUNDING_SOURCES)[number];

export const COUPON_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

// ── Platform plumbing ────────────────────────────────────────────────────────

export const OUTBOX_STATUSES = ['PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['PUSH', 'REALTIME', 'SMS', 'BROWSER'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const DEVICE_PLATFORMS = ['IOS', 'ANDROID', 'WEB'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const APP_MODES = ['CUSTOMER', 'DRIVER'] as const;
export type AppMode = (typeof APP_MODES)[number];
