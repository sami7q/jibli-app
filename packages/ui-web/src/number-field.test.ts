import { describe, expect, it } from 'vitest';
import { cleanNumberDraft, isNumberDraftValid, parseNumberDraft } from './number-field.js';

describe('a number field can be emptied', () => {
  it('lets the last digit be deleted instead of snapping back to 0', () => {
    // The bug: Number('') is 0, so a cleared field showed «0» again.
    expect(cleanNumberDraft('')).toBe('');
    expect(parseNumberDraft('')).toBe(0);
  });

  it('does not keep a leading zero in front of what is typed', () => {
    expect(cleanNumberDraft('05000')).toBe('5000');
    expect(cleanNumberDraft('0')).toBe('0');
  });

  it('reads Arabic-Indic and Persian digits', () => {
    expect(cleanNumberDraft('٥٠٠٠')).toBe('5000');
    expect(cleanNumberDraft('۱۲۰')).toBe('120');
  });

  it('drops grouping separators and letters', () => {
    expect(cleanNumberDraft('5,000')).toBe('5000');
    expect(cleanNumberDraft('٥٬٠٠٠')).toBe('5000');
    expect(cleanNumberDraft('12e3')).toBe('123');
  });

  it('does not silently strip «.» or «-» in integer mode (MERCH-9)', () => {
    // «2500.75» must not become «250075», nor «-500» become «500»: the
    // character is kept so the field can be flagged invalid instead.
    expect(cleanNumberDraft('2500.75')).toBe('2500.75');
    expect(cleanNumberDraft('2.5')).toBe('2.5');
    expect(cleanNumberDraft('-5')).toBe('-5');
    expect(cleanNumberDraft('-500')).toBe('-500');

    expect(isNumberDraftValid('2500.75')).toBe(false);
    expect(isNumberDraftValid('-5')).toBe(false);
    expect(isNumberDraftValid('2500')).toBe(true);
    expect(isNumberDraftValid('')).toBe(true);
  });

  it('keeps one decimal point only where decimals are allowed', () => {
    expect(cleanNumberDraft('2.5', true)).toBe('2.5');
    expect(cleanNumberDraft('2.5.1', true)).toBe('2.51');
    expect(cleanNumberDraft('٢٫٥', true)).toBe('2.5');
    expect(cleanNumberDraft('0.5', true)).toBe('0.5');
    expect(isNumberDraftValid('2.5', true)).toBe(true);
    expect(parseNumberDraft('.')).toBe(0);
    expect(parseNumberDraft('2.')).toBe(2);
  });
});
