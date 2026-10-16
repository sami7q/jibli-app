'use client';

import { Suspense } from 'react';
import { OrderListScreen } from '@/components/order-list-screen';

/** All orders across the platform. Live and cancelled are sibling routes. */
export default function OrdersPage() {
  // OrderListScreen reads `?q=` with useSearchParams (ADMIN-18); Next requires a
  // Suspense boundary around that for static generation.
  return (
    <Suspense fallback={null}>
      <OrderListScreen scope="all" title="جميع الطلبات" />
    </Suspense>
  );
}
