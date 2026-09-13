import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { formatIqdArabic, iqd } from '@jibli/money';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@jibli/contracts';
import { api, ApiError } from '@/lib/api';
import { useIsGuest } from '@/lib/session';
import { color, radius, space, TAP_TARGET } from '@/theme';
import { Badge, EmptyState, ErrorState, Ltr, Row, Screen, Skeleton, Text } from '@/ui';
import { RateOrderSheet } from '@/ui/rate-order';

/**
 * My orders.
 *
 * Polled while the screen is open rather than pushed: the realtime channel
 * exists for the restaurant board, where seconds matter, and a customer
 * watching their own order is well served by a refresh every half minute at a
 * fraction of the battery.
 */
export default function OrdersScreen() {
  const router = useRouter();
  const isGuest = useIsGuest();
  const [rating, setRating] = useState<{ orderId: string; restaurantName: string } | null>(null);

  const orders = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => api.myOrders(),
    enabled: !isGuest,
    refetchInterval: 30_000,
  });

  /*
   * The rating prompt the plan asks for: a quarter of an hour after delivery,
   * not the second the driver walks away. The server decides when the window
   * opens; this only shows what it returns.
   */
  const pending = useQuery({
    queryKey: ['pending-reviews'],
    queryFn: () => api.pendingReviews(),
    enabled: !isGuest,
    staleTime: 60_000,
  });

  return (
    <Screen scroll edges={['top']} padded={false}>
      <View style={{ paddingHorizontal: space[4], paddingTop: space[2] }}>
        <Text variant="h2">طلباتي</Text>
      </View>

      <View style={{ padding: space[4], gap: space[3] }}>
        {isGuest ? (
          <EmptyState
            title="سجّل دخولك لمتابعة طلباتك"
            body="ستتابع كل طلب خطوة بخطوة من هنا."
            action={{ label: 'تسجيل الدخول', onPress: () => router.push('/(auth)/phone') }}
          />
        ) : (
          <>
            {(pending.data ?? []).map((entry) => (
              <Pressable
                key={entry.order_id}
                onPress={() =>
                  setRating({ orderId: entry.order_id, restaurantName: entry.restaurant_name })
                }
                accessibilityRole="button"
                accessibilityLabel={`قيّم طلبك من ${entry.restaurant_name}`}
                style={({ pressed }) => [
                  {
                    minHeight: TAP_TARGET + 8,
                    padding: space[3],
                    borderRadius: radius.lg,
                    backgroundColor: color.warningSoft,
                    justifyContent: 'center',
                  },
                  pressed ? { opacity: 0.8 } : null,
                ]}
              >
                <Row gap={space[2]}>
                  <MaterialCommunityIcons name="star-outline" size={20} color={color.warning} />
                  <Text variant="small" style={{ flex: 1 }}>
                    كيف كان طلبك من {entry.restaurant_name}؟
                  </Text>
                  <Text variant="smallBold" tone="brand">
                    قيّم
                  </Text>
                </Row>
              </Pressable>
            ))}

            {orders.isError ? (
              <ErrorState
                message={
                  orders.error instanceof ApiError ? orders.error.messageAr : 'تعذّر تحميل طلباتك'
                }
                onRetry={() => void orders.refetch()}
              />
            ) : orders.isLoading ? (
              <>
                <Skeleton height={92} style={{ borderRadius: radius.lg }} />
                <Skeleton height={92} style={{ borderRadius: radius.lg }} />
              </>
            ) : (orders.data ?? []).length === 0 ? (
              <EmptyState
                title="لا توجد طلبات بعد"
                body="عندما تطلب، ستتابع حالة الطلب من هنا خطوة بخطوة."
                action={{ label: 'تصفّح المطاعم', onPress: () => router.push('/(tabs)') }}
              />
            ) : (
              (orders.data ?? []).map((order) => (
                <Pressable
                  key={order.id}
                  onPress={() => router.push(`/order/${order.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`طلب من ${order.restaurant_name ?? 'مطعم'}`}
                  style={({ pressed }) => [
                    {
                      padding: space[4],
                      borderRadius: radius.lg,
                      backgroundColor: color.surfaceCard,
                      borderWidth: 1,
                      borderColor: color.borderSubtle,
                      gap: space[2],
                    },
                    pressed ? { opacity: 0.85 } : null,
                  ]}
                >
                  <Row justify="space-between">
                    <Text variant="bodyBold" numberOfLines={1} style={{ flex: 1 }}>
                      {order.restaurant_name ?? 'مطعم'}
                    </Text>
                    <Badge
                      label={ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
                      tone={toneFor(order.status)}
                    />
                  </Row>

                  <Row justify="space-between">
                    {/* The order number is Latin inside Arabic: without
                        isolation the digits come out reversed. */}
                    <Ltr variant="caption" tone="muted">
                      #{order.public_order_number}
                    </Ltr>
                    <Text variant="bodyBold">
                      {formatIqdArabic(iqd(order.customer_total_iqd))}
                    </Text>
                  </Row>
                </Pressable>
              ))
            )}
          </>
        )}
      </View>

      {rating ? (
        <RateOrderSheet
          visible
          orderId={rating.orderId}
          restaurantName={rating.restaurantName}
          onClose={() => setRating(null)}
          onSubmitted={() => {
            setRating(null);
            void pending.refetch();
          }}
        />
      ) : null}
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
