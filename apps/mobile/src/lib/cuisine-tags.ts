import { cuisineLabelAr } from '@jibli/contracts';
import { containsArabic } from '@jibli/validation/arabic';

/**
 * A shop's tags as Arabic labels, with untranslated keys dropped.
 *
 * `cuisineLabelAr` falls back to the raw key when it has no Arabic label — so a
 * market seeded with the `grocery` tag printed «grocery» in the middle of an
 * Arabic card (CUST-20). The label for that tag lives in `@jibli/contracts`,
 * which this stream may not edit, so the fix is here: a label that is still
 * Latin after translation is an untranslated key, and it is hidden rather than
 * shown. Everything with Arabic in it is kept.
 */
export function arabicCuisineTags(tags: readonly string[], limit?: number): string[] {
  const labels = tags.map(cuisineLabelAr).filter((label) => containsArabic(label));
  return typeof limit === 'number' ? labels.slice(0, limit) : labels;
}
