/**
 * Where to go once signed in, when signing in was only the first step.
 *
 * «سجّل متجرك» on the welcome screen cannot open the application form
 * directly: the form files the application as the signed-in account, and a
 * signed-out visitor is sent back to the welcome screen by the router's gate
 * before the form can even ask. So the visitor signs in first — and without
 * this, every sign-in screen ends in `router.replace('/(tabs)')`, dropping them
 * on the customer home with no trace of what they came to do. That is the
 * "it just brings me back" the feature exists to end.
 *
 * Memory only: a restart forgets it, which is the
 * right lifetime for "I was in the middle of this". It is read by every screen
 * that finishes a sign-in (and by the gate, so the two can never disagree), and
 * cleared by the screen it points at once that screen is open — never by the
 * readers, so no ordering between them can lose it.
 */

let destination: string | null = null;

/** Remember where to continue once the sign-in that follows succeeds. */
export function continueAfterSignIn(path: string): void {
  destination = path;
}

/** Where a finished sign-in should go: the remembered place, or `fallback`. */
export function signedInDestination(fallback = '/(tabs)'): string {
  return destination ?? fallback;
}

/** Called by the destination itself when it opens, or when the visitor gives up. */
export function clearAfterSignIn(): void {
  destination = null;
}

/**
 * A shop the guest tried to favourite before signing in.
 *
 * The heart needs an account to hang a favourite on, so a guest is sent to sign
 * in — and used to come back with the shop un-favourited and themselves on the
 * home screen (CUST-10). The id is remembered here; the shop screen reads it on
 * the way back and does the favourite the guest actually asked for.
 */
let pendingFavorite: string | null = null;

export function rememberFavoriteIntent(restaurantId: string): void {
  pendingFavorite = restaurantId;
}

/** Returns the pending favourite for this shop and clears it, or null. */
export function takeFavoriteIntent(restaurantId: string): boolean {
  if (pendingFavorite !== restaurantId) return false;
  pendingFavorite = null;
  return true;
}
