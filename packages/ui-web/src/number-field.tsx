'use client';

import { useEffect, useState, type InputHTMLAttributes } from 'react';

/**
 * A number input that can be emptied.
 *
 * Every numeric field in both portals was `<input type="number">` wired as
 * `onChange={(e) => set(Number(e.target.value))}`. `Number('')` is `0`, so
 * the moment a field was cleared it snapped back to «0»: the zero could never
 * be deleted, typing 5000 after it produced «05000», and a price field opened
 * already holding a value nobody entered. Every partner adding a dish met it.
 *
 * The fix is to keep what is being typed (the draft) apart from the number it
 * means. The field shows the draft, exactly as typed; the form receives the
 * number. Empty means 0 to the form and nothing on screen.
 *
 * `type="text"` with `inputMode` rather than `type="number"`: a number input
 * silently reports `''` for anything it cannot parse (so Arabic-Indic digits
 * read as empty), changes value under a scrolling mouse wheel, and accepts
 * `e`. The numeric keypad on phones comes from `inputMode` either way.
 */

const EASTERN_DIGITS = /[٠-٩۰-۹]/g;

/** ٠١٢٣ and ۰۱۲۳ to 0123 — what an Arabic keyboard types in a number field. */
function toAsciiDigits(input: string): string {
  return input.replace(EASTERN_DIGITS, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Clean a typed draft: ASCII digits only, one decimal point when allowed, no
 * grouping separators and no leading zeros. Returns what the field should
 * show — `parseNumberDraft` turns that into the number.
 */
export function cleanNumberDraft(input: string, decimal = false): string {
  let text = toAsciiDigits(input)
    // Arabic decimal separator (٫) is a point; grouping (٬ and ,) is noise.
    .replace(/٫/g, '.')
    .replace(/[٬,\s]/g, '');

  text = text.replace(decimal ? /[^\d.]/g : /\D/g, '');
  if (decimal) {
    const point = text.indexOf('.');
    if (point !== -1) text = text.slice(0, point + 1) + text.slice(point + 1).replace(/\./g, '');
  }

  // «007» is 7. A lone «0», or «0.5», stays as typed.
  return text.replace(/^0+(?=\d)/, '');
}

/** The number a draft means. Empty, or just «.», means 0. */
export function parseNumberDraft(draft: string): number {
  const value = Number(draft);
  return draft === '' || draft === '.' || !Number.isFinite(value) ? 0 : value;
}

/** What to show for a number that arrived from outside. 0 shows as empty. */
function draftFor(value: number): string {
  return value === 0 || !Number.isFinite(value) ? '' : String(value);
}

export interface NumberFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'inputMode'
> {
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** Allow a fractional part. Off by default: IQD has no minor unit. */
  readonly decimal?: boolean;
}

export function NumberField({
  value,
  onChange,
  decimal = false,
  placeholder = '0',
  ...rest
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => draftFor(value));

  /*
   * Follow the form when it changes the number itself — a reset, a loaded
   * record — but never overwrite what is being typed with the same number
   * written differently («5.» while it still means 5).
   */
  useEffect(() => {
    setDraft((current) => (parseNumberDraft(current) === value ? current : draftFor(value)));
  }, [value]);

  return (
    <input
      {...rest}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      dir="ltr"
      autoComplete="off"
      placeholder={placeholder}
      value={draft}
      onChange={(event) => {
        const next = cleanNumberDraft(event.target.value, decimal);
        setDraft(next);
        onChange(parseNumberDraft(next));
      }}
    />
  );
}
