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
   * An account holding several shops opens the first; the others are one tap
   * away on the shop switcher. A restaurant is no longer a reason to skip one.
   */
  it('opens the first shop on an account that holds several', () => {
    const verdict = judgeShopSignIn([
      shop({ id: 'r', display_name: 'مطعم البيت', merchant_type: 'RESTAURANT' }),
      shop({ id: 'm' }),
    ]);
    expect(verdict).toMatchObject({ kind: 'open', shop: { id: 'r' } });
  });

  it('refuses an account with no shop, and says so', () => {
    const verdict = judgeShopSignIn([]);
    expect(verdict.kind).toBe('refused');
    if (verdict.kind === 'refused') expect(verdict.message).toContain('لا يتبع أي متجر');
  });

  it('opens a restaurant', () => {
    const verdict = judgeShopSignIn([
      shop({ id: 'r', display_name: 'مطعم البيت', merchant_type: 'RESTAURANT' }),
    ]);
    expect(verdict).toMatchObject({ kind: 'open', shop: { id: 'r' } });
  });
});
