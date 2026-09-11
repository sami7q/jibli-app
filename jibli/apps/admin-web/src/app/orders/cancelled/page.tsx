'use client';

import { OrderListScreen } from '@/components/order-list-screen';

/**
 * `الطلبات الملغاة` (plan §130).
 *
 * Cancellations and rejections together: from an operations standpoint both are
 * an order that did not reach the customer, and the reason matters more than
 * which side ended it.
 */
export default function CancelledOrdersPage() {
  return (
    <OrderListScreen
      scope="cancelled"
      title="الطلبات الملغاة"
      subtitle="الطلبات الملغاة والمرفوضة — راجع الأسباب لرصد مشاكل متكررة"
    />
  );
}
