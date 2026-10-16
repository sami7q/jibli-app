import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  cities,
  createDatabase,
  orderReviews,
  orders,
  providers,
  restaurantBranches,
  restaurants,
  reviewReports,
  userAddresses,
  userBlocks,
  users,
  uuidv7,
  type Database,
} from '@jibli/db';
import { runMigrations } from '@jibli/db/migrate';
import { activateCity, seedGeography } from '@jibli/db/seed';
import type { AppContext } from '../lib/context.js';
import {
  AUTO_HIDE_REPORTS,
  blockedAuthorIds,
  blockReviewAuthor,
  deleteUserContent,
  moderationQueue,
  reportReview,
  resolveReview,
} from '../services/review-moderation-service.js';

/**
 * User-generated content, against a real database: reports that hide a review
 * on the third reporter, blocks that stay personal, the moderator's decision,
 * and a deleted account taking its reviews — and its stars — with it.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;

const silent = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => silent,
};

interface Fixture {
  readonly db: Database;
  readonly ctx: AppContext;
  readonly cleanup: () => Promise<void>;
  readonly restaurantId: string;
  readonly author: string;
  readonly readers: string[];
  readonly reviewId: string;
}

async function person(db: Database, cityId: string, governorateId: string, name: string) {
  const id = uuidv7();
  await db.insert(users).values({
    id,
    phoneE164: `+9647${Math.floor(100_000_000 + Math.random() * 899_999_999)}`,
    phoneVerifiedAt: new Date(),
    fullName: name,
    profileGovernorateId: governorateId,
    profileCityId: cityId,
    profileCompletedAt: new Date(),
  });
  return id;
}

async function buildFixture(): Promise<Fixture> {
  const { db, sql: client } = createDatabase({
    connectionString: TEST_DATABASE_URL as string,
    maxConnections: 5,
  });
  await runMigrations(TEST_DATABASE_URL as string);
  await seedGeography(db);
  await activateCity(db, 'IQ-BG-BAGHDAD', {
    customerSignup: true,
    restaurantOnboarding: true,
    ordering: true,
  });

  const [city] = await db
    .select({ id: cities.id, governorateId: cities.governorateId })
    .from(cities)
    .where(eq(cities.code, 'IQ-BG-BAGHDAD'))
    .limit(1);
  if (!city) throw new Error('Baghdad missing');

  const author = await person(db, city.id, city.governorateId, 'كاتب التقييم');
  const readers = [
    await person(db, city.id, city.governorateId, 'قارئ أول'),
    await person(db, city.id, city.governorateId, 'قارئ ثانٍ'),
    await person(db, city.id, city.governorateId, 'قارئ ثالث'),
  ];

  const addressId = uuidv7();
  await db.insert(userAddresses).values({
    id: addressId,
    userId: author,
    governorateId: city.governorateId,
    cityId: city.id,
    districtText: 'الكرادة',
    isDefault: true,
  });

  const providerId = uuidv7();
  await db
    .insert(providers)
    .values({ id: providerId, providerType: 'RESTAURANT', status: 'ACTIVE' });
  const restaurantId = uuidv7();
  await db.insert(restaurants).values({
    id: restaurantId,
    providerId,
    displayName: 'مطعم الاختبار',
    partnerCode: `T${String(Date.now()).slice(-6)}`,
    onboardingStatus: 'APPROVED',
    operationalStatus: 'ACTIVE',
  });
  const branchId = uuidv7();
  await db.insert(restaurantBranches).values({
    id: branchId,
    restaurantId,
    name: 'الفرع',
    governorateId: city.governorateId,
    cityId: city.id,
    addressText: 'بغداد',
  });

  const orderId = uuidv7();
  await db.insert(orders).values({
    id: orderId,
    publicOrderNumber: `JR${Date.now().toString().slice(-7)}`,
    userId: author,
    restaurantId,
    branchId,
    addressId,
    status: 'COMPLETED',
    paymentStatus: 'PAID_CASH',
    placedAt: new Date(Date.now() - 3_600_000),
    deliveredAt: new Date(),
    completedAt: new Date(),
    itemsSubtotalIqd: 10_000,
    deliveryFeeIqd: 0,
    platformServiceFeeIqd: 0,
    discountTotalIqd: 0,
    customerTotalIqd: 10_000,
    commissionBaseIqd: 10_000,
    commissionFlatIqdSnapshot: 500,
    commissionAmountIqd: 500,
    restaurantNetSnapshotIqd: 9_500,
    customerNameSnapshot: 'كاتب التقييم',
    customerPhoneSnapshot: '+9647700000001',
    deliveryAddressSnapshotJson: { cityId: city.id },
    restaurantLocationSnapshotJson: { branchId },
  });

  const reviewId = uuidv7();
  await db.insert(orderReviews).values({
    id: reviewId,
    orderId,
    userId: author,
    restaurantId,
    rating: 1,
    comment: 'تعليق سيُبلَّغ عنه',
    termsAcceptedAt: new Date(),
  });
  await db
    .update(restaurants)
    .set({ ratingAverage: 1, ratingCount: 1 })
    .where(eq(restaurants.id, restaurantId));

  const ctx = { db, logger: silent } as unknown as AppContext;

  return {
    db,
    ctx,
    restaurantId,
    author,
    readers,
    reviewId,
    cleanup: async () => {
      await client.end();
    },
  };
}

describeWithDb('review moderation (end to end)', () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await buildFixture();
  }, 120_000);

  afterAll(async () => {
    await fx?.cleanup();
  });

  it('refuses a report on your own review', async () => {
    await expect(
      reportReview(fx.ctx, { reviewId: fx.reviewId, reporterUserId: fx.author, reason: 'ABUSIVE' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('counts one report per reader, and hides the review at the threshold', async () => {
    expect(AUTO_HIDE_REPORTS).toBe(3);

    const first = await reportReview(fx.ctx, {
      reviewId: fx.reviewId,
      reporterUserId: fx.readers[0]!,
      reason: 'ABUSIVE',
      note: 'شتيمة',
    });
    expect(first).toEqual({ reported: true, hidden: false });

    // The same reader again is the same complaint.
    const again = await reportReview(fx.ctx, {
      reviewId: fx.reviewId,
      reporterUserId: fx.readers[0]!,
      reason: 'ABUSIVE',
    });
    expect(again).toEqual({ reported: false, hidden: false });

    await reportReview(fx.ctx, {
      reviewId: fx.reviewId,
      reporterUserId: fx.readers[1]!,
      reason: 'SPAM',
    });
    const third = await reportReview(fx.ctx, {
      reviewId: fx.reviewId,
      reporterUserId: fx.readers[2]!,
      reason: 'PERSONAL_DATA',
    });
    expect(third.hidden).toBe(true);

    const [review] = await fx.db
      .select()
      .from(orderReviews)
      .where(eq(orderReviews.id, fx.reviewId));
    expect(review?.isHidden).toBe(true);
    expect(review?.heldReason).toBe('REPORTED');

    // Hidden stars stop counting at once.
    const [shop] = await fx.db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, fx.restaurantId));
    expect(shop?.ratingCount).toBe(0);
  });

  it('puts the reported review in the queue with its reasons and notes', async () => {
    const queue = await moderationQueue(fx.ctx);
    const item = queue.find((entry) => entry.review_id === fx.reviewId);
    expect(item?.open_reports).toBe(3);
    expect(new Set(item?.report_reasons)).toEqual(new Set(['ABUSIVE', 'SPAM', 'PERSONAL_DATA']));
    expect(item?.report_notes).toEqual(['شتيمة']);
  });

  it('publishing closes the reports, clears the hold and counts the stars again', async () => {
    const result = await resolveReview(fx.ctx, {
      reviewId: fx.reviewId,
      action: 'PUBLISH',
      moderatorId: fx.readers[0]!,
    });
    expect(result.count).toBe(1);

    const reports = await fx.db
      .select({ status: reviewReports.status })
      .from(reviewReports)
      .where(eq(reviewReports.reviewId, fx.reviewId));
    expect(reports.every((report) => report.status === 'DISMISSED')).toBe(true);

    const [review] = await fx.db
      .select()
      .from(orderReviews)
      .where(eq(orderReviews.id, fx.reviewId));
    expect(review?.isHidden).toBe(false);
    expect(review?.heldReason).toBeNull();
    expect(review?.moderatedAt).not.toBeNull();

    expect((await moderationQueue(fx.ctx)).some((entry) => entry.review_id === fx.reviewId)).toBe(
      false,
    );
  });

  it('a block is personal: it filters the blocker and nobody else', async () => {
    await blockReviewAuthor(fx.ctx, { reviewId: fx.reviewId, blockerUserId: fx.readers[1]! });
    // Blocking twice is one block.
    await blockReviewAuthor(fx.ctx, { reviewId: fx.reviewId, blockerUserId: fx.readers[1]! });

    expect(await blockedAuthorIds(fx.ctx, fx.readers[1]!)).toEqual([fx.author]);
    expect(await blockedAuthorIds(fx.ctx, fx.readers[2]!)).toEqual([]);
    expect(await blockedAuthorIds(fx.ctx, null)).toEqual([]);

    await expect(
      blockReviewAuthor(fx.ctx, { reviewId: fx.reviewId, blockerUserId: fx.author }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it("deleting the author's account deletes their reviews, reports, blocks and stars", async () => {
    const removed = await fx.db.transaction((tx) => deleteUserContent(tx, fx.author));
    expect(removed.reviews).toBe(1);
    expect(removed.restaurants).toEqual([fx.restaurantId]);

    expect(
      await fx.db.select().from(orderReviews).where(eq(orderReviews.userId, fx.author)),
    ).toEqual([]);
    // Reports on the deleted review went with it, by cascade.
    expect(
      await fx.db.select().from(reviewReports).where(eq(reviewReports.reviewId, fx.reviewId)),
    ).toEqual([]);
    // The block on this author no longer exists.
    expect(
      await fx.db
        .select()
        .from(userBlocks)
        .where(inArray(userBlocks.blockedUserId, [fx.author])),
    ).toEqual([]);

    const [shop] = await fx.db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, fx.restaurantId));
    expect(shop?.ratingCount).toBe(0);
    expect(shop?.ratingAverage).toBeNull();
  });
});
