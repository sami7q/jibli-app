import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { formatIqdArabic, iqd } from '@jibli/money';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@jibli/contracts';
import { api, ApiError } from '@/lib/api';
import { radius, space } from '@/theme';
import { Badge, Card, EmptyState, ErrorState, Ltr, Row, Screen, Skeleton, Text } from '@/ui';

/**
 * My orders.
 *
 * Polled while the screen is open rather than pushed: the realtime channel
 * exists for the restaurant board, where seconds matter, and a customer
 * watching their own order is well served by a refresh every half minute at a
 * fraction of the battery.
 */
export default function OrdersScreen() {
  const orders = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => api.myOrders(),
    refetchInterval: 30_000,
  });

  return (
    <Screen scroll edges={['top']}>
      <Text variant="h2" style={{ marginBottom: space[3] }}>
        طلباتي
      </Text>

      {orders.isError ? (
        <ErrorState
          message={orders.error instanceof ApiError ? orders.error.messageAr : 'تعذّر تحميل طلباتك'}
          onRetry={() => void orders.refetch()}
        />
      ) : orders.isLoading ? (
        <View style={{ gap: space[3] }}>
          <Skeleton height={78} style={{ borderRadius: radius.lg }} />
          <Skeleton height={78} style={{ borderRadius: radius.lg }} />
        </View>
      ) : (orders.data ?? []).length === 0 ? (
        <EmptyState
          title="لا توجد طلبات بعد"
          body="عندما تطلب، ستتابع حالة الطلب من هنا خطوة بخطوة."
        />
      ) : (
        <View style={{ gap: space[3] }}>
          {(orders.data ?? []).map((order) => (
            <Card key={order.id}>
              <Row justify="space-between">
                <Text variant="bodyBold" numberOfLines={1} style={{ flex: 1 }}>
                  {order.restaurant_name ?? 'مطعم'}
                </Text>
                <Badge
                  label={ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
                  tone={toneFor(order.status)}
                />
              </Row>

              <Row justify="space-between" style={{ marginTop: space[2] }}>
                {/* The order number is Latin inside Arabic: without isolation
                    the digits come out reversed. */}
                <Ltr variant="caption" tone="muted">
                  #{order.public_order_number}
                </Ltr>
                <Text variant="bodyBold">{formatIqdArabic(iqd(order.customer_total_iqd))}</Text>
              </Row>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

/** Live, finished, or stopped — the three things a customer needs to tell apart. */
function toneFor(status: string): 'success' | 'danger' | 'brand' | 'neutral' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'CANCELLED' || status === 'REJECTED') return 'danger';
  if (status === 'PENDING_RESTAURANT') return 'neutral';
  return 'brand';
}
