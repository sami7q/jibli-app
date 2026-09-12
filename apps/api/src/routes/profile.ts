import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { fullNameSchema, iraqCoordinatesSchema, uuidSchema } from '@jibli/validation';
import { sanitizeDisplayText } from '@jibli/validation';
import { cities, governorates, userAddresses, userDevices, users, uuidv7 } from '@jibli/db';
import type { AppContext } from '../lib/context.js';
import { requirePrincipal } from '../plugins/auth.js';
import { assertSelectableGeography, resolveCity } from '../services/geography-service.js';

/**
 * Customer profile and delivery addresses (plan §11, §12, §13, §68).
 *
 * Profile geography and delivery addresses are separate objects. Changing the
 * profile city never rewrites saved addresses or historical orders (plan §12).
 */

const completeProfileSchema = z.object({
  full_name: fullNameSchema,
  governorate_id: uuidSchema,
  city_id: uuidSchema,
});

const updateProfileSchema = z.object({
  full_name: fullNameSchema.optional(),
  governorate_id: uuidSchema.optional(),
  city_id: uuidSchema.optional(),
});

const addressSchema = z.object({
  label: z.string().max(40).optional(),
  governorate_id: uuidSchema,
  city_id: uuidSchema,
  district_text: z.string().max(120).optional(),
  street: z.string().max(160).optional(),
  building: z.string().max(60).optional(),
  floor: z.string().max(30).optional(),
  landmark: z.string().max(160).optional(),
  coordinates: iraqCoordinatesSchema.optional(),
  delivery_notes: z.string().max(300).optional(),
  is_default: z.boolean().default(false),
});

export function registerProfileRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Mandatory profile completion after OTP (plan §11).
   *
   * The city was selectable when the app fetched the list. An Admin may have
   * disabled it since, so the capability is re-checked here against current
   * state — that race is the whole reason this endpoint re-validates.
   */
  app.post('/api/v1/profile/complete', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = completeProfileSchema.parse(request.body);

    const result = await ctx.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: users.id, profileCompletedAt: users.profileCompletedAt })
        .from(users)
        .where(eq(users.id, principal.userId))
        .limit(1);

      if (!current) throw new AppError(ERROR_CODES.UNAUTHENTICATED);
      if (current.profileCompletedAt) {
        throw new AppError(ERROR_CODES.PROFILE_ALREADY_COMPLETED_CONFLICT);
      }

      // Revalidate activation and the parent relationship (plan §11 step 6).
      const resolved = await assertSelectableGeography(tx, {
        governorateId: body.governorate_id,
        cityId: body.city_id,
        capability: 'customer_signup',
      });

      const now = new Date();
      await tx
        .update(users)
        .set({
          fullName: body.full_name,
          profileGovernorateId: body.governorate_id,
          profileCityId: body.city_id,
          profileCompletedAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, principal.userId));

      return { cityNameAr: resolved.city.nameAr, governorateNameAr: resolved.governorate.nameAr };
    });

    ctx.logger.info(
      { event: 'profile.completed', userId: principal.userId, requestId: request.requestId },
      'Customer profile completed',
    );

    return reply.send(
      success(
        {
          profile_completed: true,
          full_name: body.full_name,
          governorate: { id: body.governorate_id, name_ar: result.governorateNameAr },
          city: { id: body.city_id, name_ar: result.cityNameAr },
          next_step: 'HOME',
        },
        { request_id: request.requestId },
      ),
    );
  });

  app.get('/api/v1/profile', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);

    const [profile] = await ctx.db
      .select({
        id: users.id,
        fullName: users.fullName,
        phoneE164: users.phoneE164,
        profileCompletedAt: users.profileCompletedAt,
        governorateId: users.profileGovernorateId,
        cityId: users.profileCityId,
        governorateNameAr: governorates.nameAr,
        cityNameAr: cities.nameAr,
      })
      .from(users)
      .leftJoin(governorates, eq(users.profileGovernorateId, governorates.id))
      .leftJoin(cities, eq(users.profileCityId, cities.id))
      .where(eq(users.id, principal.userId))
      .limit(1);

    if (!profile) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'profile' } });

    return reply.send(
      success(
        {
          id: profile.id,
          full_name: profile.fullName,
          phone: profile.phoneE164,
          profile_completed: profile.profileCompletedAt !== null,
          governorate: profile.governorateId
            ? { id: profile.governorateId, name_ar: profile.governorateNameAr }
            : null,
          city: profile.cityId ? { id: profile.cityId, name_ar: profile.cityNameAr } : null,
        },
        { request_id: request.requestId },
      ),
    );
  });

  /** Update profile details. Geography changes repeat the capability check. */
  app.patch('/api/v1/profile', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = updateProfileSchema.parse(request.body);

    // Geography must be changed as a pair: half a move would leave the profile
    // pointing at a city in a different governorate.
    if ((body.governorate_id && !body.city_id) || (!body.governorate_id && body.city_id)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
        details: { message: 'governorate_id and city_id must be updated together' },
      });
    }

    await ctx.db.transaction(async (tx) => {
      if (body.governorate_id && body.city_id) {
        await assertSelectableGeography(tx, {
          governorateId: body.governorate_id,
          cityId: body.city_id,
          capability: 'customer_signup',
        });
      }

      await tx
        .update(users)
        .set({
          ...(body.full_name ? { fullName: body.full_name } : {}),
          ...(body.governorate_id ? { profileGovernorateId: body.governorate_id } : {}),
          ...(body.city_id ? { profileCityId: body.city_id } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, principal.userId));
    });

    return reply.send(success({ updated: true }, { request_id: request.requestId }));
  });

  // ── Delivery addresses (plan §12, §13) ────────────────────────────────────

  app.get('/api/v1/addresses', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);

    const rows = await ctx.db
      .select({
        address: userAddresses,
        cityNameAr: cities.nameAr,
        governorateNameAr: governorates.nameAr,
        cityOrderingEnabled: cities.orderingEnabled,
        governorateOrderingEnabled: governorates.orderingEnabled,
        cityIsEnabled: cities.isEnabled,
        governorateIsEnabled: governorates.isEnabled,
      })
      .from(userAddresses)
      .innerJoin(cities, eq(userAddresses.cityId, cities.id))
      .innerJoin(governorates, eq(userAddresses.governorateId, governorates.id))
      .where(and(eq(userAddresses.userId, principal.userId), isNull(userAddresses.deletedAt)));

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.address.id,
          label: row.address.label,
          governorate: { id: row.address.governorateId, name_ar: row.governorateNameAr },
          city: { id: row.address.cityId, name_ar: row.cityNameAr },
          district_text: row.address.districtText,
          street: row.address.street,
          building: row.address.building,
          floor: row.address.floor,
          landmark: row.address.landmark,
          latitude: row.address.latitude,
          longitude: row.address.longitude,
          delivery_notes: row.address.deliveryNotes,
          is_default: row.address.isDefault,
          // A saved address in a closed city remains stored but is marked
          // unavailable for ordering (plan §8.7).
          orderable: Boolean(
            row.governorateIsEnabled &&
              row.governorateOrderingEnabled &&
              row.cityIsEnabled &&
              row.cityOrderingEnabled,
          ),
        })),
        { request_id: request.requestId },
      ),
    );
  });

  app.post('/api/v1/addresses', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = addressSchema.parse(request.body);

    const addressId = await ctx.db.transaction(async (tx) => {
      // An address may be saved in a city that is not currently taking orders —
      // the customer may be preparing for a launch — so only the parent
      // relationship is enforced here. Orderability is judged at checkout.
      const resolved = await resolveCity(tx, body.city_id);
      if (resolved.city.governorateId !== body.governorate_id) {
        throw new AppError(ERROR_CODES.CITY_GOVERNORATE_MISMATCH, {
          details: { cityId: body.city_id, governorateId: body.governorate_id },
        });
      }

      const id = uuidv7();

      if (body.is_default) {
        // The partial unique index permits only one default; clear the old one first.
        await tx
          .update(userAddresses)
          .set({ isDefault: false })
          .where(
            and(
              eq(userAddresses.userId, principal.userId),
              eq(userAddresses.isDefault, true),
              isNull(userAddresses.deletedAt),
            ),
          );
      }

      await tx.insert(userAddresses).values({
        id,
        userId: principal.userId,
        label: body.label ? sanitizeDisplayText(body.label) : null,
        governorateId: body.governorate_id,
        cityId: body.city_id,
        districtText: body.district_text ? sanitizeDisplayText(body.district_text) : null,
        street: body.street ? sanitizeDisplayText(body.street) : null,
        building: body.building ? sanitizeDisplayText(body.building) : null,
        floor: body.floor ? sanitizeDisplayText(body.floor) : null,
        landmark: body.landmark ? sanitizeDisplayText(body.landmark) : null,
        latitude: body.coordinates?.latitude ?? null,
        longitude: body.coordinates?.longitude ?? null,
        deliveryNotes: body.delivery_notes ? sanitizeDisplayText(body.delivery_notes) : null,
        isDefault: body.is_default,
      });

      return id;
    });

    return reply
      .status(201)
      .send(success({ id: addressId }, { request_id: request.requestId }));
  });

  app.delete('/api/v1/addresses/:addressId', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const { addressId } = z.object({ addressId: uuidSchema }).parse(request.params);

    // Soft delete: historical orders reference this row (plan §4.7).
    const deleted = await ctx.db
      .update(userAddresses)
      .set({ deletedAt: new Date(), isDefault: false })
      .where(
        and(
          eq(userAddresses.id, addressId),
          eq(userAddresses.userId, principal.userId),
          isNull(userAddresses.deletedAt),
        ),
      )
      .returning({ id: userAddresses.id });

    if (deleted.length === 0) {
      throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'address' } });
    }

    return reply.send(success({ deleted: true }, { request_id: request.requestId }));
  });

  /**
   * Push device registration (plan §68).
   *
   * Deliberately not under /driver: the table is keyed on the user, and a
   * customer needs push for "your order was accepted" exactly as a driver needs
   * it for a new assignment. It lived at /api/v1/driver/devices, which would
   * have forced the customer app to call a driver-named route — and broken the
   * day that route was correctly narrowed to drivers only.
   */
  app.post('/api/v1/devices', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = z
      .object({
        platform: z.enum(['IOS', 'ANDROID', 'WEB']),
        push_token: z.string().min(10).max(512),
        app_version: z.string().max(20).optional(),
      })
      .parse(request.body);

    /*
     * Conflict on the token, not the user: one person may carry two phones, and
     * a phone handed on to someone else must follow the token to its new owner
     * rather than keep pushing another user's orders to it.
     */
    await ctx.db
      .insert(userDevices)
      .values({
        id: uuidv7(),
        userId: principal.userId,
        platform: body.platform,
        pushToken: body.push_token,
        appVersion: body.app_version ?? null,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userDevices.pushToken,
        set: { userId: principal.userId, lastSeenAt: new Date(), revokedAt: null },
      });

    return reply.send(success({ registered: true }, { request_id: request.requestId }));
  });
}
