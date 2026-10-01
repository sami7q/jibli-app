import { eq, sql } from 'drizzle-orm';
import type { MerchantType } from '@jibli/contracts';
import { branchWorkingHours, uuidv7, type Database, type Transaction } from '@jibli/db';

/**
 * A market opens when its owner does, not when a form is filled in.
 *
 * The readiness checklist was written for kitchens: a restaurant sets its
 * hours deliberately, because a kitchen that says it is open at 3 a.m. gets
 * orders at 3 a.m. A grocer or a cosmetics shop created from Admin had no
 * hours at all, and with no schedule the domain rule says "closed" — so the
 * shop could not be activated, and once activated would never have opened.
 * Two portal screens stood between the owner and their first order.
 *
 * So a shop gets a working week by default — long hours, every day — the
 * moment it exists, and again at activation for the shops made before this.
 * The portal edits them like any other schedule; nothing here is final.
 */
export const DEFAULT_SHOP_OPENS_AT_MINUTE = 8 * 60;
export const DEFAULT_SHOP_CLOSES_AT_MINUTE = 23 * 60;

/** The merchants that sell from a shelf rather than a kitchen. */
export function isSelfServeMerchant(merchantType: MerchantType): boolean {
  return merchantType === 'MARKET' || merchantType === 'COSMETICS';
}

/**
 * Write the default week for a branch that has no schedule. Returns whether
 * anything was written, so a caller can say so.
 */
export async function ensureDefaultWorkingHours(
  db: Database | Transaction,
  branchId: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ value: sql<number>`COUNT(*)` })
    .from(branchWorkingHours)
    .where(eq(branchWorkingHours.branchId, branchId));

  if (Number(existing?.value ?? 0) > 0) return false;

  await db.insert(branchWorkingHours).values(
    Array.from({ length: 7 }, (_, dayOfWeek) => ({
      id: uuidv7(),
      branchId,
      dayOfWeek,
      opensAtMinute: DEFAULT_SHOP_OPENS_AT_MINUTE,
      closesAtMinute: DEFAULT_SHOP_CLOSES_AT_MINUTE,
      isClosed: false,
    })),
  );
  return true;
}
