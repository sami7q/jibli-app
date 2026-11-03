'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { overdueOrders } from '@/lib/overdue-orders';
import { useLiveOrders } from '@/lib/use-live-orders';
import { Icon } from './icon';

/**
 * «لم يُقبل بعد» — orders a shop has left waiting for three minutes or more.
 *
 * Shown above every admin screen, not only «الطلبات الحية», because the one
 * case it exists for is the shop's phone not ringing: the push never arrived,
 * notifications are off, or the phone is in a drawer. Each row gives the
 * shop's number to call and a link to the order.
 */
export function OverdueOrdersAlert({ token }: { token: string }) {
  const live = useLiveOrders(token);
  const [now, setNow] = useState(() => Date.now());

  // The wait keeps growing between polls; the minutes shown should too.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const overdue = overdueOrders(live.data?.data ?? [], now);
  if (overdue.length === 0) return null;

  return (
    <section className="overdue-alert" role="alert" aria-live="assertive">
      <div className="overdue-alert__head">
        <Icon name="bell" className="nav__icon" aria-hidden />
        <strong>
          {overdue.length === 1
            ? 'طلب لم يقبله المتجر منذ أكثر من ٣ دقائق'
            : `${overdue.length} طلبات لم يقبلها المتجر منذ أكثر من ٣ دقائق`}
        </strong>
        <span>اتصل بالمتجر للتأكد من وصول الطلب.</span>
      </div>
      <ul className="overdue-alert__list">
        {overdue.map(({ order, waitingMinutes }) => (
          <li key={order.id}>
            <Link href={`/orders/${order.id}`}>#{order.public_order_number}</Link>
            <span>{order.restaurant_name}</span>
            <span>منذ {waitingMinutes} دقيقة</span>
            {order.restaurant_phone ? (
              <a className="ltr-inline" href={`tel:${order.restaurant_phone}`}>
                {order.restaurant_phone}
              </a>
            ) : (
              <span className="overdue-alert__muted">لا يوجد رقم للمتجر</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
