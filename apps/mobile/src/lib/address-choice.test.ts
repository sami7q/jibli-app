import { describe, expect, it } from 'vitest';
import { resolvePreferred } from './address-choice';

/**
 * Where the order goes.
 *
 * Every one of these is a delivery arriving at the wrong house if the order is
 * wrong, which is why the fallbacks are tested and not just written.
 */
const baghdad = { id: 'a-baghdad', is_default: true };
const haditha = { id: 'a-haditha', is_default: false };

describe('choosing the address an order goes to', () => {
  it('honours what this phone picked, over the account default', () => {
    // Somebody at their parents' house for the evening. The server still says
    // home, and they still want it delivered here.
    expect(resolvePreferred([baghdad, haditha], 'a-haditha')).toBe(haditha);
  });

  it('falls back to the account default when nothing was picked', () => {
    // A fresh install, or a second phone: no local preference, and the answer
    // is the one that follows the account.
    expect(resolvePreferred([baghdad, haditha], null)).toBe(baghdad);
  });

  it('falls through a preference pointing at a deleted address', () => {
    /*
     * The failure this exists to prevent. The preference is local and the
     * address is not — deleting it on another device, or from the list two
     * seconds ago, leaves an id behind that matches nothing. Returning null
     * there would empty checkout of an address the customer plainly has.
     */
    expect(resolvePreferred([baghdad, haditha], 'a-deleted')).toBe(baghdad);
  });

  it('takes whatever exists when none is marked default', () => {
    expect(resolvePreferred([haditha], null)).toBe(haditha);
  });

  it('answers null only when there is genuinely nothing', () => {
    expect(resolvePreferred([], 'a-haditha')).toBeNull();
    expect(resolvePreferred([], null)).toBeNull();
  });
});
