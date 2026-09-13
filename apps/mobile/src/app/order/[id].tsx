import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@jibli/contracts';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError } from '@/lib/api';
import { color, palette, radius, space, TAP_TARGET } from '@/theme';
import { Button, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';
import { DriverCard, StatusTimeline, SummaryRow, type TimelineStep } from '@/ui/catalog';
import { RateOrderSheet } from '@/ui/rate-order';

/**
 * The order, from placed to delivered (`7.html` and `8.html`).
 *
 * One screen, not two. Both comps are the same order: 7 shows the status
 * timeline, 8 shows it while a driver is carrying it. Building them as two
 * routes would mean two screens reading the same order and disagreeing about
 * it the moment a status changed — so the driver card simply appears when
 * there is a driver.
 *
 * Every status on this screen was set by the restaurant on its own order board
 * or by the driver in Driver Mode. Nothing here is polled from a guess.
 */

/** The journey, in the order it happens. Terminal states are handled apart. */
const JOURNEY: OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

/** Statuses the customer may still cancel from; the server decides finally. */
const CANCELLABLE: OrderStatus[] = ['PLACED', 'PENDING_RESTAURANT'];

const LIVE: OrderStatus[] = [
  'PLACED',
  'PENDING_RESTAURANT',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
];

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(false);

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.order(id),
    enabled: Boolean(id),
    /*
     * Polled only while the order is moving.
     *
     * A delivered order never changes again, and a screen left open on one
     * would otherwise keep a phone's radio awake for nothing. Push notifications
     * carry the important transitions; this is what keeps the screen honest
     * while someone is actually watching it.
     */
    refetchInterval: (query) =>
      query.state.data && LIVE.includes(query.state.data.status) ? 20_000 : false,
  });

  const eligibility = useQuery({
    queryKey: ['review-eligibility', id],
    queryFn: () => api.reviewEligibility(id),
    enabled: Boolean(id) && Boolean(order.data) && order.data?.status === 'COMPLETED',
  });

  const cancel = useMutation({
    mutationFn: () => api.cancelOrder(id, 'CUSTOMER_CHANGED_MIND'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['order', id] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error) =>
      Alert.alert(
        'تعذّر الإلغاء',
        error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى.',
      ),
  });

  const steps = useMemo<TimelineStep[]>(() => {
    const data = order.data;
    if (!data) return [];

    const reachedAt = new Map(data.timeline.map((entry) => [entry.status, entry.at]));

    // A cancelled or rejected order did not continue down the journey, so
    // showing the remaining steps as "pending" would be a lie about a thing
    // that is over.
    if (data.status === 'CANCELLED' || data.status === 'REJECTED') {
      return [
        {
          label: ORDER_STATUS_LABELS.PLACED,
          at: formatTime(reachedAt.get('PLACED') ?? data.placed_at),
          state: 'done',
        },
        {
          label: ORDER_STATUS_LABELS[data.status],
          at: formatTime(reachedAt.get(data.status) ?? null),
          state: 'current',
        },
      ];
    }

    const current = data.status === 'COMPLETED' ? 'DELIVERED' : data.status;
    const currentIndex = JOURNEY.indexOf(current as OrderStatus);

    return JOURNEY.map((status, index) => ({
      label: ORDER_STATUS_LABELS[status],
      at: formatTime(reachedAt.get(status) ?? (status === 'PLACED' ? data.placed_at : null)),
      state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending',
    }));
  }, [order.data]);

  if (order.isLoading) {
    return (
      <Screen edges={['top']}>
        <Skeleton height={120} style={{ borderRadius: radius.lg }} />
        <View style={{ height: space[4] }} />
        <Skeleton height={240} style={{ borderRadius: radius.lg }} />
      </Screen>
    );
  }

  if (order.isError || !order.data) {
    return (
      <Screen edges={['top']}>
        <ErrorState
          message={order.error instanceof ApiError ? order.error.messageAr : 'تعذّر تحميل الطلب'}
          onRetry={() => void order.refetch()}
        />
      </Screen>
    );
  }

  const data = order.data;
  const restaurantName =
    typeof data.restaurant?.name_ar === 'string' ? data.restaurant.name_ar : 'المطعم';

  return (
    <Screen edges={['top']} padded={false}>
      <Row justify="space-between" style={{ paddingHorizontal: space[4], minHeight: TAP_TARGET }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/orders'))}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          style={{ width: TAP_TARGET, height: TAP_TARGET, justifyContent: 'center' }}
        >
          <MaterialCommunityIcons name="chevron-right" size={26} color={color.textPrimary} />
        </Pressable>
        <Text variant="h3">تفاصيل الطلب</Text>
        <View style={{ width: TAP_TARGET }} />
      </Row>

      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        showsVerticalScrollIndicator={false}
      >
        <StatusBanner status={data.status} etaMinutes={data.estimated_preparation_minutes} />

        {/*
         * The driver card is the whole difference between comp 7 and comp 8,
         * and it appears for the same reason the server sends it: there is
         * somebody carrying the order now, and the customer may need to reach
         * them.
         */}
        {data.driver ? (
          <DriverCard
            name={data.driver.first_name || 'المندوب'}
            phone={data.driver.phone}
            etaMinutes={null}
            {...(data.driver.phone
              ? { onCall: () => void Linking.openURL(`tel:${data.driver?.phone ?? ''}`) }
              : {})}
          />
        ) : null}

        <Card>
          <Row justify="space-between">
            <View>
              <Text variant="smallBold">{restaurantName}</Text>
              <Text variant="caption" tone="muted">
                طلب رقم {data.public_order_number}
              </Text>
            </View>
            <Text variant="caption" tone="muted">
              {formatTime(data.placed_at)}
            </Text>
          </Row>
        </Card>

        <Card>
          <Text variant="smallBold" style={{ marginBottom: space[3] }}>
            حالة الطلب
          </Text>
          <StatusTimeline steps={steps} />
        </Card>

        <Card>
          <Text variant="smallBold" style={{ marginBottom: space[2] }}>
            الأصناف
          </Text>
          <View style={{ gap: space[2] }}>
            {data.items.map((item) => (
              <View key={item.id}>
                <Row justify="space-between">
                  <Text variant="small" style={{ flex: 1 }} numberOfLines={1}>
                    {item.quantity} × {item.name_ar}
                  </Text>
                  <Text variant="smallBold">{formatIqdArabic(iqd(item.line_total_iqd))}</Text>
                </Row>
                {item.modifiers.length > 0 ? (
                  <Text variant="caption" tone="muted">
                    {item.modifiers.map((modifier) => modifier.name_ar).join('، ')}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </Card>

        <Card>
          <SummaryRow
            label="المجموع الفرعي"
            value={formatIqdArabic(iqd(data.items_subtotal_iqd))}
          />
          {data.discount_total_iqd > 0 ? (
            <SummaryRow
              label="الخصم"
              value={`− ${formatIqdArabic(iqd(data.discount_total_iqd))}`}
              tone="success"
            />
          ) : null}
          <SummaryRow
            label="رسوم التوصيل"
            value={
              data.delivery_fee_iqd === 0 ? 'مجاناً' : formatIqdArabic(iqd(data.delivery_fee_iqd))
            }
          />
          {data.platform_service_fee_iqd > 0 ? (
            <SummaryRow
              label="رسوم الخدمة"
              value={formatIqdArabic(iqd(data.platform_service_fee_iqd))}
            />
          ) : null}
          <SummaryRow
            label="الإجمالي"
            value={formatIqdArabic(iqd(data.customer_total_iqd))}
            emphasis
          />
          <Text variant="caption" tone="muted">
            الدفع نقداً عند الاستلام
          </Text>
        </Card>

        {/*
         * Rating opens a quarter of an hour after delivery, which the server
         * decides — long enough that the customer has actually eaten, and the
         * same window the Admin settings control.
         */}
        {eligibility.data?.can_review ? (
          <Button label="قيّم الطلب" block onPress={() => setRating(true)} />
        ) : eligibility.data?.already_reviewed ? (
          <Row gap={space[2]} justify="center">
            <MaterialCommunityIcons name="check-circle" size={18} color={color.success} />
            <Text variant="caption" tone="success">
              شكراً، تم تسجيل تقييمك
            </Text>
          </Row>
        ) : null}

        {CANCELLABLE.includes(data.status) ? (
          <Button
            label="إلغاء الطلب"
            variant="danger"
            block
            loading={cancel.isPending}
            onPress={() =>
              Alert.alert('إلغاء الطلب', 'هل تريد إلغاء هذا الطلب؟', [
                { text: 'تراجع', style: 'cancel' },
                { text: 'إلغاء الطلب', style: 'destructive', onPress: () => cancel.mutate() },
              ])
            }
          />
        ) : null}
      </ScrollView>

      <RateOrderSheet
        visible={rating}
        orderId={id}
        restaurantName={restaurantName}
        onClose={() => setRating(false)}
        onSubmitted={() => {
          setRating(false);
          void eligibility.refetch();
        }}
      />
    </Screen>
  );
}

function StatusBanner({ status, etaMinutes }: { status: OrderStatus; etaMinutes: number }) {
  const failed = status === 'CANCELLED' || status === 'REJECTED';
  const done = status === 'DELIVERED' || status === 'COMPLETED';

  return (
    <View
      style={{
        padding: space[4],
        borderRadius: radius.lg,
        backgroundColor: failed
          ? color.dangerSoft
          : done
            ? color.successSoft
            : color.brandSoft,
        gap: space[1],
      }}
    >
      <Row gap={space[2]}>
        <MaterialCommunityIcons
          name={failed ? 'close-circle' : done ? 'check-circle' : 'clock-outline'}
          size={20}
          color={failed ? palette.danger[500] : done ? palette.success[500] : color.brand}
        />
        <Text variant="bodyBold" tone={failed ? 'danger' : done ? 'success' : 'brand'}>
          {ORDER_STATUS_LABELS[status]}
        </Text>
      </Row>

      {!failed && !done ? (
        <Text variant="caption" tone="secondary">
          الوصول المتوقع خلال {etaMinutes} دقيقة تقريباً
        </Text>
      ) : null}
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        padding: space[4],
        borderRadius: radius.lg,
        backgroundColor: color.surfaceCard,
        borderWidth: 1,
        borderColor: color.borderSubtle,
        gap: space[2],
      }}
    >
      {children}
    </View>
  );
}

/** Baghdad time, 24-hour, Western digits — the same clock the restaurant uses. */
function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Baghdad',
    }).format(new Date(iso));
  } catch {
    return null;
  }
}
