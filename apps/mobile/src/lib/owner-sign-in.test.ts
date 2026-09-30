import { describe, expect, it } from 'vitest';
import type { OwnerShop } from './api';
import { judgeShopSignIn } from './owner-sign-in';

/**
 * The decision a shop's sign-in turns on.
 *
 * Three promises: an account with a market or a cosmetics shop opens it, an
 * account with none is told so, and an account whose shops are all
 * restaurants is told *which* shop and *where* it is managed — because the
 * commonest way to be in that state is a market filed as a restaurant by
 * mistake, and the message is the only place the fix is named.
 */

const shop = (over: Partial<OwnerShop> = {}): OwnerShop => ({
  id: 'shop-1',
  display_name: 'ماركت الخير',
  partner_code: '1234',
  merchant_type: 'MARKET',
  operational_status: 'ACTIVE',
  roles: ['OWNER'],
  permissions: ['menu.write', 'order.read'],
  ...over,
});

describe('judgeShopSignIn', () => {
  it('opens a market', () => {
    const verdict = judgeShopSignIn([shop()]);
    expect(verdict.kind).toBe('open');
    if (verdict.kind === 'open') expect(verdict.shop.id).toBe('shop-1');
  });

  it('opens a cosmetics shop', () => {
    expect(judgeShopSignIn([shop({ merchant_type: 'COSMETICS' })]).kind).toBe('open');
  });

  /*
   * The order of the list is the database's, not the owner's. An account that
   * manages a restaurant and a market must open the market, whichever comes
   * first — the restaurant is not a reason to refuse.
   */
  it('opens the market on an account that also holds a restaurant', () => {
    const verdict = judgeShopSignIn([
      shop({ id: 'r', display_name: 'مطعم البيت', merchant_type: 'RESTAURANT' }),
      shop({ id: 'm' }),
    ]);
    expect(verdict).toMatchObject({ kind: 'open', shop: { id: 'm' } });
  });

  it('refuses an account with no shop, and says so', () => {
    const verdict = judgeShopSignIn([]);
    expect(verdict.kind).toBe('refused');
    if (verdict.kind === 'refused') expect(verdict.message).toContain('لا يتبع أي متجر');
  });

  it('names the restaurant and where it is managed when that is all the account holds', () => {
    const verdict = judgeShopSignIn([
      shop({ display_name: 'مطعم البيت', merchant_type: 'RESTAURANT' }),
    ]);
    expect(verdict.kind).toBe('refused');
    if (verdict.kind !== 'refused') return;
    expect(verdict.message).toContain('«مطعم البيت»');
    expect(verdict.message).toContain('لوحة التحكم');
    // The way out of the mistaken case, named rather than left to support.
    expect(verdict.message).toContain('نوع الشريك');
  });

  it('lists every restaurant when there are several', () => {
    const verdict = judgeShopSignIn([
      shop({ id: 'a', display_name: 'مطعم البيت', merchant_type: 'RESTAURANT' }),
      shop({ id: 'b', display_name: 'مطعم النخيل', merchant_type: 'RESTAURANT' }),
    ]);
    if (verdict.kind !== 'refused') throw new Error('expected a refusal');
    expect(verdict.message).toContain('«مطعم البيت»');
    expect(verdict.message).toContain('«مطعم النخيل»');
    expect(verdict.message).toContain('مسجّلة');
  });
});
