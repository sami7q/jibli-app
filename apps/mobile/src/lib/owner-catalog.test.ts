import { describe, expect, it } from 'vitest';
import {
  describeAddress,
  normalizeCategoryName,
  orderArea,
  suggestedCategories,
  summarizeNewOrder,
} from './owner-catalog';

/**
 * The sentences a shop owner acts on, and the rule that keeps a market from
 * being offered an aisle it already has.
 */

describe('suggestedCategories', () => {
  it('offers a market its aisles and a cosmetics shop its own', () => {
    const market = suggestedCategories('MARKET', []).map((aisle) => aisle.labelAr);
    const cosmetics = suggestedCategories('COSMETICS', []).map((aisle) => aisle.labelAr);
    expect(market).toContain('ألبان وأجبان');
    expect(cosmetics).toContain('مكياج');
    expect(market).not.toContain('مكياج');
  });

  it('offers nothing to a restaurant', () => {
    expect(suggestedCategories('RESTAURANT', [])).toEqual([]);
  });

  it('drops an aisle the shop already has, however it was spelled', () => {
    const left = suggestedCategories('MARKET', ['البان و اجبان', 'مخبوزات ']).map(
      (aisle) => aisle.labelAr,
    );
    expect(left).not.toContain('ألبان وأجبان');
    expect(left).not.toContain('مخبوزات');
    expect(left).toContain('خضار وفواكه');
  });
});

describe('normalizeCategoryName', () => {
  it('treats hamza, taa marbuta and the spaces around و as spelling', () => {
    expect(normalizeCategoryName('أجبانة')).toBe(normalizeCategoryName('اجبانه'));
    expect(normalizeCategoryName('خضار و فواكه')).toBe(normalizeCategoryName('خضار وفواكه'));
    expect(normalizeCategoryName('  عطور  ')).toBe('عطور');
  });

  it('keeps the article, because «ألبان» starts with the same letters', () => {
    expect(normalizeCategoryName('ألبان')).toBe('البان');
  });
});

describe('describeAddress and orderArea', () => {
  const address = { cityNameAr: 'بغداد', districtText: 'الكرادة', street: 'شارع 62', landmark: '' };

  it('joins the parts that exist, in the order a courier reads them', () => {
    expect(describeAddress(address)).toBe('بغداد — الكرادة — شارع 62');
  });

  it('is null with nothing to say', () => {
    expect(describeAddress({})).toBeNull();
  });

  it('names the district, and the city only without one', () => {
    expect(orderArea(address)).toBe('الكرادة');
    expect(orderArea({ cityNameAr: 'بغداد' })).toBe('بغداد');
    expect(orderArea({})).toBeNull();
  });
});

describe('summarizeNewOrder', () => {
  const order = {
    customer_name: 'أحمد علي الجبوري',
    customer_total_iqd: 24_500,
    delivery_address: { cityNameAr: 'بغداد', districtText: 'الكرادة' },
    items: [
      { id: '1', name_ar: 'حليب', quantity: 2, line_total_iqd: 6000, notes: null, modifiers: [] },
      { id: '2', name_ar: 'خبز', quantity: 1, line_total_iqd: 1500, notes: null, modifiers: [] },
    ],
  };

  it('names the customer by first name only', () => {
    expect(summarizeNewOrder(order).title).toBe('طلب جديد من أحمد');
  });

  it('says what, how much and where', () => {
    const summary = summarizeNewOrder(order);
    expect(summary.body).toContain('2× حليب');
    expect(summary.body).toContain('خبز');
    expect(summary.body).toContain('24,500');
    expect(summary.body).toContain('الكرادة');
    expect(summary.line).toBe(`أحمد · 3 أصناف · ${summary.body.split(' · ')[1]} · الكرادة`);
  });

  it('counts past the third item instead of listing it', () => {
    const many = {
      ...order,
      items: ['أ', 'ب', 'ج', 'د', 'هـ'].map((name, index) => ({
        id: String(index),
        name_ar: name,
        quantity: 1,
        line_total_iqd: 1000,
        notes: null,
        modifiers: [],
      })),
    };
    expect(summarizeNewOrder(many).body).toContain('أ، ب، ج و2 أخرى');
  });

  it('has a name for a customer with none', () => {
    expect(summarizeNewOrder({ ...order, customer_name: '' }).title).toBe('طلب جديد من زبون');
  });
});
