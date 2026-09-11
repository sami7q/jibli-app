import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { GEOGRAPHY_CAPABILITIES, success } from '@jibli/contracts';
import { uuidSchema } from '@jibli/validation';
import type { AppContext } from '../lib/context.js';
import {
  listSelectableCities,
  listSelectableGovernorates,
} from '../services/geography-service.js';

/**
 * Public geography discovery (plan §67).
 *
 *   GET /api/v1/geography/governorates?capability=customer_signup
 *   GET /api/v1/geography/governorates/{id}/cities?capability=customer_signup
 *
 * Responses carry only what a client needs — ID, Arabic name, code. Source
 * version and the individual capability flags are internal and stay in the
 * Admin API (plan §67).
 */

const capabilityQuerySchema = z.object({
  capability: z.enum(GEOGRAPHY_CAPABILITIES).default('customer_signup'),
});

const governorateParamsSchema = z.object({
  governorateId: uuidSchema,
});

export function registerGeographyRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/geography/governorates', async (request, reply) => {
    const { capability } = capabilityQuerySchema.parse(request.query);
    const governorates = await listSelectableGovernorates(ctx, capability);

    return reply.send(
      success(
        governorates.map((g) => ({ id: g.id, code: g.code, name_ar: g.nameAr })),
        { request_id: request.requestId, capability },
      ),
    );
  });

  app.get('/api/v1/geography/governorates/:governorateId/cities', async (request, reply) => {
    const { governorateId } = governorateParamsSchema.parse(request.params);
    const { capability } = capabilityQuerySchema.parse(request.query);

    const cities = await listSelectableCities(ctx, governorateId, capability);

    return reply.send(
      success(
        cities.map((c) => ({ id: c.id, code: c.code, name_ar: c.nameAr })),
        { request_id: request.requestId, capability, governorate_id: governorateId },
      ),
    );
  });

  /**
   * Convenience endpoint for the onboarding wizard: the whole selectable tree in
   * one round trip, so a weak connection does not make a two-step picker feel
   * broken (plan §135).
   */
  app.get('/api/v1/geography/tree', async (request, reply) => {
    const { capability } = capabilityQuerySchema.parse(request.query);
    const governorates = await listSelectableGovernorates(ctx, capability);

    const tree = await Promise.all(
      governorates.map(async (governorate) => ({
        id: governorate.id,
        code: governorate.code,
        name_ar: governorate.nameAr,
        cities: (await listSelectableCities(ctx, governorate.id, capability)).map((c) => ({
          id: c.id,
          code: c.code,
          name_ar: c.nameAr,
        })),
      })),
    );

    // A governorate whose cities are all closed is not selectable in practice,
    // so it is dropped rather than shown as an empty branch.
    return reply.send(
      success(
        tree.filter((g) => g.cities.length > 0),
        { request_id: request.requestId, capability },
      ),
    );
  });
}
