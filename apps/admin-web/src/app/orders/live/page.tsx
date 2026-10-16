'use client';

import { Suspense } from 'react';
import { OrderListScreen } from '@/components/order-list-screen';

/**
 * `الطلبات الحية` (plan §130).
 *
 * The same table as the full list, scoped to non-terminal statuses and polled,
 * so an operator watching a busy evening sees movement without reloading.
 */
export default function LiveOrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrderListScreen
        scope="live"
        title="الطلبات الحية"
        subtitle="الطلبات النشطة الآن عبر جميع المطاعم — يتم التحديث تلقائياً"
      />
    </Suspense>
  );
}
