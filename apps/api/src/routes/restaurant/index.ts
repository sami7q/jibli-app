import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../lib/context.js';
import { registerRestaurantOrderRoutes } from './orders.js';
import { registerRestaurantMenuRoutes } from './menu.js';
import { registerRestaurantInventoryRoutes } from './inventory.js';
import { registerRestaurantFinanceRoutes } from './finance.js';
import { registerRestaurantTeamRoutes } from './team.js';
import { registerRestaurantSettingsRoutes } from './settings.js';
import { registerRestaurantMeRoute } from './me.js';
import { registerRestaurantHistoryRoutes } from './history.js';
import { registerRestaurantDashboardRoutes } from './dashboard.js';
import { registerRestaurantActivationRoutes } from './activation.js';
import { registerRestaurantSupportRoutes } from './support.js';
import { registerRestaurantReviewRoutes } from './reviews.js';

/**
 * Restaurant Portal API surface (plan §29, §70, §72, §73).
 *
 * Split by domain so each module owns its own permission checks. Every handler
 * resolves its restaurant from the session via `restaurantScope` — a submitted
 * restaurant ID is a selector, never proof of access (plan §63).
 */
export function registerRestaurantPortalRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerRestaurantOrderRoutes(app, ctx);
  registerRestaurantMenuRoutes(app, ctx);
  registerRestaurantInventoryRoutes(app, ctx);
  registerRestaurantFinanceRoutes(app, ctx);
  registerRestaurantTeamRoutes(app, ctx);
  registerRestaurantSettingsRoutes(app, ctx);
  registerRestaurantMeRoute(app, ctx);
  registerRestaurantHistoryRoutes(app, ctx);
  registerRestaurantDashboardRoutes(app, ctx);
  registerRestaurantActivationRoutes(app, ctx);
  registerRestaurantSupportRoutes(app, ctx);
  registerRestaurantReviewRoutes(app, ctx);
}
