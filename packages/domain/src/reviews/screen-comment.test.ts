import { describe, expect, it } from 'vitest';
import { normaliseArabic, screenComment } from './screen-comment';

describe('screenComment', () => {
  it('passes an empty comment and an honest bad review', () => {
    expect(screenComment('')).toEqual({ held: false, reasons: [] });
    expect(screenComment(null)).toEqual({ held: false, reasons: [] });
    expect(screenComment('الأكل وصل بارد والخدمة سيئة جداً، ما أنصح بيه')).toEqual({
      held: false,
      reasons: [],
    });
  });

  it('does not trip on words that merely contain a blocked one', () => {
    expect(screenComment('الكيس انكسر والعصير كسر الكيس').held).toBe(false);
    expect(screenComment('Scunthorpe dickens classic').held).toBe(false);
  });

  it('holds insults in Arabic, with clitics, diacritics and stretched letters', () => {
    expect(screenComment('يا كوّاد').reasons).toContain('PROFANITY');
    expect(screenComment('والشرموطة').reasons).toContain('PROFANITY');
    expect(screenComment('عرررص').reasons).toContain('PROFANITY');
  });

  it('holds English profanity regardless of case or stretching', () => {
    expect(screenComment('This is SHIT').reasons).toContain('PROFANITY');
    expect(screenComment('fuuuuck').reasons).toContain('PROFANITY');
  });

  it('holds phone numbers, in Latin or Arabic digits, and emails', () => {
    expect(screenComment('اتصل بي 0770 123 4567').reasons).toContain('CONTACT');
    expect(screenComment('رقمي ٠٧٧٠١٢٣٤٥٦٧').reasons).toContain('CONTACT');
    expect(screenComment('me@example.com').reasons).toContain('CONTACT');
  });

  it('does not treat a price or an order number as a phone', () => {
    expect(screenComment('دفعت 25000 دينار للطلب 1234').held).toBe(false);
  });

  it('holds links', () => {
    expect(screenComment('شوف www.example.com').reasons).toContain('LINK');
    expect(screenComment('https://t.me/x').reasons).toContain('LINK');
    expect(screenComment('order from cheapfood.iq instead').reasons).toContain('LINK');
  });
});

describe('normaliseArabic', () => {
  it('unifies the alef forms, teh marbuta and alef maqsura, and drops diacritics', () => {
    expect(normaliseArabic('أحمد إياد آمنة مدرسة مستشفى مَطْعَم')).toBe(
      'احمد اياد امنه مدرسه مستشفي مطعم',
    );
    // Three or more of the same letter collapse to one.
    expect(normaliseArabic('حلووووو')).toBe('حلو');
  });
});
