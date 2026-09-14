import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { uuidSchema } from '@jibli/validation';
import type { AppContext } from '../lib/context.js';
import { requirePrincipal } from '../plugins/auth.js';
import { maxAssetBytes, readAsset, storeAsset } from '../services/asset-service.js';

/**
 * Image upload and delivery.
 *
 * Two routes, and the asymmetry between them is the point: uploading is a
 * privileged action, and serving is not. A logo appears on a public restaurant
 * page, so requiring a token to fetch it would mean the customer app could
 * never show one.
 */

const uploadSchema = z.object({
  /** Data URL or bare base64; the service tolerates either. */
  data: z.string().min(16),
  purpose: z.enum(['RESTAURANT_LOGO', 'RESTAURANT_COVER', 'MENU_ITEM']).default('RESTAURANT_LOGO'),
  restaurant_id: uuidSchema.optional(),
});

/**
 * base64 costs a third on top, and Fastify rejects an oversized body before any
 * handler runs — so a limit that ignored the encoding would answer a 4 MB photo
 * with a bare 413 instead of the message that says what to do about it.
 */
function encodedLimit(rawBytes: number): number {
  return Math.ceil((rawBytes / 3) * 4) + 64 * 1024;
}

export function registerAssetRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/api/v1/uploads',
    {
      preHandler: app.authenticate,
      /*
       * Tighter than the global limit. An upload is the most expensive request
       * the API serves, and the only one where a loop costs storage rather than
       * just CPU.
       */
      config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
      // Larger than the global body limit, and only here.
      bodyLimit: encodedLimit(maxAssetBytes(ctx)),
    },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const body = uploadSchema.parse(request.body);

      /*
       * A restaurant user may only attach images to their own restaurant. The
       * check is here rather than in the service because the service is also
       * reachable from Admin, where any restaurant is legitimate.
       */
      if (body.restaurant_id) {
        const isPlatformStaff = principal.platformRoles.length > 0;
        const isMember = Object.keys(principal.restaurantRoles ?? {}).includes(body.restaurant_id);
        if (!isPlatformStaff && !isMember) {
          throw new AppError(ERROR_CODES.FORBIDDEN, {
            details: { reason: 'NOT_A_MEMBER_OF_RESTAURANT' },
          });
        }
      }

      const stored = await storeAsset(ctx, {
        base64: body.data,
        ownerUserId: principal.userId,
        purpose: body.purpose,
        ...(body.restaurant_id ? { restaurantId: body.restaurant_id } : {}),
      });

      return reply.status(201).send(
        success(
          {
            asset_id: stored.id,
            url: `/api/v1/assets/${stored.id}`,
            content_type: stored.contentType,
            byte_size: stored.byteSize,
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Public by design: a logo is shown on a public restaurant page and inside
   * the customer app before anyone signs in.
   */
  app.get('/api/v1/assets/:assetId', async (request, reply) => {
    const { assetId } = z.object({ assetId: uuidSchema }).parse(request.params);

    const asset = await readAsset(ctx, assetId);
    if (!asset) throw new AppError(ERROR_CODES.NOT_FOUND);

    /*
     * The id is a UUIDv7 minted for this upload and never reused, so the bytes
     * behind a URL cannot change. Replacing a logo mints a new id, which is
     * what makes a year-long immutable cache correct rather than optimistic.
     *
     * `nosniff` matters more here than anywhere else in the API: it is the
     * instruction not to re-interpret these bytes as something executable.
     */
    return reply
      .header('Content-Type', asset.contentType)
      .header('Content-Length', String(asset.byteSize))
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', 'inline')
      .send(asset.data);
  });
}
