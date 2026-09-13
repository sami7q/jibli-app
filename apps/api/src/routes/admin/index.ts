import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../lib/context.js';
import { registerAdminGeographyRoutes } from './geography.js';
import { registerAdminRestaurantRoutes } from './restaurants.js';
import { registerAdminOrderRoutes } from './orders.js';
import { registerAdminFinanceRoutes } from './finance.js';
import { registerAdminPeopleRoutes } from './people.js';
import { registerAdminSettingsRoutes } from './settings.js';
import { registerAdminDashboardRoutes } from './dashboard.js';
import { registerAdminCouponRoutes } from './coupons.js';
import { registerAdminPortalUserRoutes } from './portal-users.js';
import { registerAdminSupportRoutes } from './support.js';
import { registerAdminReviewRoutes } from './reviews.js';

/**
 * Admin Portal API surface (plan §67, §69, §73, §87).
 *
 * Split by domain rather than kept in one file: each module owns its own
 * permissions and audit actions, and a reviewer can see the whole of "what can
 * finance do" without reading geography code.
 */
export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerAdminGeographyRoutes(app, ctx);
  registerAdminRestaurantRoutes(app, ctx);
  registerAdminOrderRoutes(app, ctx);
  registerAdminFinanceRoutes(app, ctx);
  registerAdminPeopleRoutes(app, ctx);
  registerAdminSettingsRoutes(app, ctx);
  registerAdminDashboardRoutes(app, ctx);
  registerAdminCouponRoutes(app, ctx);
  registerAdminPortalUserRoutes(app, ctx);
  registerAdminSupportRoutes(app, ctx);
  registerAdminReviewRoutes(app, ctx);
}
