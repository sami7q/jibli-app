import { describe, expect, it } from 'vitest';
import { MERCHANT_TYPES, categoriesFor } from '@jibli/contracts';
import { palette } from '@jibli/design-tokens';
import { SECTIONS, SECTION_ORDER, sectionOf } from './sections';

/**
 * The section table.
 *
 * Every screen that looks different per section reads it, so what is pinned
 * here is that the three sections are complete, distinct, and that the
 * cosmetics one is really drawn in its own colours and words rather than
 * inheriting the market's.
 */

describe('the sections the chooser offers', () => {
  it('offers every merchant type, once, in a fixed order', () => {
    expect([...SECTION_ORDER].sort()).toEqual([...MERCHANT_TYPES].sort());
    expect(SECTION_ORDER).toEqual(['RESTAURANT', 'MARKET', 'COSMETICS']);
  });

  it('describes each section as itself', () => {
    for (const type of MERCHANT_TYPES) expect(SECTIONS[type].type).toBe(type);
  });

  it('gives no two sections the same name, glyph or ramp', () => {
    for (const field of ['label', 'icon', 'shopNoun', 'searchPlaceholder'] as const) {
      const values = SECTION_ORDER.map((type) => SECTIONS[type][field]);
      expect(new Set(values).size, field).toBe(values.length);
    }
    const ramps = SECTION_ORDER.map((type) => SECTIONS[type].ramp[500]);
    expect(new Set(ramps).size).toBe(ramps.length);
  });
});

describe('Jibli Cosmetics', () => {
  const cosmetics = SECTIONS.COSMETICS;

  it('is drawn in the rose ramp, not the market green', () => {
    expect(cosmetics.ramp).toBe(palette.rose);
    expect(cosmetics.gradient[0]).toBe(palette.rose[400]);
    expect(cosmetics.header).toContain(palette.rose[600]);
  });

  it('speaks about cosmetics shops, not markets', () => {
    expect(cosmetics.label).toBe('جيبلي كوزمتك');
    expect(cosmetics.shopsNounDefinite).toBe('متاجر التجميل');
    expect(cosmetics.areaCaption('بغداد')).toContain('بغداد');
    for (const text of [cosmetics.nearbyTitle, cosmetics.searchPlaceholder, cosmetics.caption]) {
      expect(text).not.toMatch(/ماركت|مطعم|وجبة/);
    }
  });

  it('has aisles to filter by', () => {
    expect(categoriesFor('COSMETICS').length).toBeGreaterThan(0);
  });
});

describe('sectionOf()', () => {
  it('falls back to food before anything is chosen', () => {
    expect(sectionOf(null).type).toBe('RESTAURANT');
    expect(sectionOf(undefined).type).toBe('RESTAURANT');
  });

  it('returns the chosen section', () => {
    expect(sectionOf('COSMETICS').type).toBe('COSMETICS');
    expect(sectionOf('MARKET').type).toBe('MARKET');
  });
});
