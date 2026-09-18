/**
 * Which of the saved addresses an order goes to.
 *
 * Its own module, with nothing imported, for the same reason `owner-vertical`
 * is: this is a rule, not a screen, and a rule that decides where a courier
 * drives should be pinned by tests rather than by reading three components.
 *
 * Two sources have an opinion. The server keeps one default per customer,
 * enforced by a partial unique index, and that is the right cross-device
 * answer. The phone keeps whichever address was last chosen from «التوصيل
 * إلى», because there is no endpoint to move the server's default — addresses
 * can only be created and deleted, so honouring a tap would otherwise mean
 * rewriting the row on every switch.
 *
 * The phone's choice wins where it still points at something. That last part is
 * the whole reason this is a function: a preference left pointing at a deleted
 * address must fall through, not leave the customer with no address at all.
 */
export function resolvePreferred<T extends { id: string; is_default: boolean }>(
  addresses: readonly T[],
  preferredId: string | null,
): T | null {
  return (
    (preferredId ? addresses.find((entry) => entry.id === preferredId) : undefined) ??
    addresses.find((entry) => entry.is_default) ??
    addresses[0] ??
    null
  );
}
