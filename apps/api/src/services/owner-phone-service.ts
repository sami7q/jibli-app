import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { restaurantBranches, restaurantMembers, users, type Database } from '@jibli/db';

/**
 * The number that speaks for a shop.
 *
 * It is where the code goes when the owner changes the shop's password from
 * the app, so Admin shows it and the password route sends to it — the same
 * lookup, so what the operator reads is where the message went. An active
 * OWNER member's number, the oldest first; the branch's own number when no
 * owner carries one; null when there is neither, which Admin flags.
 */
export async function findOwnerPhone(db: Database, restaurantId: string): Promise<string | null> {
  const [owner] = await db
    .select({ phone: users.phoneE164 })
    .from(restaurantMembers)
    .innerJoin(users, eq(restaurantMembers.userId, users.id))
    .where(
      and(
        eq(restaurantMembers.restaurantId, restaurantId),
        eq(restaurantMembers.role, 'OWNER'),
        eq(restaurantMembers.isActive, true),
        isNotNull(users.phoneE164),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(restaurantMembers.createdAt))
    .limit(1);

  if (owner?.phone) return owner.phone;

  const [branch] = await db
    .select({ phone: restaurantBranches.phone })
    .from(restaurantBranches)
    .where(
      and(eq(restaurantBranches.restaurantId, restaurantId), isNull(restaurantBranches.deletedAt)),
    )
    .limit(1);

  return branch?.phone ?? null;
}
