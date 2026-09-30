import { sanitizeDisplayText } from './arabic.js';

/**
 * A person's display name, checked without a schema library.
 *
 * The same rule `fullNameSchema` applies — it is built on this — expressed as
 * a plain function so the mobile app can ask it without pulling `zod` into
 * the phone's bundle for one field. Identity in Jibli is a phone number and a
 * PIN; the name is what a courier says at the door, so the only things
 * refused are the ones that cannot be said: too short, too long, or made of
 * symbols.
 */
export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 80;

/** Digits and the punctuation a name never carries. */
const FORBIDDEN = /[\d<>{}[\]\\/|@#$%^*_=+~`]/u;

export type FullNameCheck =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string };

export function checkFullName(input: string): FullNameCheck {
  const value = sanitizeDisplayText(input);
  if (value.length < FULL_NAME_MIN) return { ok: false, message: 'الاسم قصير جداً' };
  if (value.length > FULL_NAME_MAX) return { ok: false, message: 'الاسم طويل جداً' };
  if (FORBIDDEN.test(value)) return { ok: false, message: 'الاسم يحتوي على رموز غير مسموحة' };
  return { ok: true, value };
}
