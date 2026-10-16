/**
 * Whether a dish can carry options — sizes, extras, removals.
 *
 * Off, and deliberately, until the whole path exists rather than half of it.
 * The catalog reports `requires_choice` and the item sheet could collect a
 * selection, but nothing downstream carries it: the cart has no field for it,
 * `POST /orders` has no parameter for it, and the API re-prices every line from
 * the menu. A choice was flattened into the order's free-text note and its
 * price added on the client only — so a customer could pick a 2,000 dinar
 * extra, watch the total rise, and be charged the base price for a dish the
 * kitchen would read about in a comment.
 *
 * While it is off, a dish with a *required* choice cannot be ordered at all —
 * there is no way to pick the size the kitchen needs — so the app shows it as
 * «يتوفر قريباً» rather than letting it be added to a cart the quote will later
 * refuse with MODIFIER_SELECTION_INVALID (CUST-2). The flag lives here, shared
 * by the menu, search and checkout, so the three never disagree about which
 * dishes can be bought.
 *
 * The work to finish it is downstream, not here — a column on the order line, a
 * parameter on the endpoint, and pricing the server owns. Then this becomes
 * `true` and the required-choice dishes become orderable through the sheet.
 */
export const MODIFIERS_ENABLED = false;
