import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIqdArabic, iqd } from '@jibli/money';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@jibli/contracts';
import MaterialCommunityIcons from '@/ui/icon';
import { api, ApiError, type OwnerLiveOrder, type OwnerRejectReason } from '@/lib/api';
import { MINUTES, countAr } from '@/lib/arabic-count';
import { useOwner } from '@/lib/owner';
import { addressDeliveryNote, describeAddress } from '@/lib/owner-catalog';
import { useWorkLive } from '@/lib/work-live';
import type { RealtimeStatus } from '@/lib/realtime';
import { BRAND, color, palette, radius, ROW, space, TAP_TARGET } from '@/theme';
import { Button, EmptyState, ErrorState, Ltr, Row, Screen, Skeleton, Text } from '@/ui';
import { OwnerHeader } from '@/ui/owner-header';

/**
 * Orders, from the phone — the shop's live board.
 *
 * The web portal's board on a phone: the same endpoints, the same commands,
 * the same optimistic-concurrency version on each one — so a phone and the
 * shop's laptop cannot both accept the same order, and whichever is second is
 * told so and reloads.
 *
 * Live rather than polled: the shop's realtime channel refreshes this the
 * moment an order changes, and `WorkLiveProvider` rings for a new one on any
 * screen. The poll stays as the floor under both.
 *
 * Lanes rather than one long list, because the question at each moment is
 * «what needs me now?», and the answer is almost always the first lane.
 */

type Lane = 'new' | 'kitchen' | 'ready' | 'road' | 'done';

const LANES: { key: Lane; label: string; statuses: readonly OrderStatus[] }[] = [
  { key: 'new', label: 'جديدة', statuses: ['PENDING_RESTAURANT'] },
  { key: 'kitchen', label: 'قيد التجهيز', statuses: ['ACCEPTED', 'PREPARING'] },
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

/**
 * How long the shop needs, chosen as it accepts.
 *
 * The customer is shown it and the courier is timed against it, so it is
 * asked for on the one tap that commits to it rather than left at a default
 * nobody set. Short options first: a market packs in minutes.
 */
const PREP_OPTIONS = [10, 15, 20, 30, 45] as const;

/** Why a shop takes an order back from its courier. */
const RECALL_REASONS = ['المندوب لا يرد', 'تأخّر المندوب كثيراً', 'سبب آخر'] as const;

/** The courier's side of an order, in the shop's words. */
const ASSIGNMENT_LABELS: Record<string, string> = {
  ASSIGNED: 'بانتظار قبول المندوب',
  ACCEPTED: 'المندوب في الطريق إليك',
  PICKED_UP: 'استلم الطلب وفي الطريق للعميل',
  ARRIVED_CUSTOMER: 'وصل إلى العميل',
};

const money = (value: number) => formatIqdArabic(iqd(value));

/** A clock for the timers on the cards: minutes are all they show. */
function useNow(stepMs = 20_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(timer);
  }, [stepMs]);
  return now;
}

const minutesSince = (iso: string, now: number) =>
  Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));

export default function OwnerOrdersScreen() {
  const owner = useOwner();
  const shop = owner.shop;
  const { owner: live } = useWorkLive();
  const [lane, setLane] = useState<Lane>('new');
  const now = useNow();

  const orders = useQuery({
    queryKey: ['owner-orders', shop?.id],
    queryFn: () => api.ownerLiveOrders(shop?.id as string),
    enabled: Boolean(shop?.id),
    /*
     * The floor under the realtime channel: if the socket is down this is how
     * the board still moves. `WorkLiveProvider` polls the same key app-wide;
     * this is here so the board also works when opened before it has.
     */
    refetchInterval: live.live === 'live' ? 60_000 : 15_000,
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

  /*
   * Follow an order the owner has just moved on, when it was the last one in
   * its lane: an empty «جديدة» after accepting leaves them a tap away from the
   * next thing they have to do with it. With others still waiting here they
   * stay — those come first.
   */
  const follow = (to: Lane) => {
    if (visible.length <= 1) setLane(to);
  };

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={{ paddingHorizontal: space[4] }}>
        <OwnerHeader title="الطلبات" />
        <LiveBadge status={live.live} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: ROW,
          gap: space[2],
          paddingHorizontal: space[4],
          paddingVertical: space[3],
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
              accessibilityLabel={`${entry.label}، ${count}`}
              style={{
                flexDirection: ROW,
                alignItems: 'center',
                gap: space[1],
                minHeight: TAP_TARGET - 4,
                paddingHorizontal: space[3],
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: chosen ? BRAND[500] : urgent ? color.danger : color.borderSubtle,
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
            message={
              orders.error instanceof ApiError ? orders.error.messageAr : 'تعذّر تحميل الطلبات'
            }
            onRetry={() => void orders.refetch()}
          />
        </View>
      ) : orders.isLoading ? (
        <View style={{ padding: space[4], gap: space[3] }}>
          <Skeleton height={180} style={{ borderRadius: radius.lg }} />
          <Skeleton height={180} style={{ borderRadius: radius.lg }} />
        </View>
      ) : visible.length === 0 ? (
        <EmptyState
          title={lane === 'new' ? 'لا طلبات جديدة الآن' : 'لا شيء هنا'}
          body={
            lane === 'new'
              ? 'سيرنّ الهاتف ويظهر تنبيه فور وصول طلب جديد، حتى وأنت في شاشة أخرى.'
              : 'تظهر الطلبات هنا حين تصل إلى هذه المرحلة.'
          }
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space[4], paddingTop: 0, gap: space[3] }}>
          {visible.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              shopId={shop.id}
              can={owner.can}
              now={now}
              onMoved={follow}
            />
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

/**
 * Whether the board is live. A shop that trusts the board to tell it about an
 * order needs to know when it is only checking every few seconds.
 */
function LiveBadge({ status }: { status: RealtimeStatus }) {
  const live = status === 'live';
  return (
    <View
      style={{
        flexDirection: ROW,
        alignItems: 'center',
        alignSelf: 'center',
        gap: space[1],
        paddingVertical: 2,
        paddingHorizontal: space[2],
        borderRadius: radius.full,
        backgroundColor: live ? color.successSoft : color.warningSoft,
      }}
      accessibilityLabel={live ? 'متصل مباشرة' : 'تحديث دوري'}
    >
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: live ? color.success : color.warning,
        }}
      />
      <Text
        variant="captionBold"
        style={{ color: live ? color.successStrong : color.warningStrong }}
      >
        {live ? 'مباشر' : 'تحديث كل بضع ثوانٍ'}
      </Text>
    </View>
  );
}

function OrderCard({
  order,
  shopId,
  can,
  now,
  onMoved,
}: {
  order: OwnerLiveOrder;
  shopId: string;
  can: (permission: string) => boolean;
  now: number;
  /** The lane a command has just sent this order to. */
  onMoved: (to: Lane) => void;
}) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['owner-orders', shopId] });

  const onFailure = (caught: unknown) => {
    setProblem(
      caught instanceof ApiError ? caught.messageAr : 'تعذّر تنفيذ الإجراء. حاول مرة أخرى.',
    );
    // Another device may have moved this order first: show where it is now.
    refresh();
  };

  const command = useMutation({
    mutationFn: (input: { name: 'accept' | 'start-preparing' | 'mark-ready'; minutes?: number }) =>
      api.ownerOrderCommand(shopId, order.id, input.name, order.version, input.minutes),
    onSuccess: (_, input) => {
      setProblem(null);
      setAccepting(false);
      refresh();
      onMoved(input.name === 'mark-ready' ? 'ready' : 'kitchen');
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

  const recall = useMutation({
    mutationFn: (reason: string) => api.ownerUnassignDriver(shopId, order.id, reason),
    onSuccess: () => {
      setRecalling(false);
      setProblem(null);
      refresh();
    },
    onError: onFailure,
  });

  const waiting = order.status === 'PENDING_RESTAURANT';
  const waitedMinutes = minutesSince(order.placed_at, now);
  const late = waiting && waitedMinutes >= 5;
  const address = describeAddress(order.delivery_address);
  const deliveryNote = addressDeliveryNote(order.delivery_address);

  /** «Ready in N min» from acceptance plus the shop's own estimate. */
  const readyIn =
    (order.status === 'ACCEPTED' || order.status === 'PREPARING') &&
    order.accepted_at &&
    order.estimated_preparation_minutes
      ? order.estimated_preparation_minutes - minutesSince(order.accepted_at, now)
      : null;

  const courierStage = ['ACCEPTED', 'PREPARING', 'READY'].includes(order.status);
  const recallable =
    order.driver?.assignment_status === 'ASSIGNED' ||
    order.driver?.assignment_status === 'ACCEPTED';

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
        <Row gap={space[1]}>
          {waiting ? (
            <MaterialCommunityIcons
              name="clock-outline"
              size={14}
              color={late ? color.danger : color.textMuted}
            />
          ) : null}
          <Text variant="captionBold" tone={late ? 'danger' : 'muted'}>
            {waitedMinutes < 1 ? 'الآن' : `منذ ${waitedMinutes} د`}
          </Text>
        </Row>
      </Row>

      {late ? (
        <View
          style={{
            flexDirection: ROW,
            alignItems: 'center',
            gap: space[2],
            padding: space[2],
            borderRadius: radius.md,
            backgroundColor: color.dangerSoft,
          }}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={16} color={color.danger} />
          <Text variant="caption" tone="danger" style={{ flex: 1 }}>
            العميل ينتظر ردك منذ {countAr(waitedMinutes, MINUTES)} — اقبل الطلب أو ارفضه الآن.
          </Text>
        </View>
      ) : null}

      {/* Who, and a way to reach them without copying a number. */}
      <Row justify="space-between">
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyBold">{order.customer_name}</Text>
          {address ? (
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {address}
            </Text>
          ) : null}
          {deliveryNote ? (
            <Text variant="caption" tone="secondary">
              ملاحظة التوصيل: {deliveryNote}
            </Text>
          ) : null}
        </View>
        {order.customer_phone ? (
          <CallButton
            phone={order.customer_phone}
            label={`اتصال بالعميل ${order.customer_name}`}
            tone="success"
          />
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
        <View
          style={{ padding: space[2], borderRadius: radius.md, backgroundColor: color.warningSoft }}
        >
          <Text variant="caption" style={{ color: color.warningStrong }}>
            ملاحظة العميل: {order.customer_notes}
          </Text>
        </View>
      ) : null}

      <Row justify="space-between">
        <Text variant="small" tone="muted">
          {/* The API says CASH_ON_DELIVERY; an older one said CASH. Neither is shown raw. */}
          {order.payment_method === 'CASH' || order.payment_method === 'CASH_ON_DELIVERY'
            ? 'نقداً عند الاستلام'
            : order.payment_method}
        </Text>
        <Text variant="bodyBold">{money(order.customer_total_iqd)}</Text>
      </Row>

      {readyIn !== null ? (
        <Row gap={space[1]}>
          <MaterialCommunityIcons
            name="timer-sand"
            size={16}
            color={readyIn < 0 ? color.danger : color.textSecondary}
          />
          <Text variant="captionBold" tone={readyIn < 0 ? 'danger' : 'secondary'}>
            {readyIn > 0
              ? `جاهز خلال ${readyIn} د حسب تقديرك`
              : readyIn === 0
                ? 'حان وقت التجهيز الذي حددته'
                : `متأخر ${-readyIn} د عن الوقت الذي حددته`}
          </Text>
        </Row>
      ) : null}

      {/* The courier: who has it, where they are, and a way to reach them. */}
      {order.driver ? (
        <View
          style={{
            flexDirection: ROW,
            alignItems: 'center',
            gap: space[3],
            padding: space[3],
            borderRadius: radius.md,
            backgroundColor: color.surfaceSunken,
          }}
        >
          <MaterialCommunityIcons name="moped" size={22} color={color.textSecondary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="smallBold">{order.driver.name}</Text>
            <Text variant="caption" tone="muted">
              {ASSIGNMENT_LABELS[order.driver.assignment_status] ?? order.driver.assignment_status}
            </Text>
          </View>
          {order.driver.phone ? (
            <CallButton phone={order.driver.phone} label={`اتصال بالمندوب ${order.driver.name}`} />
          ) : null}
        </View>
      ) : null}

      {problem ? (
        <Text variant="caption" tone="danger" align="center">
          {problem}
        </Text>
      ) : null}

      {/* ── What this order needs next, and only that. ─────────────────── */}

      {waiting && !rejecting && !accepting ? (
        <Row gap={space[2]}>
          <View style={{ flex: 2 }}>
            <Button
              label="قبول الطلب"
              block
              disabled={!can('order.accept') || reject.isPending}
              onPress={() => setAccepting(true)}
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

      {waiting && accepting ? (
        <View style={{ gap: space[2] }}>
          <Text variant="smallBold">كم تحتاج لتجهيز الطلب؟</Text>
          {/*
           * One row of equal keys: five choices read as a scale, not as a list.
           * Spaced by symmetric margins rather than `gap` — Yoga shares out a
           * reversed row's width as if it had one gap fewer, which pushed the
           * last key a gap's width past the card's edge.
           */}
          <View style={{ flexDirection: ROW, marginHorizontal: -space[1] }}>
            {PREP_OPTIONS.map((minutes) => (
              <Pressable
                key={minutes}
                disabled={command.isPending}
                onPress={() => command.mutate({ name: 'accept', minutes })}
                accessibilityRole="button"
                accessibilityLabel={`قبول، التجهيز خلال ${countAr(minutes, MINUTES)}`}
                style={({ pressed }) => ({
                  flex: 1,
                  marginHorizontal: space[1],
                  minHeight: TAP_TARGET,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.md,
                  borderWidth: 1.5,
                  borderColor: BRAND[500],
                  backgroundColor: pressed ? BRAND[500] : BRAND[50],
                })}
              >
                {({ pressed }) => (
                  <Text
                    variant="bodyBold"
                    align="center"
                    numberOfLines={1}
                    style={{ color: pressed ? palette.white : BRAND[700] }}
                  >
                    {/* A no-break space: the number never parts from its unit. */}
                    {`${minutes}\u00A0د`}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>
          {command.isPending ? <ActivityIndicator color={BRAND[500]} /> : null}
          <Button label="تراجع" variant="ghost" block onPress={() => setAccepting(false)} />
        </View>
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
        <Row gap={space[2]}>
          <View style={{ flex: 1 }}>
            <Button
              label="بدء التجهيز"
              block
              loading={command.isPending && command.variables?.name === 'start-preparing'}
              disabled={!can('order.prepare') || command.isPending}
              onPress={() => command.mutate({ name: 'start-preparing' })}
            />
          </View>
          {/* A market packs rather than cooks: straight to ready is allowed. */}
          <View style={{ flex: 1 }}>
            <Button
              label="جاهز مباشرة"
              variant="secondary"
              block
              loading={command.isPending && command.variables?.name === 'mark-ready'}
              disabled={!can('order.ready') || command.isPending}
              onPress={() => command.mutate({ name: 'mark-ready' })}
            />
          </View>
        </Row>
      ) : null}

      {order.status === 'PREPARING' ? (
        <Button
          label="الطلب جاهز للاستلام"
          block
          loading={command.isPending}
          disabled={!can('order.ready')}
          onPress={() => command.mutate({ name: 'mark-ready' })}
        />
      ) : null}

      {/*
       * A courier from acceptance on, not only once packed: assigned while the
       * order is being prepared, they arrive as it becomes ready.
       */}
      {courierStage && !order.driver && can('driver.assign') ? (
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
          <Button
            label={order.status === 'READY' ? 'إسناد إلى مندوب' : 'إسناد مبكر إلى مندوب'}
            variant={order.status === 'READY' ? 'primary' : 'ghost'}
            block
            onPress={() => setAssigning(true)}
          />
        )
      ) : null}

      {recallable && can('driver.assign') ? (
        recalling ? (
          <View style={{ gap: space[2] }}>
            <Text variant="smallBold">سحب الطلب من المندوب</Text>
            <Text variant="caption" tone="muted">
              يصل المندوبَ إشعار بذلك، ويعود الطلب قابلاً للإسناد إلى غيره.
            </Text>
            <View style={{ flexDirection: ROW, flexWrap: 'wrap', gap: space[2] }}>
              {RECALL_REASONS.map((reason) => (
                <Pressable
                  key={reason}
                  disabled={recall.isPending}
                  onPress={() => recall.mutate(reason)}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    paddingVertical: space[2],
                    paddingHorizontal: space[3],
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: color.borderStrong,
                    backgroundColor: pressed ? color.surfaceSunken : color.surfaceCard,
                  })}
                >
                  <Text variant="small">{reason}</Text>
                </Pressable>
              ))}
            </View>
            {recall.isPending ? <ActivityIndicator color={BRAND[500]} /> : null}
            <Button label="تراجع" variant="ghost" block onPress={() => setRecalling(false)} />
          </View>
        ) : (
          <Pressable
            onPress={() => setRecalling(true)}
            accessibilityRole="button"
            style={{ alignSelf: 'center', paddingVertical: space[1] }}
          >
            <Text variant="caption" tone="muted" style={{ textDecorationLine: 'underline' }}>
              سحب الطلب من المندوب وإسناده لغيره
            </Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

/** A round call button: one tap from the card to the phone's dialler. */
function CallButton({
  phone,
  label,
  tone = 'neutral',
}: {
  phone: string;
  label: string;
  tone?: 'success' | 'neutral';
}) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(`tel:${phone}`)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: TAP_TARGET,
        height: TAP_TARGET,
        borderRadius: TAP_TARGET / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tone === 'success' ? color.successSoft : color.surfaceCard,
        borderWidth: tone === 'success' ? 0 : 1,
        borderColor: color.borderSubtle,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <MaterialCommunityIcons
        name="phone"
        size={20}
        color={tone === 'success' ? color.successStrong : color.textSecondary}
      />
    </Pressable>
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
            accessibilityState={{ disabled: !driver.assignable }}
            style={({ pressed }) => ({
              flexDirection: ROW,
              alignItems: 'center',
              gap: space[2],
              padding: space[3],
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: color.borderSubtle,
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
              {driver.assignable ? 'متاح' : driver.active_assignments > 0 ? 'في مهمة' : 'غير متصل'}
            </Text>
          </Pressable>
        ))
      )}
      {assign.isPending ? <ActivityIndicator color={BRAND[500]} /> : null}
      {assign.error ? (
        <Text variant="caption" tone="danger">
          {assign.error instanceof ApiError ? assign.error.messageAr : 'تعذّر إسناد الطلب'}
        </Text>
      ) : null}
      <Button label="إلغاء" variant="ghost" block onPress={onCancel} />
    </View>
  );
}
