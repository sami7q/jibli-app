import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIqdArabic, iqd } from '@jibli/money';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@jibli/contracts';
import MaterialCommunityIcons from '@/ui/icon';
import {
  api,
  ApiError,
  type OwnerLiveOrder,
  type OwnerRejectReason,
} from '@/lib/api';
import { useOwner } from '@/lib/owner';
import { BRAND, color, radius, ROW, space, TAP_TARGET } from '@/theme';
import { Button, EmptyState, ErrorState, Ltr, Row, Screen, Skeleton, Text } from '@/ui';
import { OwnerHeader } from './index';

/**
 * Orders, from the phone — the shop's live board.
 *
 * Owner Mode was the menu and nothing else, so a shopkeeper away from the
 * counter could price a product but not see that a customer was waiting for
 * an answer. This is the web portal's live board: the same endpoints, the same
 * commands, the same optimistic-concurrency version on each one — so a phone
 * and the shop's laptop cannot both accept the same order, and whichever is
 * second is told so and reloads.
 *
 * Lanes rather than one long list, because the question at each moment is
 * «what needs me now?», and the answer is almost always the first lane.
 */

type Lane = 'new' | 'kitchen' | 'ready' | 'road' | 'done';

const LANES: { key: Lane; label: string; statuses: readonly OrderStatus[] }[] = [
  { key: 'new', label: 'جديدة', statuses: ['PENDING_RESTAURANT'] },
  { key: 'kitchen', label: 'في المطبخ', statuses: ['ACCEPTED', 'PREPARING'] },
  { key: 'ready', label: 'جاهزة', statuses: ['READY'] },
  { key: 'road', label: 'في الطريق', statuses: ['OUT_FOR_DELIVERY'] },
  { key: 'done', label: 'مكتملة', statuses: ['DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED'] },
];

const REJECT_REASONS: { value: OwnerRejectReason; label: string }[] = [
  { value: 'ITEM_UNAVAILABLE', label: 'صنف غير متوفر' },
  { value: 'TOO_BUSY', label: 'ضغط كبير الآن' },
  { value: 'CLOSING', label: 'المتجر يغلق' },
  { value: 'ADDRESS_ISSUE', label: 'مشكلة في العنوان' },
  { value: 'CUSTOMER_UNREACHABLE', label: 'تعذّر الوصول للعميل' },
  { value: 'OTHER', label: 'سبب آخر' },
];

const money = (value: number) => formatIqdArabic(iqd(value));

export default function OwnerOrdersScreen() {
  const owner = useOwner();
  const shop = owner.shop;
  const [lane, setLane] = useState<Lane>('new');

  const orders = useQuery({
    queryKey: ['owner-orders', shop?.id],
    queryFn: () => api.ownerLiveOrders(shop?.id as string),
    enabled: Boolean(shop?.id),
    /*
     * A new order waits on this screen for an answer, and the customer is
     * watching a spinner meanwhile. Fifteen seconds is the longest that wait
     * should be stretched by the phone not having looked yet.
     */
    refetchInterval: 15_000,
  });

  const byLane = useMemo(() => {
    const groups = new Map<Lane, OwnerLiveOrder[]>();
    for (const entry of LANES) groups.set(entry.key, []);
    for (const order of orders.data ?? []) {
      const match = LANES.find((entry) => entry.statuses.includes(order.status));
      if (match) groups.get(match.key)?.push(order);
    }
    // Oldest first where somebody is waiting; newest first once it is history.
    for (const [key, list] of groups) {
      list.sort((a, b) =>
        key === 'done'
          ? b.placed_at.localeCompare(a.placed_at)
          : a.placed_at.localeCompare(b.placed_at),
      );
    }
    return groups;
  }, [orders.data]);

  if (!shop) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="الطلبات" />
        <EmptyState title="لا يوجد متجر" body="سجّل الدخول بحساب متجر لرؤية طلباته." />
      </Screen>
    );
  }

  const visible = byLane.get(lane) ?? [];

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={{ paddingHorizontal: space[4] }}>
        <OwnerHeader title="الطلبات" />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: ROW,
          gap: space[2],
          paddingHorizontal: space[4],
          paddingBottom: space[3],
        }}
        style={{ flexGrow: 0 }}
      >
        {LANES.map((entry) => {
          const count = byLane.get(entry.key)?.length ?? 0;
          const chosen = entry.key === lane;
          // The first lane is the only one that means «someone is waiting».
          const urgent = entry.key === 'new' && count > 0;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setLane(entry.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: chosen }}
              style={{
                flexDirection: ROW,
                alignItems: 'center',
                gap: space[1],
                minHeight: TAP_TARGET - 4,
                paddingHorizontal: space[3],
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: chosen ? BRAND[500] : color.borderSubtle,
                backgroundColor: chosen ? BRAND[500] : color.surfaceCard,
              }}
            >
              <Text variant="smallBold" tone={chosen ? 'inverse' : 'primary'}>
                {entry.label}
              </Text>
              {count > 0 ? (
                <View
                  style={{
                    minWidth: 20,
                    height: 20,
                    paddingHorizontal: 5,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: chosen
                      ? 'rgba(255,255,255,0.3)'
                      : urgent
                        ? color.danger
                        : color.surfaceSunken,
                  }}
                >
                  <Text variant="captionBold" tone={chosen || urgent ? 'inverse' : 'primary'}>
                    {count}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {orders.isError ? (
        <View style={{ padding: space[4] }}>
          <ErrorState
            message={orders.error instanceof ApiError ? orders.error.messageAr : 'تعذّر تحميل الطلبات'}
            onRetry={() => void orders.refetch()}
          />
        </View>
      ) : orders.isLoading ? (
        <View style={{ padding: space[4], gap: space[3] }}>
          <Skeleton height={160} style={{ borderRadius: radius.lg }} />
          <Skeleton height={160} style={{ borderRadius: radius.lg }} />
        </View>
      ) : visible.length === 0 ? (
        <EmptyState
          title={lane === 'new' ? 'لا طلبات جديدة الآن' : 'لا شيء هنا'}
          body={
            lane === 'new'
              ? 'تتحدّث القائمة وحدها كل ١٥ ثانية. أبقِ الشاشة مفتوحة لتلتقط الطلب فور وصوله.'
              : 'تظهر الطلبات هنا حين تصل إلى هذه المرحلة.'
          }
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space[4], paddingTop: 0, gap: space[3] }}>
          {visible.map((order) => (
            <OrderCard key={order.id} order={order} shopId={shop.id} can={owner.can} />
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

function OrderCard({
  order,
  shopId,
  can,
}: {
  order: OwnerLiveOrder;
  shopId: string;
  can: (permission: string) => boolean;
}) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['owner-orders', shopId] });

  const onFailure = (caught: unknown) => {
    setProblem(caught instanceof ApiError ? caught.messageAr : 'تعذّر تنفيذ الإجراء. حاول مرة أخرى.');
    // Another device may have moved this order first: show where it is now.
    refresh();
  };

  const command = useMutation({
    mutationFn: (name: 'accept' | 'start-preparing' | 'mark-ready') =>
      api.ownerOrderCommand(shopId, order.id, name, order.version),
    onSuccess: () => {
      setProblem(null);
      refresh();
    },
    onError: onFailure,
  });

  const reject = useMutation({
    mutationFn: (reason: OwnerRejectReason) =>
      api.ownerRejectOrder(shopId, order.id, reason, order.version),
    onSuccess: () => {
      setRejecting(false);
      refresh();
    },
    onError: onFailure,
  });

  const waiting = order.status === 'PENDING_RESTAURANT';
  const late = waiting && order.age_minutes >= 5;
  const address = describeAddress(order.delivery_address);

  return (
    <View
      style={{
        backgroundColor: color.surfaceCard,
        borderRadius: radius.lg,
        borderWidth: waiting ? 2 : 1,
        borderColor: late ? color.danger : waiting ? BRAND[500] : color.borderSubtle,
        padding: space[4],
        gap: space[3],
      }}
    >
      <Row justify="space-between">
        <Row gap={space[2]}>
          <Ltr variant="h3">#{order.public_order_number}</Ltr>
          <View
            style={{
              paddingHorizontal: space[2],
              paddingVertical: 2,
              borderRadius: radius.full,
              backgroundColor: waiting ? BRAND[50] : color.surfaceSunken,
            }}
          >
            <Text variant="captionBold" tone={waiting ? 'brand' : 'secondary'}>
              {ORDER_STATUS_LABELS[order.status]}
            </Text>
          </View>
        </Row>
        <Text variant="captionBold" tone={late ? 'danger' : 'muted'}>
          {order.age_minutes < 1 ? 'الآن' : `منذ ${order.age_minutes} د`}
        </Text>
      </Row>

      {/* Who, and a way to reach them without copying a number. */}
      <Row justify="space-between">
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyBold">{order.customer_name}</Text>
          {address ? (
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {address}
            </Text>
          ) : null}
        </View>
        {order.customer_phone ? (
          <Pressable
            onPress={() => void Linking.openURL(`tel:${order.customer_phone}`)}
            accessibilityRole="button"
            accessibilityLabel={`اتصال بالعميل ${order.customer_name}`}
            style={({ pressed }) => ({
              width: TAP_TARGET,
              height: TAP_TARGET,
              borderRadius: TAP_TARGET / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: color.successSoft,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <MaterialCommunityIcons name="phone" size={20} color={color.successStrong} />
          </Pressable>
        ) : null}
      </Row>

      <View
        style={{
          gap: space[1],
          paddingTop: space[2],
          borderTopWidth: 1,
          borderTopColor: color.borderSubtle,
        }}
      >
        {order.items.map((item) => (
          <View key={item.id} style={{ gap: 2 }}>
            <Row justify="space-between" align="flex-start">
              <Text variant="small" style={{ flex: 1 }}>
                <Text variant="smallBold">{item.quantity}× </Text>
                {item.name_ar}
              </Text>
              <Text variant="small" tone="secondary">
                {money(item.line_total_iqd)}
              </Text>
            </Row>
            {item.modifiers.length > 0 ? (
              <Text variant="caption" tone="muted">
                {item.modifiers.map((modifier) => modifier.name_ar).join('، ')}
              </Text>
            ) : null}
            {item.notes ? (
              <Text variant="caption" tone="brand">
                ملاحظة: {item.notes}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {order.customer_notes ? (
        <View style={{ padding: space[2], borderRadius: radius.md, backgroundColor: color.warningSoft }}>
          <Text variant="caption" style={{ color: color.warningStrong }}>
            ملاحظة العميل: {order.customer_notes}
          </Text>
        </View>
      ) : null}

      <Row justify="space-between">
        <Text variant="small" tone="muted">
          {order.payment_method === 'CASH' ? 'نقداً عند الاستلام' : order.payment_method}
        </Text>
        <Text variant="bodyBold">{money(order.customer_total_iqd)}</Text>
      </Row>

      {order.driver ? (
        <Row gap={space[1]}>
          <MaterialCommunityIcons name="moped" size={16} color={color.textMuted} />
          <Text variant="caption" tone="muted">
            المندوب: {order.driver.name}
          </Text>
        </Row>
      ) : null}

      {problem ? (
        <Text variant="caption" tone="danger" align="center">
          {problem}
        </Text>
      ) : null}

      {/* What this order needs next, and only that. */}
      {waiting && !rejecting ? (
        <Row gap={space[2]}>
          <View style={{ flex: 2 }}>
            <Button
              label="قبول الطلب"
              block
              loading={command.isPending}
              disabled={!can('order.accept') || reject.isPending}
              onPress={() => command.mutate('accept')}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="رفض"
              variant="ghost"
              block
              disabled={!can('order.reject') || command.isPending}
              onPress={() => setRejecting(true)}
            />
          </View>
        </Row>
      ) : null}

      {/*
       * The reason, asked in the card. The customer is told it, so it has to
       * be a real one — and a picker inside the card cannot collide with the
       * sheets and dialogs that a modal would.
       */}
      {waiting && rejecting ? (
        <View style={{ gap: space[2] }}>
          <Text variant="smallBold">سبب الرفض</Text>
          <View style={{ flexDirection: ROW, flexWrap: 'wrap', gap: space[2] }}>
            {REJECT_REASONS.map((reason) => (
              <Pressable
                key={reason.value}
                disabled={reject.isPending}
                onPress={() => reject.mutate(reason.value)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  paddingVertical: space[2],
                  paddingHorizontal: space[3],
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: color.danger,
                  backgroundColor: pressed ? color.dangerSoft : color.surfaceCard,
                })}
              >
                <Text variant="small" tone="danger">
                  {reason.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {reject.isPending ? <ActivityIndicator color={color.danger} /> : null}
          <Button label="تراجع" variant="ghost" block onPress={() => setRejecting(false)} />
        </View>
      ) : null}

      {order.status === 'ACCEPTED' ? (
        <Button
          label="بدء التحضير"
          block
          loading={command.isPending}
          disabled={!can('order.prepare')}
          onPress={() => command.mutate('start-preparing')}
        />
      ) : null}

      {order.status === 'PREPARING' ? (
        <Button
          label="الطلب جاهز"
          block
          loading={command.isPending}
          disabled={!can('order.ready')}
          onPress={() => command.mutate('mark-ready')}
        />
      ) : null}

      {order.status === 'READY' && !order.driver && can('driver.assign') ? (
        assigning ? (
          <DriverPicker
            shopId={shopId}
            orderId={order.id}
            onDone={() => {
              setAssigning(false);
              refresh();
            }}
            onCancel={() => setAssigning(false)}
          />
        ) : (
          <Button label="إسناد إلى مندوب" block onPress={() => setAssigning(true)} />
        )
      ) : null}
    </View>
  );
}

/** The shop's couriers who can take this order now, and one tap to send it. */
function DriverPicker({
  shopId,
  orderId,
  onDone,
  onCancel,
}: {
  shopId: string;
  orderId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const drivers = useQuery({
    queryKey: ['owner-eligible-drivers', shopId],
    queryFn: () => api.ownerEligibleDrivers(shopId),
  });

  const assign = useMutation({
    mutationFn: (driverId: string) => api.ownerAssignDriver(shopId, orderId, driverId),
    onSuccess: onDone,
  });

  const rows = drivers.data ?? [];

  return (
    <View style={{ gap: space[2] }}>
      <Text variant="smallBold">اختر المندوب</Text>
      {drivers.isLoading ? (
        <ActivityIndicator color={BRAND[500]} />
      ) : rows.length === 0 ? (
        <Text variant="caption" tone="muted">
          لا يوجد مندوبون في فريق المتجر. أضفهم من «السائقون» في بوابة الشركاء.
        </Text>
      ) : (
        rows.map((driver) => (
          <Pressable
            key={driver.id}
            disabled={!driver.assignable || assign.isPending}
            onPress={() => assign.mutate(driver.id)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: ROW,
              alignItems: 'center',
              gap: space[2],
              padding: space[3],
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: driver.assignable ? color.borderSubtle : color.borderSubtle,
              backgroundColor: pressed ? BRAND[50] : color.surfaceCard,
              opacity: driver.assignable ? 1 : 0.5,
            })}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: driver.assignable ? color.success : color.textMuted,
              }}
            />
            <Text variant="small" style={{ flex: 1 }}>
              {driver.name}
            </Text>
            <Text variant="caption" tone="muted">
              {driver.assignable
                ? 'متاح'
                : driver.active_assignments > 0
                  ? 'في مهمة'
                  : 'غير متصل'}
            </Text>
          </Pressable>
        ))
      )}
      {assign.error ? (
        <Text variant="caption" tone="danger">
          {assign.error instanceof ApiError ? assign.error.messageAr : 'تعذّر إسناد الطلب'}
        </Text>
      ) : null}
      <Button label="إلغاء" variant="ghost" block onPress={onCancel} />
    </View>
  );
}

/**
 * A readable line from the address snapshot the order carries. The snapshot's
 * shape belongs to the API, so every field is optional here.
 */
function describeAddress(address: Record<string, unknown>): string | null {
  const read = (key: string) => {
    const value = address[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  const parts = [read('cityNameAr'), read('districtText'), read('street'), read('landmark')].filter(Boolean);
  return parts.length > 0 ? parts.join(' — ') : null;
}
