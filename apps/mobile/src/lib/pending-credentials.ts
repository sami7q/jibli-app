/**
 * The name and password of a registration that is waiting on its code.
 *
 * Registration is two requests with a screen between them: the first sends a
 * code, the second spends it and creates the account. The password has to
 * survive that gap on the device, because the server deliberately keeps nothing
 * — storing an unverified stranger's password against a number they may not own
 * is exactly what the two-step design exists to avoid.
 *
 * **Not route params, and that is the point.** Passing it through
 * `router.push({ params })` would put a plaintext password into expo-router's
 * navigation state, which React Navigation can serialise into Android's
 * `savedInstanceState` when the process is killed in the background — writing
 * it to disk, outside the keystore, for a value that should never outlive the
 * screen.
 *
 * A module-scoped variable is memory only. It dies with the process, which is
 * the correct lifetime: a registration interrupted by a restart starts again.
 */

export type PendingPurpose = 'REGISTER' | 'RESET';

interface PendingCredentials {
  readonly purpose: PendingPurpose;
  readonly phone: string;
  readonly password: string;
  /** Only a registration carries one; a reset is for an account that has a name. */
  readonly fullName?: string;
}

let pending: PendingCredentials | null = null;

export function holdPendingCredentials(value: PendingCredentials): void {
  pending = value;
}

/**
 * Read them back, for the number they were held for.
 *
 * The phone is checked rather than trusted so that a stale hold — a
 * registration abandoned halfway, then a different number started — cannot
 * complete against the wrong account.
 */
export function readPendingCredentials(
  purpose: PendingPurpose,
  phone: string,
): PendingCredentials | null {
  if (!pending) return null;
  if (pending.purpose !== purpose || pending.phone !== phone) return null;
  return pending;
}

/**
 * Forget them.
 *
 * Called once the account exists or the password is set — and on leaving the
 * flow, so an abandoned signup does not leave a password in memory for the rest
 * of the session.
 */
export function clearPendingCredentials(): void {
  pending = null;
}
