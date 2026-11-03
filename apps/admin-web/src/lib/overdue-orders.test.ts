import { describe, expect, it } from 'vitest';
import type { AdminOrder } from './admin-endpoints';
import { overdueOrders } from './overdue-orders';

const now = Date.parse('2026-11-03T18:00:00Z');

function order(id: string, status: string, minutesAgo: number): AdminOrder {
  return {
    id,
    public_order_number: id,
    status,
    payment_status: 'PENDING',
    customer_total_iqd: 10_000,
    commission_amount_iqd: 0,
    placed_at: new Date(now - minutesAgo * 60_000).toISOString(),
    completed_at: null,
    customer_name: 'زبون',
    customer_phone: '+9647700000000',
    phone_masked: false,
    restaurant_id: 'r',
    restaurant_name: 'مطعم',
    city_name_ar: 'حديثة',
    driver_name: null,
  };
}

describe('overdueOrders', () => {
  it('lists orders still waiting on the shop after three minutes, longest first', () => {
    const result = overdueOrders(
      [
        order('fresh', 'PENDING_RESTAURANT', 2),
        order('late', 'PENDING_RESTAURANT', 4),
        order('later', 'PLACED', 9),
        order('accepted', 'ACCEPTED', 20),
      ],
      now,
    );
    expect(result.map((entry) => entry.order.id)).toEqual(['later', 'late']);
    expect(result[0]?.waitingMinutes).toBe(9);
  });

  it('is empty when every waiting order is under the deadline', () => {
    expect(overdueOrders([order('a', 'PENDING_RESTAURANT', 1)], now)).toEqual([]);
  });
});
