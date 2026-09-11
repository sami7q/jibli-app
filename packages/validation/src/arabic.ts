/**
 * Arabic text and numeral normalization.
 *
 * Plan §2: "Arabic-Indic digits entered into phone and numeric fields are
 * normalized before server validation." A customer typing ٠٧٧١ on an Arabic
 * keyboard must reach the same E.164 value as one typing 0771.
 *
 * Every pattern below uses explicit \u escapes: these classes are built from
 * invisible characters, and a literal copy of them is unreviewable in a diff.
 */

/** Eastern Arabic-Indic digits ٠١٢٣٤٥٦٧٨٩ (U+0660–U+0669). */
const ARABIC_INDIC_ZERO = 0x0660;
/** Extended (Persian/Urdu) Arabic-Indic digits ۰۱۲۳۴۵۶۷۸۹ (U+06F0–U+06F9). */
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/**
 * Convert Arabic-Indic and extended Arabic-Indic digits to ASCII 0-9.
 * Non-digit characters are preserved untouched.
 */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    } else {
      out += char;
    }
  }
  return out;
}

/** U+0640 ARABIC TATWEEL — decorative elongation that carries no meaning. */
const TATWEEL = new RegExp('\u0640', 'g');

/** Harakat, shadda, sukun, superscript alef and Quranic annotation marks. */
const DIACRITICS = new RegExp('[\u064B-\u0652\u0656-\u065F\u0670\u06D6-\u06ED]', 'g');

/** Zero-width joiners/non-joiners, bidi overrides and the BOM. */
const INVISIBLE = new RegExp('[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]', 'g');

/** C0/C1 control characters that must never reach a name, note or address field. */
// Matching control characters is the entire point: they are exactly what must
// be stripped before text is stored or rendered, so the rule warning about
// them here is reporting the intended behaviour.
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\u0000-\u001F\u007F-\u009F]', 'g');

/** Alef variants أ إ آ ٱ all fold to bare ا for comparison purposes. */
const ALEF_VARIANTS = new RegExp('[\u0622\u0623\u0625\u0671]', 'g');

/**
 * Normalize Arabic text for *search and comparison only*.
 *
 * Folding alef variants, teh marbuta (ة→ه) and alef maksura (ى→ي) is what makes
 * "مطعم البيت العراقى" match "مطعم البيت العراقي". Never store the result as a
 * display name: it destroys correct spelling.
 */
export function normalizeArabicForSearch(input: string): string {
  return normalizeDigits(input)
    .replace(INVISIBLE, '')
    .replace(TATWEEL, '')
    .replace(DIACRITICS, '')
    .replace(ALEF_VARIANTS, 'ا')
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ؤ/g, 'و') // ؤ → و
    .replace(/ئ/g, 'ي') // ئ → ي
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clean user-entered display text: strip control characters and invisible
 * formatting, collapse whitespace, trim. Preserves Arabic spelling exactly.
 */
export function sanitizeDisplayText(input: string): string {
  return input.replace(CONTROL, '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** True when the string contains at least one Arabic-script character. */
export function containsArabic(input: string): boolean {
  return new RegExp('[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]').test(input);
}

/**
 * Guard against CSV/spreadsheet formula injection (plan §74, §166).
 * A value beginning with = + - @ tab or CR is coerced to text by a leading quote.
 */
export function escapeCsvValue(value: string): string {
  const cleaned = value.replace(CONTROL, '');
  if (/^[=+\-@]/.test(cleaned)) {
    return `'${cleaned}`;
  }
  return cleaned;
}
