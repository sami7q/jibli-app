import {
  AppError,
  ERROR_CODES,
  type ErrorCode,
  type MerchantType,
  type OnboardingStatus,
  type OperationalStatus,
} from '@jibli/contracts';
import { cityHasCapability, type ResolvedCity } from '@jibli/geography';
import { evaluateOpenState, type OpenState, type OpenStateInput } from './working-hours.js';

/**
 * Marketplace eligibility (plan §18, §125).
 *
 * Final effective checkout eligibility is a conjunction of independent layers:
 *
 *   globalCheckoutEnabled
 *   AND governorate.orderingEnabled
 *   AND city.orderingEnabled
 *   AND restaurant.approved
 *   AND restaurant.active
 *   AND branch.active
 *   AND branch.acceptsOrders
 *   AND workingHours.allow
 *   AND serviceZone.allow
 *
 * "Each layer remains independent. Pausing a restaurant does not disable its
 * city. Disabling a city does not mark every restaurant record suspended."
 *
 * The evaluator returns *all* failing reasons rather than the first, so Support
 * can answer "why is this restaurant not orderable?" in one look (plan §18).
 */

export interface EligibilityInput {
  readonly globalCheckoutEnabled: boolean;
  readonly geography: ResolvedCity;
  readonly restaurant: {
    readonly id: string;
    readonly onboardingStatus: OnboardingStatus;
    readonly operationalStatus: OperationalStatus;
  };
  readonly branch: {
    readonly id: string;
    readonly isActive: boolean;
    readonly acceptsOrders: boolean;
  };
  readonly hours: OpenStateInput;
}

export interface EligibilityResult {
  readonly orderable: boolean;
  /** Machine-readable reasons, most specific first. Empty when orderable. */
  readonly reasons: ErrorCode[];
  readonly openState: OpenState;
}

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: ErrorCode[] = [];

  if (!input.globalCheckoutEnabled) {
    reasons.push(ERROR_CODES.GLOBAL_CHECKOUT_DISABLED);
  }

  // Geography first: a closed city explains everything downstream, and staff
  // should see a coverage banner rather than debug their menu (plan §113).
  if (!cityHasCapability(input.geography, 'ordering')) {
    reasons.push(ERROR_CODES.ORDERING_NOT_AVAILABLE_IN_CITY);
  }

  if (input.restaurant.onboardingStatus !== 'APPROVED') {
    reasons.push(ERROR_CODES.RESTAURANT_NOT_APPROVED);
  }

  switch (input.restaurant.operationalStatus) {
    case 'SUSPENDED':
      reasons.push(ERROR_CODES.RESTAURANT_SUSPENDED);
      break;
    case 'PAUSED':
      reasons.push(ERROR_CODES.RESTAURANT_PAUSED);
      break;
    case 'PENDING':
      reasons.push(ERROR_CODES.RESTAURANT_NOT_READY);
      break;
    case 'ACTIVE':
      break;
  }

  if (!input.branch.isActive || !input.branch.acceptsOrders) {
    reasons.push(ERROR_CODES.BRANCH_NOT_AVAILABLE);
  }

  const openState = evaluateOpenState(input.hours);
  if (!openState.isOpen) {
    reasons.push(ERROR_CODES.RESTAURANT_CLOSED);
  } else if (openState.isPaused) {
    reasons.push(ERROR_CODES.RESTAURANT_PAUSED);
  }

  return { orderable: reasons.length === 0, reasons, openState };
}

/**
 * Assert eligibility at checkout. Throws the most specific reason, with the
 * full list in details so the client can render an accurate Arabic message.
 */
export function assertOrderable(input: EligibilityInput): OpenState {
  const result = evaluateEligibility(input);
  if (!result.orderable) {
    const primary = result.reasons[0] ?? ERROR_CODES.RESTAURANT_NOT_READY;
    throw new AppError(primary, {
      details: {
        restaurantId: input.restaurant.id,
        branchId: input.branch.id,
        allReasons: result.reasons,
      },
    });
  }
  return result.openState;
}

/**
 * Straight-line distance between two coordinates, in metres.
 *
 * Haversine on a spherical earth. Accurate to a fraction of a percent at city
 * scale, which is well inside the tolerance of a delivery-radius rule.
 */
export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const EARTH_RADIUS_M = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(to.latitude - from.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);

  const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface ServiceZoneInput {
  readonly branch: {
    readonly cityId: string;
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly serviceRadiusMeters: number | null;
  };
  readonly address: {
    readonly cityId: string;
    readonly latitude: number | null;
    readonly longitude: number | null;
  };
}

export interface ServiceZoneResult {
  readonly allowed: boolean;
  readonly reason: 'OK' | 'DIFFERENT_CITY' | 'OUTSIDE_RADIUS' | 'MISSING_COORDINATES';
  readonly distanceMeters: number | null;
}

/**
 * Service-zone check (plan §106).
 *
 * Release 1 starts at city level with an optional radius. A customer's profile
 * city does not guarantee an address is inside a particular branch's zone.
 */
export function checkServiceZone(input: ServiceZoneInput): ServiceZoneResult {
  if (input.branch.cityId !== input.address.cityId) {
    return { allowed: false, reason: 'DIFFERENT_CITY', distanceMeters: null };
  }

  // No radius configured means city-level service, which we have just confirmed.
  if (input.branch.serviceRadiusMeters === null) {
    return { allowed: true, reason: 'OK', distanceMeters: null };
  }

  const { latitude: bLat, longitude: bLng } = input.branch;
  const { latitude: aLat, longitude: aLng } = input.address;
  if (bLat === null || bLng === null || aLat === null || aLng === null) {
    // A radius is configured but we cannot evaluate it. Allowing the order and
    // flagging the address is better than stranding a customer over a missing
    // map pin (plan §108).
    return { allowed: true, reason: 'MISSING_COORDINATES', distanceMeters: null };
  }

  const distance = distanceMeters(
    { latitude: bLat, longitude: bLng },
    { latitude: aLat, longitude: aLng },
  );
  return distance <= input.branch.serviceRadiusMeters
    ? { allowed: true, reason: 'OK', distanceMeters: distance }
    : { allowed: false, reason: 'OUTSIDE_RADIUS', distanceMeters: distance };
}

export function assertAddressServiceable(input: ServiceZoneInput): void {
  const result = checkServiceZone(input);
  if (!result.allowed) {
    throw new AppError(ERROR_CODES.ADDRESS_OUT_OF_SERVICE, {
      details: { reason: result.reason, distanceMeters: result.distanceMeters },
    });
  }
}

/**
 * Onboarding readiness checklist (plan §122).
 *
 * Admin approval UI shows failures rather than relying on memory.
 */
export interface ReadinessInput {
  readonly applicationApproved: boolean;
  readonly cityOrderingEnabled: boolean;
  readonly ownerActive: boolean;
  readonly branchLocationValid: boolean;
  readonly workingHoursConfigured: boolean;
  readonly hasActiveMenuItem: boolean;
  readonly commissionConfigured: boolean;
  readonly settlementPolicyConfigured: boolean;
  readonly deliveryConfigured: boolean;
  readonly hasActiveDriver: boolean;
  readonly orderAlertAcknowledged: boolean;
  readonly requiredDocumentsPresent: boolean;
}

export interface ReadinessCheck {
  readonly key: keyof ReadinessInput;
  readonly labelAr: string;
  readonly passed: boolean;
  /** A blocking check must pass before the restaurant can go ACTIVE. */
  readonly blocking: boolean;
}

const READINESS_LABELS_AR: Record<keyof ReadinessInput, string> = {
  applicationApproved: 'تمت الموافقة على طلب الانضمام',
  cityOrderingEnabled: 'الطلبات مفعّلة في المدينة',
  ownerActive: 'حساب المالك مفعّل',
  branchLocationValid: 'موقع الفرع صحيح',
  workingHoursConfigured: 'تم ضبط أوقات العمل',
  hasActiveMenuItem: 'يوجد صنف واحد على الأقل في المنيو',
  commissionConfigured: 'تم ضبط نسبة العمولة',
  settlementPolicyConfigured: 'تم ضبط دورة التسوية',
  deliveryConfigured: 'تم ضبط إعدادات التوصيل',
  hasActiveDriver: 'يوجد سائق مفعّل',
  orderAlertAcknowledged: 'تم اختبار تنبيه الطلبات',
  requiredDocumentsPresent: 'المستندات المطلوبة مكتملة',
};

/**
 * Which checks block activation. `cityOrderingEnabled` is deliberately
 * non-blocking: a restaurant is legitimately approved and fully set up in a city
 * that has not opened for ordering yet — that is the documented rollout
 * sequence (plan §124), and blocking it would make staged launches impossible.
 */
const NON_BLOCKING: ReadonlySet<keyof ReadinessInput> = new Set([
  'cityOrderingEnabled',
  'hasActiveDriver',
  'orderAlertAcknowledged',
]);

/**
 * A shelf is not a kitchen.
 *
 * The checklist was written for restaurants, where hours are a decision and
 * a pin is where a courier waits for food. A market or a cosmetics shop
 * created from Admin fell at two of those with no way to pass them from
 * the app: the hours now come with a default week when the shop is made
 * or activated, and the pin is asked for but no longer blocks — an order
 * to a shop without one is allowed and flagged, exactly as an address
 * without one is (see `checkServiceZone`). The labels change with it so
 * a grocer is not told to put a dish on the menu.
 */
export interface ReadinessOptions {
  readonly merchantType?: MerchantType;
}

const SHOP_LABELS_AR: Partial<Record<keyof ReadinessInput, string>> = {
  hasActiveMenuItem: 'يوجد منتج واحد على الأقل',
  workingHoursConfigured: 'أوقات العمل (تُضبط افتراضياً عند التفعيل وتُعدَّل من لوحة التحكم)',
  branchLocationValid: 'موقع المتجر مثبّت على الخريطة (يُستحسن)',
  hasActiveDriver: 'يوجد مندوب مفعّل',
};

const SHOP_NON_BLOCKING: ReadonlySet<keyof ReadinessInput> = new Set([
  ...NON_BLOCKING,
  'branchLocationValid',
  'workingHoursConfigured',
]);

export function isSelfServeMerchantType(merchantType: MerchantType | undefined): boolean {
  return merchantType === 'MARKET' || merchantType === 'COSMETICS';
}

export function evaluateReadiness(
  input: ReadinessInput,
  options: ReadinessOptions = {},
): {
  ready: boolean;
  checks: ReadinessCheck[];
  blockingFailures: ReadinessCheck[];
} {
  const shop = isSelfServeMerchantType(options.merchantType);
  const nonBlocking = shop ? SHOP_NON_BLOCKING : NON_BLOCKING;
  const checks: ReadinessCheck[] = (
    Object.keys(READINESS_LABELS_AR) as (keyof ReadinessInput)[]
  ).map((key) => ({
    key,
    labelAr: (shop && SHOP_LABELS_AR[key]) || READINESS_LABELS_AR[key],
    passed: input[key],
    blocking: !nonBlocking.has(key),
  }));

  const blockingFailures = checks.filter((c) => c.blocking && !c.passed);
  return { ready: blockingFailures.length === 0, checks, blockingFailures };
}
