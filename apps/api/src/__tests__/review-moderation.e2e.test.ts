import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  cities,
  createDatabase,
  orderReviews,
  orders,
  providers,
  restaurantBranches,
  restaurantMembers,
  restaurants,
  reviewReports,
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
 * on the third independent reporter (never the shop's own staff, never accounts
 * that have not received an order), blocks that stay personal, the moderator's decision,
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
  readonly staff: string[];
  readonly strangers: string[];
  readonly reviewId: string;
  readonly staffReviewId: string;
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

  const delivered = async (userId: string): Promise<string> => {
    const id = uuidv7();
    await db.insert(orders).values({
      id,
      publicOrderNumber: `JR${Math.random().toString().slice(2, 9)}`,
      userId,
      restaurantId,
      branchId,
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
      customerNameSnapshot: 'x',
      customerPhoneSnapshot: '+9647700000001',
      deliveryAddressSnapshotJson: { cityId: city.id },
      restaurantLocationSnapshotJson: { branchId },
    });
    return id;
  };

  const review = async (rating: number, comment: string): Promise<string> => {
    const id = uuidv7();
    await db.insert(orderReviews).values({
      id,
      orderId: await delivered(author),
      userId: author,
      restaurantId,
      rating,
      comment,
      termsAcceptedAt: new Date(),
    });
    return id;
  };

  const reviewId = await review(1, 'تعليق سيُبلَّغ عنه');
  const staffReviewId = await review(2, 'تعليق لا يعجب المتجر');
  await db
    .update(restaurants)
    .set({ ratingAverage: 1.5, ratingCount: 2 })
    .where(eq(restaurants.id, restaurantId));

  // Readers are real customers: each has received an order.
  for (const reader of readers) await delivered(reader);

  // The shop's own people — customers too, so only membership disqualifies them.
  const staff: string[] = [];
  for (const role of ['OWNER', 'MANAGER', 'CASHIER'] as const) {
    const id = await person(db, city.id, city.governorateId, `موظف ${role}`);
    await db.insert(restaurantMembers).values({ id: uuidv7(), restaurantId, userId: id, role });
    await delivered(id);
    staff.push(id);
  }

  // Fresh sign-ups that have never received anything.
  const strangers = [
    await person(db, city.id, city.governorateId, 'حساب جديد ١'),
    await person(db, city.id, city.governorateId, 'حساب جديد ٢'),
    await person(db, city.id, city.governorateId, 'حساب جديد ٣'),
  ];

  const ctx = { db, logger: silent } as unknown as AppContext;

  return {
    db,
    ctx,
    restaurantId,
    author,
    readers,
    staff,
    strangers,
    reviewId,
    staffReviewId,
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
    expect(shop?.ratingCount).toBe(1);
  });

  it("the shop's staff and order-less accounts reach the queue but cannot hide a review", async () => {
    for (const reporter of [...fx.staff, ...fx.strangers]) {
      const result = await reportReview(fx.ctx, {
        reviewId: fx.staffReviewId,
        reporterUserId: reporter,
        reason: 'FALSE',
      });
      expect(result).toEqual({ reported: true, hidden: false });
    }

    const [review] = await fx.db
      .select()
      .from(orderReviews)
      .where(eq(orderReviews.id, fx.staffReviewId));
    expect(review?.isHidden).toBe(false);

    const item = (await moderationQueue(fx.ctx)).find(
      (entry) => entry.review_id === fx.staffReviewId,
    );
    expect(item?.open_reports).toBe(6);
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
    expect(result.count).toBe(2);

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
    expect(removed.reviews).toBe(2);
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
