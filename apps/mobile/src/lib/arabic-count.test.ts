import { describe, expect, it } from 'vitest';
import { MINUTES, NEW_ORDERS, PIECES, countAr } from './arabic-count';

describe('countAr', () => {
  it('has words of its own for one and two', () => {
    expect(countAr(1, MINUTES)).toBe('دقيقة');
    expect(countAr(2, MINUTES)).toBe('دقيقتين');
    expect(countAr(2, PIECES)).toBe('قطعتان');
    expect(countAr(2, NEW_ORDERS)).toBe('طلبان جديدان');
  });

  it('takes the plural from three to ten', () => {
    expect(countAr(3, PIECES)).toBe('3 قطع');
    expect(countAr(10, MINUTES)).toBe('10 دقائق');
    expect(countAr(5, NEW_ORDERS)).toBe('5 طلبات جديدة');
  });

  it('goes back to the singular from eleven', () => {
    expect(countAr(11, MINUTES)).toBe('11 دقيقة');
    expect(countAr(13, MINUTES)).toBe('13 دقيقة');
    expect(countAr(45, MINUTES)).toBe('45 دقيقة');
    expect(countAr(12, NEW_ORDERS)).toBe('12 طلباً جديداً');
  });

  it('reads the last two digits past a hundred', () => {
    expect(countAr(103, MINUTES)).toBe('103 دقائق');
    expect(countAr(111, MINUTES)).toBe('111 دقيقة');
  });
});
