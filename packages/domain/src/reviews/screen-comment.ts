/**
 * The first look at a review's comment, before anyone else reads it.
 *
 * Not a censor. A harsh opinion about the food — «الأكل بارد وسيئ» — is the
 * point of a review and passes untouched. What is held for a moderator is the
 * narrow set both stores name and a shop owner should not have to read:
 * slurs and sexual insults, and a phone number, an email or a link — personal
 * data or advertising that does not belong in a rating.
 *
 * Held, not rejected. The author is told their comment will appear after
 * review; a moderator decides in the queue, and a false positive costs a short
 * delay rather than a lost review. The word list is deliberately small and
 * exact-token: «كسر» must not trip on «كس».
 */

export type ScreenReason = 'PROFANITY' | 'CONTACT' | 'LINK';

export interface ScreenResult {
  readonly held: boolean;
  readonly reasons: readonly ScreenReason[];
}

/**
 * Insults and sexual terms, written as they are typed in Iraqi Arabic and in
 * English, compared after normalisation. Whole tokens only, with the common
 * clitics (ال، و، يا، ب) stripped.
 */
const BLOCKED_TOKENS: ReadonlySet<string> = new Set([
  // Arabic, normalised (ا for أإآ, ه for ة, ي for ى, no diacritics)
  'كس',
  'كسك',
  'كسمك',
  'طيز',
  'طيزك',
  'زب',
  'زبي',
  'شرموط',
  'شرموطه',
  'عاهر',
  'عاهره',
  'قحبه',
  'قحاب',
  'منيوك',
  'منيوكه',
  'خول',
  'لوطي',
  'كواد',
  'عرص',
  'معرص',
  'انعل',
  'نغل',
  // English
  'fuck',
  'fucking',
  'fucker',
  'shit',
  'bitch',
  'asshole',
  'cunt',
  'dick',
  'whore',
  'slut',
  'bastard',
]);

/** Arabic-Indic and Persian digits to ASCII, so a number cannot hide in them. */
function asciiDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** One spelling per word: no diacritics or tatweel, one alef, one teh marbuta. */
export function normaliseArabic(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      // «كسسسس» and «fuuuck» are the same word.
      .replace(/(.)\1{2,}/gu, '$1')
  );
}

const CLITICS = ['وال', 'بال', 'يا', 'ال', 'و', 'ب'];

function tokenVariants(token: string): string[] {
  const variants = [token];
  for (const clitic of CLITICS) {
    if (token.startsWith(clitic) && token.length - clitic.length >= 2) {
      variants.push(token.slice(clitic.length));
    }
  }
  return variants;
}

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|iq|io|me|info|co)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
/** Seven or more digits, allowing the spaces and dashes people type between them. */
const PHONE = /(\+?\d[\d\s-]{6,}\d)/;

export function screenComment(raw: string | null | undefined): ScreenResult {
  const text = (raw ?? '').trim();
  if (text === '') return { held: false, reasons: [] };

  const reasons: ScreenReason[] = [];
  const digits = asciiDigits(text);

  if (LINK.test(digits)) reasons.push('LINK');
  if (EMAIL.test(digits) || (PHONE.exec(digits)?.[1]?.replace(/\D/g, '').length ?? 0) >= 7) {
    reasons.push('CONTACT');
  }

  const tokens = normaliseArabic(digits)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (tokens.some((token) => tokenVariants(token).some((variant) => BLOCKED_TOKENS.has(variant)))) {
    reasons.push('PROFANITY');
  }

  return { held: reasons.length > 0, reasons };
}
