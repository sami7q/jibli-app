import { AUDIT_ACTION_LABELS } from '@jibli/ui-web';

/**
 * Admin-local audit labels (ADMIN-23).
 *
 * `AUDIT_ACTION_LABELS` lives in `packages/ui-web`, owned by another stream, and
 * is missing nine action codes the audit feed can show — they rendered as raw
 * dotted keys («banner.create», «review.hide»…). Rather than edit that package,
 * this overlay fills the gap for the admin portal and is spread over the shared
 * map so a code that gains a label upstream still wins here.
 */
const ADMIN_OVERRIDES: Record<string, string> = {
  'banner.create': 'إنشاء بنر',
  'banner.update': 'تعديل بنر',
  'banner.delete': 'حذف بنر',
  'category.create': 'إنشاء تصنيف',
  'category.update': 'تعديل تصنيف',
  'category.delete': 'حذف تصنيف',
  'driver.activate': 'تفعيل مندوب',
  'driver.credentials': 'تحديث بيانات مندوب',
  'review.hide': 'إخفاء تقييم',
  'review.reports.resolve': 'معالجة بلاغات تقييم',
};

/** The shared map with the admin-local gaps filled. */
export const ADMIN_AUDIT_ACTION_LABELS: Record<string, string> = {
  ...ADMIN_OVERRIDES,
  ...AUDIT_ACTION_LABELS,
};

/** Arabic names for the entity types an audit row can reference (ADMIN-23). */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  governorate: 'محافظة',
  city: 'مدينة',
  restaurant: 'متجر',
  restaurant_application: 'طلب انضمام',
  settlement: 'تسوية',
  order: 'طلب',
  driver: 'سائق',
  user: 'مستخدم',
  platform_config: 'إعداد',
  banner: 'بنر',
  category: 'تصنيف',
  review: 'تقييم',
  support_thread: 'محادثة دعم',
  coupon: 'كوبون',
};
