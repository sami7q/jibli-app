import { AppError, ERROR_CODES, type GeographyCapability } from '@jibli/contracts';

/**
 * Effective geography capability (plan §8.6).
 *
 *   effective_city_ordering = governorate.ordering_enabled AND city.ordering_enabled
 *
 * "This calculation belongs in one Geography domain service and is reused
 * everywhere." A city row saying `ordering_enabled = true` under a disabled
 * governorate is NOT orderable, and no caller is trusted to remember that.
 */

/** The capability flags carried by both governorate and city rows. */
export interface CapabilityFlags {
  readonly isEnabled: boolean;
  readonly customerSignupEnabled: boolean;
  readonly restaurantOnboardingEnabled: boolean;
  readonly orderingEnabled: boolean;
}

export interface GovernorateNode extends CapabilityFlags {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
}

export interface CityNode extends CapabilityFlags {
  readonly id: string;
  readonly governorateId: string;
  readonly code: string;
  readonly nameAr: string;
}

/** A city resolved together with its parent — the only shape capability checks accept. */
export interface ResolvedCity {
  readonly city: CityNode;
  readonly governorate: GovernorateNode;
}

const CAPABILITY_FIELD: Record<GeographyCapability, keyof CapabilityFlags> = {
  customer_signup: 'customerSignupEnabled',
  restaurant_onboarding: 'restaurantOnboardingEnabled',
  ordering: 'orderingEnabled',
};

/**
 * `isEnabled` is the master switch. A disabled row has no capabilities at all,
 * regardless of its individual flags.
 */
function hasCapability(flags: CapabilityFlags, capability: GeographyCapability): boolean {
  if (!flags.isEnabled) return false;
  return flags[CAPABILITY_FIELD[capability]] === true;
}

/** Governorate-level effective capability. */
export function governorateHasCapability(
  governorate: GovernorateNode,
  capability: GeographyCapability,
): boolean {
  return hasCapability(governorate, capability);
}

/**
 * City-level effective capability. A child is never stronger than its parent.
 */
export function cityHasCapability(
  resolved: ResolvedCity,
  capability: GeographyCapability,
): boolean {
  if (resolved.city.governorateId !== resolved.governorate.id) {
    // A mismatched pair means the caller resolved the wrong parent. Refusing is
    // the only safe answer: silently returning false would hide a data bug.
    throw new AppError(ERROR_CODES.CITY_GOVERNORATE_MISMATCH, {
      details: {
        cityId: resolved.city.id,
        cityGovernorateId: resolved.city.governorateId,
        providedGovernorateId: resolved.governorate.id,
      },
    });
  }
  return hasCapability(resolved.governorate, capability) && hasCapability(resolved.city, capability);
}

/** All three effective capabilities at once, for admin coverage views. */
export function effectiveCityCapabilities(resolved: ResolvedCity): Record<GeographyCapability, boolean> {
  return {
    customer_signup: cityHasCapability(resolved, 'customer_signup'),
    restaurant_onboarding: cityHasCapability(resolved, 'restaurant_onboarding'),
    ordering: cityHasCapability(resolved, 'ordering'),
  };
}

export function effectiveGovernorateCapabilities(
  governorate: GovernorateNode,
): Record<GeographyCapability, boolean> {
  return {
    customer_signup: governorateHasCapability(governorate, 'customer_signup'),
    restaurant_onboarding: governorateHasCapability(governorate, 'restaurant_onboarding'),
    ordering: governorateHasCapability(governorate, 'ordering'),
  };
}

/** Error code raised when a capability check fails, per capability. */
const CAPABILITY_ERROR: Record<GeographyCapability, (typeof ERROR_CODES)[keyof typeof ERROR_CODES]> =
  {
    customer_signup: ERROR_CODES.CITY_NOT_AVAILABLE,
    restaurant_onboarding: ERROR_CODES.RESTAURANT_ONBOARDING_NOT_AVAILABLE_IN_CITY,
    ordering: ERROR_CODES.ORDERING_NOT_AVAILABLE_IN_CITY,
  };

/**
 * Assert a city currently supports a capability.
 *
 * This is the server-side re-check that defeats a stale client (plan §11): the
 * city was in the dropdown five seconds ago, an Admin disabled it since, and the
 * submit must fail with a code the app knows how to recover from.
 */
export function assertCityCapability(
  resolved: ResolvedCity,
  capability: GeographyCapability,
): void {
  // Surface the parent as the cause when the parent is what is switched off:
  // support needs to know whether to re-enable a city or a whole governorate.
  if (!governorateHasCapability(resolved.governorate, capability)) {
    throw new AppError(ERROR_CODES.GOVERNORATE_NOT_AVAILABLE, {
      details: {
        capability,
        governorateId: resolved.governorate.id,
        governorateNameAr: resolved.governorate.nameAr,
        cityId: resolved.city.id,
      },
    });
  }
  if (!cityHasCapability(resolved, capability)) {
    throw new AppError(CAPABILITY_ERROR[capability], {
      details: {
        capability,
        cityId: resolved.city.id,
        cityNameAr: resolved.city.nameAr,
        governorateId: resolved.governorate.id,
      },
    });
  }
}

/** Assert the city genuinely belongs to the governorate the caller claimed. */
export function assertCityBelongsToGovernorate(city: CityNode, governorateId: string): void {
  if (city.governorateId !== governorateId) {
    throw new AppError(ERROR_CODES.CITY_GOVERNORATE_MISMATCH, {
      details: { cityId: city.id, expectedGovernorateId: governorateId },
    });
  }
}

/**
 * Filter a city list down to what a client may select. Public selectors must
 * never show a city the server would then reject.
 */
export function selectableCities(
  cities: readonly CityNode[],
  governorate: GovernorateNode,
  capability: GeographyCapability,
): CityNode[] {
  if (!governorateHasCapability(governorate, capability)) return [];
  return cities.filter(
    (city) => city.governorateId === governorate.id && hasCapability(city, capability),
  );
}

export function selectableGovernorates(
  governorates: readonly GovernorateNode[],
  capability: GeographyCapability,
): GovernorateNode[] {
  return governorates.filter((g) => governorateHasCapability(g, capability));
}
