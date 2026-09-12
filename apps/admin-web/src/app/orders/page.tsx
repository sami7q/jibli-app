'use client';

import { OrderListScreen } from '@/components/order-list-screen';

/** All orders across the platform. Live and cancelled are sibling routes. */
export default function OrdersPage() {
  return <OrderListScreen scope="all" title="جميع الطلبات" />;
}
