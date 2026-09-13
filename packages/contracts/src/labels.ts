import type { DeliveryAssignmentStatus, OrderStatus } from './enums.js';

/**
 * Arabic labels for the states more than one surface shows (plan Appendix A).
 *
 * These lived in `@jibli/ui-web`, which imports React DOM — so the mobile app
 * could not read them, and the first phone screen that needed an order status
 * was about to write its own Arabic for the same ten states. Two translations
 * of one enum is how a customer reads "قيد التوصيل" on the phone and something
 * else in a message about the same order.
 *
 * Only the genuinely cross-surface maps moved here. Settlement statuses,
 * platform roles, coupon wording and the navigation labels stayed in `ui-web`:
 * they have exactly one consumer, and a label with one reader belongs next to
 * that reader rather than in a shared package nobody else imports.
 *
 * Release 1 is Arabic-only, but keeping the strings in a map rather than inline
 * means adding Kurdish or English later is a data change, not a rewrite of
 * every screen (plan §2).
 */

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PLACED: 'تم إرسال الطلب',
  PENDING_RESTAURANT: 'طلب جديد',
  ACCEPTED: 'تم قبول الطلب',
  PREPARING: 'قيد التحضير',
  READY: 'جاهز',
  OUT_FOR_DELIVERY: 'قيد التوصيل',
  DELIVERED: 'تم التسليم',
  COMPLETED: 'مكتمل',
  REJECTED: 'مرفوض',
  CANCELLED: 'ملغي',
};

/**
 * Status tone for badges.
 *
 * Colour is always supplementary: the label carries the meaning, so a
 * colour-blind user loses nothing (plan §29, §134).
 */
export const ORDER_STATUS_TONE: Record<
  OrderStatus,
  'new' | 'progress' | 'ready' | 'done' | 'failed'
> = {
  PLACED: 'new',
  PENDING_RESTAURANT: 'new',
  ACCEPTED: 'progress',
  PREPARING: 'progress',
  READY: 'ready',
  OUT_FOR_DELIVERY: 'progress',
  DELIVERED: 'done',
  COMPLETED: 'done',
  REJECTED: 'failed',
  CANCELLED: 'failed',
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryAssignmentStatus, string> = {
  ASSIGNED: 'تم التعيين',
  ACCEPTED: 'قبل المندوب',
  REJECTED: 'رفض المندوب',
  PICKED_UP: 'استلم الطلب',
  ARRIVED_CUSTOMER: 'وصل إلى العميل',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
  REASSIGNED: 'تم إعادة التعيين',
};
