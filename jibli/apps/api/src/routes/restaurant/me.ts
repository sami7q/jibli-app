import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { restaurantPermissionsFor, success } from '@jibli/contracts';
import { memberRestaurantIds } from '@jibli/auth';
import { restaurants, users } from '@jibli/db';
import type { AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';

/**
 * Portal identity (plan §63, §86, §131).
 *
 * The shell needs three things the access token alone cannot give it: who is
 * signed in, which restaurants they may switch between, and what their role
 * permits. Sending the permission set lets the portal hide a nav entry the role
 * can never use — the server still enforces every one of them, so this only
 * shapes the UI and grants nothing (plan §112).
 *
 * Roles travel as their stable codes; the Arabic label is a presentation
 * concern and lives with the portal, not the API.
 *
 * The restaurant list is derived from session membership, never from a query
 * parameter, so a user cannot discover restaurants they do not belong to.
 */
export function registerRestaurantMeRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    '/api/v1/restaurant-portal/me',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const membershipIds = memberRestaurantIds(principal);

      const [user] = await ctx.db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, principal.userId))
        .limit(1);

      // No memberships is a legitimate state — a platform admin opening the
      // portal, say — and the shell renders a clear message rather than an
      // empty dashboard.
      const rows =
        membershipIds.length === 0
          ? []
          : await ctx.db
              .select({
                id: restaurants.id,
                displayName: restaurants.displayName,
                partnerCode: restaurants.partnerCode,
                operationalStatus: restaurants.operationalStatus,
              })
              .from(restaurants)
              .where(
                and(inArray(restaurants.id, membershipIds), isNull(restaurants.deletedAt)),
              );

      return reply.send(
        success({
          user: {
            id: user?.id ?? principal.userId,
            full_name: user?.fullName ?? null,
          },
          restaurants: rows.map((row) => {
            const roles = principal.restaurantRoles[row.id] ?? [];
            return {
              id: row.id,
              display_name: row.displayName,
              partner_code: row.partnerCode,
              operational_status: row.operationalStatus,
              roles,
              permissions: [...restaurantPermissionsFor(roles)],
            };
          }),
        }),
      );
    },
  );
}
