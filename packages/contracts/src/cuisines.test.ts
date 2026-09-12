import { describe, expect, it } from 'vitest';
import { CUISINES, CUISINE_KEYS, cuisineByKey, cuisineLabelAr, isKnownCuisine } from './cuisines.js';

/**
 * The keys in this list are written into `restaurants.cuisine_tags` and will be
 * read back by the customer app's discovery filters. Renaming one silently
 * orphans every restaurant already tagged with it, so the properties worth
 * pinning are about stability, not about the contents of the list.
 */

describe('CUISINES', () => {
  it('has no duplicate keys', () => {
    // A duplicate would make `cuisineByKey` return whichever came last, and the
    // picker would show the category twice.
    expect(new Set(CUISINE_KEYS).size).toBe(CUISINES.length);
  });

  it('has no duplicate labels', () => {
    // Two keys with the same Arabic name are indistinguishable to the person
    // choosing one, and produce a split category nobody intended.
    const labels = CUISINES.map((cuisine) => cuisine.labelAr);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('uses keys that are safe in a URL and a query string', () => {
    /*
     * These end up in discovery links and filter parameters. Restricting them
     * to lowercase ASCII and underscore now costs nothing; discovering later
     * that a key needs escaping costs a migration.
     */
    for (const key of CUISINE_KEYS) {
      expect(key, key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('gives every category an Arabic label and an emoji', () => {
    for (const cuisine of CUISINES) {
      expect(cuisine.labelAr.trim(), cuisine.key).not.toBe('');
      expect(cuisine.emoji.trim(), cuisine.key).not.toBe('');
    }
  });

  it('covers the categories an Iraqi delivery platform cannot open without', () => {
    // Not a test of taste — a guard against someone trimming the list to the
    // point where common restaurants have nowhere to go.
    for (const key of ['iraqi', 'grills', 'chicken', 'fast_food', 'desserts', 'coffee']) {
      expect(isKnownCuisine(key), key).toBe(true);
    }
  });
});

describe('cuisineLabelAr()', () => {
  it('translates a known key', () => {
    expect(cuisineLabelAr('desserts')).toBe('حلويات');
  });

  it('shows an unknown tag rather than hiding it', () => {
    /*
     * Restaurants created before this list existed carry free text. Falling back
     * to an empty string would make those rows look untagged; showing the raw
     * value is what tells an operator there is something to tidy.
     */
    expect(cuisineLabelAr('مطعم شعبي')).toBe('مطعم شعبي');
  });
});

describe('cuisineByKey()', () => {
  it('returns undefined for a key that is not in the list', () => {
    expect(cuisineByKey('sushi_and_tacos')).toBeUndefined();
  });
});
