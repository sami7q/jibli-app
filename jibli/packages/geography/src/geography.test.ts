import { describe, expect, it } from 'vitest';
import { AppError } from '@jibli/contracts';
import {
  assertCityBelongsToGovernorate,
  assertCityCapability,
  cityHasCapability,
  effectiveCityCapabilities,
  selectableCities,
  selectableGovernorates,
  type CityNode,
  type GovernorateNode,
} from './effective-capability.js';
import {
  CITIES,
  citiesByGovernorate,
  GOVERNORATE_COUNT,
  GOVERNORATES,
  SOURCE_VERSION,
  validateDataset,
} from './iraq-dataset.js';

const governorate = (over: Partial<GovernorateNode> = {}): GovernorateNode => ({
  id: 'gov-baghdad',
  code: 'IQ-BG',
  nameAr: 'بغداد',
  isEnabled: true,
  customerSignupEnabled: true,
  restaurantOnboardingEnabled: true,
  orderingEnabled: true,
  ...over,
});

const city = (over: Partial<CityNode> = {}): CityNode => ({
  id: 'city-baghdad',
  governorateId: 'gov-baghdad',
  code: 'IQ-BG-BAGHDAD',
  nameAr: 'بغداد',
  isEnabled: true,
  customerSignupEnabled: true,
  restaurantOnboardingEnabled: true,
  orderingEnabled: true,
  ...over,
});

describe('effective capability — a child is never stronger than its parent (plan §8.6)', () => {
  it('grants when both levels allow it', () => {
    expect(cityHasCapability({ city: city(), governorate: governorate() }, 'ordering')).toBe(true);
  });

  it('denies when the governorate has the capability off, even if the city says true', () => {
    const resolved = { city: city({ orderingEnabled: true }), governorate: governorate({ orderingEnabled: false }) };
    expect(cityHasCapability(resolved, 'ordering')).toBe(false);
  });

  it('denies when the city has the capability off, even if the governorate says true', () => {
    const resolved = { city: city({ orderingEnabled: false }), governorate: governorate() };
    expect(cityHasCapability(resolved, 'ordering')).toBe(false);
  });

  it('treats isEnabled as a master switch on the governorate', () => {
    const resolved = { city: city(), governorate: governorate({ isEnabled: false }) };
    expect(cityHasCapability(resolved, 'ordering')).toBe(false);
    expect(cityHasCapability(resolved, 'customer_signup')).toBe(false);
    expect(cityHasCapability(resolved, 'restaurant_onboarding')).toBe(false);
  });

  it('treats isEnabled as a master switch on the city', () => {
    const resolved = { city: city({ isEnabled: false }), governorate: governorate() };
    expect(effectiveCityCapabilities(resolved)).toEqual({
      customer_signup: false,
      restaurant_onboarding: false,
      ordering: false,
    });
  });

  it('keeps the three capabilities independent (plan §8.5)', () => {
    // Recruiting restaurants before opening ordering is the documented rollout.
    const resolved = {
      city: city({ orderingEnabled: false, customerSignupEnabled: false }),
      governorate: governorate({ orderingEnabled: false, customerSignupEnabled: false }),
    };
    expect(effectiveCityCapabilities(resolved)).toEqual({
      customer_signup: false,
      restaurant_onboarding: true,
      ordering: false,
    });
  });

  it('refuses to evaluate a city against the wrong parent', () => {
    const resolved = { city: city({ governorateId: 'gov-basra' }), governorate: governorate() };
    expect(() => cityHasCapability(resolved, 'ordering')).toThrow(AppError);
    expect(() => cityHasCapability(resolved, 'ordering')).toThrow(
      expect.objectContaining({ code: 'CITY_GOVERNORATE_MISMATCH' }),
    );
  });
});

describe('assertCityCapability() — the server-side re-check behind a stale client', () => {
  it('passes when the city is genuinely open', () => {
    expect(() =>
      assertCityCapability({ city: city(), governorate: governorate() }, 'ordering'),
    ).not.toThrow();
  });

  it('reports ORDERING_NOT_AVAILABLE_IN_CITY when the city was disabled mid-flow', () => {
    const resolved = { city: city({ orderingEnabled: false }), governorate: governorate() };
    expect(() => assertCityCapability(resolved, 'ordering')).toThrow(
      expect.objectContaining({ code: 'ORDERING_NOT_AVAILABLE_IN_CITY' }),
    );
  });

  it('reports CITY_NOT_AVAILABLE for a disabled signup city (plan §11)', () => {
    const resolved = { city: city({ customerSignupEnabled: false }), governorate: governorate() };
    expect(() => assertCityCapability(resolved, 'customer_signup')).toThrow(
      expect.objectContaining({ code: 'CITY_NOT_AVAILABLE' }),
    );
  });

  it('blames the governorate when the governorate is what is switched off', () => {
    const resolved = { city: city(), governorate: governorate({ orderingEnabled: false }) };
    expect(() => assertCityCapability(resolved, 'ordering')).toThrow(
      expect.objectContaining({ code: 'GOVERNORATE_NOT_AVAILABLE' }),
    );
  });

  it('reports the onboarding-specific code for restaurants', () => {
    const resolved = {
      city: city({ restaurantOnboardingEnabled: false }),
      governorate: governorate(),
    };
    expect(() => assertCityCapability(resolved, 'restaurant_onboarding')).toThrow(
      expect.objectContaining({ code: 'RESTAURANT_ONBOARDING_NOT_AVAILABLE_IN_CITY' }),
    );
  });

  it('carries enough detail for support to act on', () => {
    const resolved = { city: city({ orderingEnabled: false }), governorate: governorate() };
    try {
      assertCityCapability(resolved, 'ordering');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(AppError.is(error)).toBe(true);
      if (AppError.is(error)) {
        expect(error.details).toMatchObject({ cityId: 'city-baghdad', capability: 'ordering' });
        expect(error.messageAr).toBe('الطلب غير متاح حالياً في هذه المدينة');
      }
    }
  });
});

describe('assertCityBelongsToGovernorate() — forged city IDs (plan §215)', () => {
  it('accepts a genuine pair', () => {
    expect(() => assertCityBelongsToGovernorate(city(), 'gov-baghdad')).not.toThrow();
  });

  it('rejects a city from another governorate', () => {
    expect(() => assertCityBelongsToGovernorate(city(), 'gov-basra')).toThrow(
      expect.objectContaining({ code: 'CITY_GOVERNORATE_MISMATCH' }),
    );
  });
});

describe('selectable lists never offer what the server would reject', () => {
  const baghdad = governorate();
  const basra = governorate({ id: 'gov-basra', code: 'IQ-BA', nameAr: 'البصرة', orderingEnabled: false });

  it('filters governorates by effective capability', () => {
    expect(selectableGovernorates([baghdad, basra], 'ordering').map((g) => g.id)).toEqual([
      'gov-baghdad',
    ]);
    expect(selectableGovernorates([baghdad, basra], 'customer_signup')).toHaveLength(2);
  });

  it('returns no cities at all when the parent governorate is closed', () => {
    const cities = [city({ id: 'c1', governorateId: 'gov-basra' })];
    expect(selectableCities(cities, basra, 'ordering')).toEqual([]);
  });

  it('filters out cities of other governorates', () => {
    const cities = [city({ id: 'c1' }), city({ id: 'c2', governorateId: 'gov-basra' })];
    expect(selectableCities(cities, baghdad, 'ordering').map((c) => c.id)).toEqual(['c1']);
  });

  it('filters out individually disabled cities', () => {
    const cities = [city({ id: 'c1' }), city({ id: 'c2', orderingEnabled: false })];
    expect(selectableCities(cities, baghdad, 'ordering').map((c) => c.id)).toEqual(['c1']);
  });
});

describe('Iraq master dataset (plan §8.1, §152)', () => {
  it('contains exactly 19 governorates for this source version', () => {
    expect(GOVERNORATE_COUNT).toBe(19);
    expect(SOURCE_VERSION).toMatch(/^\d{4}\.\d+$/);
  });

  it('includes Halabja, the 19th governorate', () => {
    const halabja = GOVERNORATES.find((g) => g.code === 'IQ-HA');
    expect(halabja).toBeDefined();
    expect(halabja?.nameAr).toBe('حلبجة');
  });

  it('stores canonical Arabic display names for every governorate', () => {
    for (const g of GOVERNORATES) {
      expect(g.nameAr.trim().length).toBeGreaterThan(1);
      expect(/[؀-ۿ]/.test(g.nameAr)).toBe(true);
    }
  });

  it('gives every city exactly one parent that exists', () => {
    const codes = new Set(GOVERNORATES.map((g) => g.code));
    for (const c of CITIES) {
      expect(codes.has(c.governorateCode)).toBe(true);
    }
  });

  it('has no duplicate canonical codes', () => {
    expect(new Set(GOVERNORATES.map((g) => g.code)).size).toBe(GOVERNORATES.length);
    expect(new Set(CITIES.map((c) => c.code)).size).toBe(CITIES.length);
  });

  it('gives every governorate at least one city', () => {
    const grouped = citiesByGovernorate();
    for (const g of GOVERNORATES) {
      expect(grouped.get(g.code)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('passes the CI dataset validation gate', () => {
    const result = validateDataset();
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('includes the launch cities named in the reference designs', () => {
    const cityCodes = new Set(CITIES.map((c) => c.code));
    expect(cityCodes.has('IQ-BG-BAGHDAD')).toBe(true);
    expect(cityCodes.has('IQ-BA-BASRA')).toBe(true);
    expect(cityCodes.has('IQ-AR-ERBIL')).toBe(true);
  });

  it('has unique sort orders so the Arabic picker is deterministic', () => {
    const orders = GOVERNORATES.map((g) => g.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
