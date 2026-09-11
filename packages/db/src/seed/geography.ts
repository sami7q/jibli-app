import { eq, sql } from 'drizzle-orm';
import { CITIES, GOVERNORATES, SOURCE_VERSION, validateDataset } from '@jibli/geography';
import type { Database } from '../client.js';
import { cities, governorates } from '../schema/geography.js';
import { uuidv7 } from '../ids.js';

/**
 * Geography seed importer (plan §9).
 *
 * "Production update logic inserts new canonical units, updates safe descriptive
 * fields, and preserves stable IDs. A city referenced by historical orders is
 * never physically deleted."
 *
 * Capability flags are deliberately NOT touched on update: they are Operations'
 * decision, and re-running the seed must never reopen a city that was closed.
 */

export interface GeographySeedResult {
  readonly governoratesInserted: number;
  readonly governoratesUpdated: number;
  readonly citiesInserted: number;
  readonly citiesUpdated: number;
  readonly orphanedCityCodes: string[];
}

export async function seedGeography(db: Database): Promise<GeographySeedResult> {
  const validation = validateDataset();
  if (!validation.ok) {
    throw new Error(`Geography dataset failed validation:\n${validation.problems.join('\n')}`);
  }

  const result = {
    governoratesInserted: 0,
    governoratesUpdated: 0,
    citiesInserted: 0,
    citiesUpdated: 0,
    orphanedCityCodes: [] as string[],
  };

  await db.transaction(async (tx) => {
    const governorateIdByCode = new Map<string, string>();

    for (const seed of GOVERNORATES) {
      const existing = await tx
        .select({ id: governorates.id })
        .from(governorates)
        .where(eq(governorates.code, seed.code))
        .limit(1);

      const current = existing[0];
      if (current) {
        // Descriptive fields only — capability flags stay under Operations' control.
        await tx
          .update(governorates)
          .set({
            nameAr: seed.nameAr,
            nameEnInternal: seed.nameEnInternal,
            sortOrder: seed.sortOrder,
            sourceVersion: SOURCE_VERSION,
            updatedAt: new Date(),
          })
          .where(eq(governorates.id, current.id));
        governorateIdByCode.set(seed.code, current.id);
        result.governoratesUpdated += 1;
      } else {
        const id = uuidv7();
        await tx.insert(governorates).values({
          id,
          code: seed.code,
          nameAr: seed.nameAr,
          nameEnInternal: seed.nameEnInternal,
          sortOrder: seed.sortOrder,
          sourceVersion: SOURCE_VERSION,
          // All capabilities default false — the safest launch posture (plan §9).
          isEnabled: false,
          customerSignupEnabled: false,
          restaurantOnboardingEnabled: false,
          orderingEnabled: false,
        });
        governorateIdByCode.set(seed.code, id);
        result.governoratesInserted += 1;
      }
    }

    for (const [index, seed] of CITIES.entries()) {
      const governorateId = governorateIdByCode.get(seed.governorateCode);
      if (!governorateId) {
        throw new Error(`City ${seed.code} references unknown governorate ${seed.governorateCode}`);
      }

      const existing = await tx
        .select({ id: cities.id, governorateId: cities.governorateId })
        .from(cities)
        .where(eq(cities.code, seed.code))
        .limit(1);

      const current = existing[0];
      if (current) {
        // A city moving between governorates is a real administrative change and
        // must be reviewed by hand: silently reparenting would rewrite the
        // geography of historical restaurants and addresses (plan §97).
        if (current.governorateId !== governorateId) {
          throw new Error(
            `City ${seed.code} would change governorate. Administrative changes require ` +
              'a reviewed migration, not a seed run.',
          );
        }
        await tx
          .update(cities)
          .set({
            nameAr: seed.nameAr,
            nameEnInternal: seed.nameEnInternal,
            sortOrder: index,
            sourceVersion: SOURCE_VERSION,
            updatedAt: new Date(),
          })
          .where(eq(cities.id, current.id));
        result.citiesUpdated += 1;
      } else {
        await tx.insert(cities).values({
          id: uuidv7(),
          governorateId,
          code: seed.code,
          nameAr: seed.nameAr,
          nameEnInternal: seed.nameEnInternal,
          sortOrder: index,
          sourceVersion: SOURCE_VERSION,
          isEnabled: false,
          customerSignupEnabled: false,
          restaurantOnboardingEnabled: false,
          orderingEnabled: false,
        });
        result.citiesInserted += 1;
      }
    }

    // Rows in the database but no longer in the dataset are reported, never
    // deleted — historical orders may reference them (plan §8.2).
    const knownCodes = CITIES.map((c) => c.code);
    const orphans = await tx
      .select({ code: cities.code })
      .from(cities)
      .where(sql`${cities.code} <> ALL(${knownCodes})`);
    result.orphanedCityCodes = orphans.map((o) => o.code);
  });

  return result;
}

/**
 * Open a city for business (plan §124).
 *
 * Used by the local development seed and by operations tooling. Enabling a city
 * also enables its parent for that capability, because a child is never stronger
 * than its parent (plan §8.6) — leaving the parent off would silently produce a
 * city that looks open but is not.
 */
export async function activateCity(
  db: Database,
  cityCode: string,
  capabilities: {
    customerSignup?: boolean;
    restaurantOnboarding?: boolean;
    ordering?: boolean;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const found = await tx
      .select({ id: cities.id, governorateId: cities.governorateId })
      .from(cities)
      .where(eq(cities.code, cityCode))
      .limit(1);

    const city = found[0];
    if (!city) throw new Error(`Unknown city code: ${cityCode}`);

    const patch = {
      isEnabled: true,
      ...(capabilities.customerSignup !== undefined
        ? { customerSignupEnabled: capabilities.customerSignup }
        : {}),
      ...(capabilities.restaurantOnboarding !== undefined
        ? { restaurantOnboardingEnabled: capabilities.restaurantOnboarding }
        : {}),
      ...(capabilities.ordering !== undefined ? { orderingEnabled: capabilities.ordering } : {}),
      updatedAt: new Date(),
    };

    await tx.update(cities).set(patch).where(eq(cities.id, city.id));
    await tx.update(governorates).set(patch).where(eq(governorates.id, city.governorateId));
  });
}
