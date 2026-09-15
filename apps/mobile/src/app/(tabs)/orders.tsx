import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatIqdArabic, iqd } from '@jibli/money';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@jibli/contracts';
import { api, ApiError } from '@/lib/api';
import { useIsGuest } from '@/lib/session';
import { color, palette, radius, shadow, space, TAP_TARGET } from '@/theme';
import { Badge, EmptyState, ErrorState, Ltr, Row, Screen, Skeleton, Text } from '@/ui';
import { Enter } from '@/ui/enter';
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

  /*
   * Which orders are still open for a rating, and for how much longer.
   *
   * The server owns both boundaries — fifteen minutes after delivery, five
   * days from it — and returns exactly the orders inside them. Keyed by id so
   * each card can ask about itself, rather than the whole list being
   * summarised in one banner at the top that says nothing about which order it
   * means.
   */
  const openForReview = new Map(
    (pending.data ?? []).map((entry) => [entry.order_id, entry] as const),
  );

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
              (orders.data ?? []).map((order, index) => {
                const reviewable = openForReview.get(order.id);

                return (
                  <Enter key={order.id} delay={Math.min(index, 4) * 50}>
                    <View
                      style={{
                        borderRadius: radius.xl,
                        backgroundColor: color.surfaceCard,
                        overflow: 'hidden',
                        ...shadow.sm,
                      }}
                    >
                      <Pressable
                        onPress={() => router.push(`/order/${order.id}`)}
                        accessibilityRole="button"
                        accessibilityLabel={`طلب من ${order.restaurant_name ?? 'مطعم'}`}
                        style={({ pressed }) => [
                          { padding: space[4], gap: space[3] },
                          pressed ? { backgroundColor: color.surfaceSunken } : null,
                        ]}
                      >
                        <Row justify="space-between" align="flex-start">
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text variant="bodyBold" numberOfLines={1}>
                              {order.restaurant_name ?? 'مطعم'}
                            </Text>
                            <Text variant="caption" tone="muted">
                              {formatOrderDate(order.placed_at)}
                            </Text>
                          </View>
                          <Badge
                            label={ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
                            tone={toneFor(order.status)}
                          />
                        </Row>

                        <Row justify="space-between" align="center">
                          {/* The order number is Latin inside Arabic: without
                              isolation the digits come out reversed. */}
                          <Ltr variant="caption" tone="muted">
                            #{order.public_order_number}
                          </Ltr>
                          <Text variant="h3">{formatIqdArabic(iqd(order.customer_total_iqd))}</Text>
                        </Row>
                      </Pressable>

                      {/*
                       * The rating, attached to the order it is about.
                       *
                       * It used to be a separate banner above the list — «كيف
                       * كان طلبك من X؟» floating over a list containing three
                       * orders from X. Here the question and its subject are
                       * the same card, and the days left are stated, because
                       * a window that closes silently is one a customer finds
                       * out about by tapping.
                       */}
                      {reviewable ? (
                        <Pressable
                          onPress={() =>
                            setRating({
                              orderId: order.id,
                              restaurantName: reviewable.restaurant_name,
                            })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`قيّم طلبك من ${reviewable.restaurant_name}`}
                          style={({ pressed }) => [
                            {
                              minHeight: TAP_TARGET,
                              paddingHorizontal: space[4],
                              paddingVertical: space[3],
                              backgroundColor: color.warningSoft,
                              borderTopWidth: 1,
                              borderTopColor: palette.warning[500] + '33',
                              justifyContent: 'center',
                            },
                            pressed ? { opacity: 0.75 } : null,
                          ]}
                        >
                          <Row gap={space[2]} align="center">
                            <MaterialCommunityIcons
                              name="star-outline"
                              size={20}
                              color={palette.warning[700]}
                            />
                            <View style={{ flex: 1 }}>
                              <Text variant="smallBold" style={{ color: palette.warning[700] }}>
                                كيف كان طلبك؟
                              </Text>
                              <Text variant="caption" style={{ color: palette.warning[700] }}>
                                {daysLeftLabel(reviewable.completed_at)}
                              </Text>
                            </View>
                            <Text variant="smallBold" tone="brand">
                              قيّم
                            </Text>
                          </Row>
                        </Pressable>
                      ) : null}
                    </View>
                  </Enter>
                );
              })
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

/** How long the rating window stays open, mirrored from the server's own rule. */
const REVIEW_WINDOW_DAYS = 5;

/**
 * What is left of the rating window, in words.
 *
 * Stated rather than counted down to the minute: a customer deciding whether
 * to rate now needs to know it will still be there tomorrow, not that it
 * expires in 71 hours. The server remains the authority — this only describes
 * a window it has already said is open.
 */
function daysLeftLabel(completedAt: string): string {
  const closesAt = new Date(completedAt).getTime() + REVIEW_WINDOW_DAYS * 86_400_000;
  const hoursLeft = Math.max(0, Math.ceil((closesAt - Date.now()) / 3_600_000));

  if (hoursLeft <= 1) return 'تبقّت أقل من ساعة للتقييم';
  if (hoursLeft <= 24) return `تبقّت ${hoursLeft} ساعة للتقييم`;

  const daysLeft = Math.ceil(hoursLeft / 24);
  if (daysLeft === 1) return 'يبقى التقييم متاحاً ليوم واحد';
  if (daysLeft === 2) return 'يبقى التقييم متاحاً ليومين';
  return `يبقى التقييم متاحاً ${daysLeft} أيام`;
}

/**
 * The day the order was placed, the way a person would say it.
 *
 * A timestamp is not what a customer is scanning a list for — they are looking
 * for "the one from yesterday", so that is what it says.
 */
function formatOrderDate(placedAt: string): string {
  const placed = new Date(placedAt);
  const days = Math.floor((Date.now() - placed.getTime()) / 86_400_000);

  if (days === 0) return 'اليوم';
  if (days === 1) return 'أمس';
  if (days < 7) return `قبل ${days} أيام`;

  // Arabic-Indic digits come from the locale, which is what the rest of the
  // app shows.
  return placed.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long' });
}

/** Live, finished, or stopped — the three things a customer needs to tell apart. */
function toneFor(status: string): 'success' | 'danger' | 'brand' | 'neutral' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'CANCELLED' || status === 'REJECTED') return 'danger';
  if (status === 'PENDING_RESTAURANT') return 'neutral';
  return 'brand';
}
