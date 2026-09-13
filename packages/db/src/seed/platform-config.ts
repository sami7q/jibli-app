import { eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { uuidv7 } from '../ids.js';
import { platformConfig } from '../schema/platform.js';

/**
 * Platform configuration defaults (plan §118).
 *
 * Seeded once so Operations has something to edit. Existing values are never
 * overwritten: re-running the seed after someone has tuned the service fee must
 * not silently reset it.
 */

interface ConfigSeed {
  readonly key: string;
  readonly value: unknown;
  readonly descriptionAr: string;
  readonly isSensitive?: boolean;
}

const DEFAULTS: readonly ConfigSeed[] = [
  {
    key: 'global_checkout_enabled',
    value: true,
    descriptionAr: 'تفعيل الطلبات على مستوى المنصة بالكامل',
    isSensitive: true,
  },
  {
    key: 'platform_service_fee_iqd',
    value: 1000,
    descriptionAr: 'رسوم الخدمة التي يدفعها العميل لكل طلب',
    isSensitive: true,
  },
  {
    key: 'commission_flat_iqd',
    value: 500,
    descriptionAr: 'العمولة التي يتقاضاها جيبلي عن كل طلب (دينار عراقي)',
    isSensitive: true,
  },
  {
    key: 'default_settlement_policy',
    value: 'HALF_MONTH',
    descriptionAr: 'دورة التسوية الافتراضية',
  },
  {
    key: 'default_payment_term_days',
    value: 7,
    descriptionAr: 'مهلة السداد بالأيام بعد إصدار كشف العمولة',
  },
  {
    key: 'delivery_pin_enabled',
    value: true,
    descriptionAr: 'طلب رمز التسليم من العميل عند تسليم الطلب',
  },
  {
    key: 'order_acceptance_timeout_minutes',
    value: 10,
    descriptionAr: 'المدة قبل تنبيه الطلب غير المقبول',
  },
  {
    key: 'minimum_app_version',
    value: '1.0.0',
    descriptionAr: 'أقل إصدار مدعوم من التطبيق',
  },
  {
    key: 'latest_app_version',
    value: '1.0.0',
    descriptionAr: 'أحدث إصدار متاح من التطبيق',
  },
  {
    key: 'support_phone',
    value: '+9647700000000',
    descriptionAr: 'رقم الدعم الفني الظاهر في التطبيق',
  },
  {
    key: 'max_active_deliveries_per_driver',
    value: 1,
    descriptionAr: 'عدد طلبات التوصيل النشطة المسموح بها لكل سائق',
  },
];

export async function seedPlatformConfig(
  db: Database,
): Promise<{ inserted: number; existing: number }> {
  let inserted = 0;
  let existing = 0;

  for (const entry of DEFAULTS) {
    const found = await db
      .select({ key: platformConfig.key })
      .from(platformConfig)
      .where(eq(platformConfig.key, entry.key))
      .limit(1);

    if (found.length > 0) {
      existing += 1;
      continue;
    }

    await db.insert(platformConfig).values({
      id: uuidv7(),
      key: entry.key,
      value: entry.value,
      descriptionAr: entry.descriptionAr,
      isSensitive: entry.isSensitive ?? false,
    });
    inserted += 1;
  }

  return { inserted, existing };
}
