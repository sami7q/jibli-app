import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import type { OrderStatus } from '@jibli/contracts';
import { api, ApiError, type OrderNotification } from '@/lib/api';
import { markNotificationsSeen, useUnseenNotifications } from '@/lib/notification-inbox';
import { announcementFor } from '@/lib/order-watch';
import { ROW, color, radius, space, TAP_TARGET } from '@/theme';
import { EmptyState, ErrorState, Ltr, Row, Screen, Skeleton, Text } from '@/ui';

/**
 * «الإشعارات» — everything that has happened to this customer's orders.
 *
 * A list rather than a badge that clears itself, because a notification the
 * customer was not looking at when it arrived is the one they most need to be
 * able to find. The entries are the order status history the server already
 * keeps, so this screen cannot drift from the order it describes and it is
 * still complete after a reinstall.
 *
 * Opening it marks everything seen. That is the whole read model: one
 * timestamp, on this device. Marking on open rather than per row is right for
 * a feed this short — the alternative makes the customer tap nine things to
 * clear a badge.
 */
export default function NotificationsScreen() {
  const router = useRouter();

  const feed = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.notifications(),
    staleTime: 15_000,
  });

  const unseen = useUnseenNotifications(feed.data);

  /*
   * Marked seen once the list has actually arrived — not on mount. Clearing
   * the badge before the rows load would hide updates the customer never saw
   * if the request then failed.
   */
  useEffect(() => {
    if (!feed.data || feed.data.length === 0) return;
    const newest = feed.data[0];
    if (newest) void markNotificationsSeen(newest.at);
  }, [feed.data]);

  const grouped = useMemo(() => groupByDay(feed.data ?? []), [feed.data]);

  return (
    <Screen edges={['top']} padded={false}>
      <Row justify="space-between" style={{ paddingHorizontal: space[4], minHeight: TAP_TARGET }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          style={{ width: TAP_TARGET, height: TAP_TARGET, justifyContent: 'center' }}
        >
          <MaterialCommunityIcons name="chevron-right" size={26} color={color.textPrimary} />
        </Pressable>
        <Text variant="h3">الإشعارات</Text>
        <View style={{ width: TAP_TARGET }} />
      </Row>

      {feed.isLoading ? (
        <View style={{ padding: space[4], gap: space[3] }}>
          <Skeleton height={72} style={{ borderRadius: radius.lg }} />
          <Skeleton height={72} style={{ borderRadius: radius.lg }} />
          <Skeleton height={72} style={{ borderRadius: radius.lg }} />
        </View>
      ) : feed.isError ? (
        <View style={{ padding: space[4] }}>
          <ErrorState
            message={
              feed.error instanceof ApiError ? feed.error.messageAr : 'تعذّر تحميل الإشعارات'
            }
            onRetry={() => void feed.refetch()}
          />
        </View>
      ) : (feed.data ?? []).length === 0 ? (
        <View style={{ padding: space[4] }}>
          <EmptyState
            title="لا توجد إشعارات بعد"
            body="ستجد هنا كل تحديث على طلباتك — من لحظة إرساله حتى تسليمه."
            action={{ label: 'تصفّح المطاعم', onPress: () => router.replace('/(tabs)') }}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
          showsVerticalScrollIndicator={false}
        >
          {/*
           * One card per day with hairlines between the rows, not one
           * bordered box per notification.
           *
           * Nine cards stacked with nine borders and nine shadows is a wall
           * of boxes — the eye has to parse the furniture before it reaches a
           * sentence. Every notification list on a phone is grouped rows
           * under a date, and the reason is that it disappears and leaves
           * only the words.
           */}
          {grouped.map((group) => (
            <View key={group.label} style={{ gap: space[2] }}>
              <Text variant="caption" tone="muted" style={{ paddingHorizontal: space[1] }}>
                {group.label}
              </Text>

              <View
                style={{
                  backgroundColor: color.surfaceCard,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: color.borderSubtle,
                  overflow: 'hidden',
                }}
              >
                {group.entries.map((entry, index) => (
                  <NotificationRow
                    key={entry.id}
                    entry={entry}
                    // Anything newer than the last visit is marked, so the eye
                    // finds what arrived while the app was closed.
                    unseen={unseen.has(entry.id)}
                    first={index === 0}
                    onPress={() => router.push(`/order/${entry.order_id}`)}
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

function NotificationRow({
  entry,
  unseen,
  first,
  onPress,
}: {
  entry: OrderNotification;
  unseen: boolean;
  first: boolean;
  onPress: () => void;
}) {
  const tone = toneFor(entry.status);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${announcementFor(entry.status)}، طلب رقم ${entry.public_order_number}`}
      style={({ pressed }) => [
        {
          flexDirection: ROW,
          alignItems: 'center',
          gap: space[3],
          paddingHorizontal: space[3],
          paddingVertical: space[3],
          // A hairline between rows rather than a border around each.
          borderTopWidth: first ? 0 : 1,
          borderTopColor: color.borderSubtle,
          backgroundColor: unseen ? color.brandSoft : color.surfaceCard,
        },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tone.soft,
        }}
      >
        <MaterialCommunityIcons name={tone.icon} size={20} color={tone.strong} />
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="smallBold" numberOfLines={2}>
          {announcementFor(entry.status)}
        </Text>
        <Row gap={space[2]}>
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {entry.restaurant_name ?? 'المطعم'}
          </Text>
          <Text variant="caption" tone="muted">
            ·
          </Text>
          <Ltr>
            <Text variant="caption" tone="muted">
              {formatClock(entry.at)}
            </Text>
          </Ltr>
        </Row>
      </View>

      {/*
       * A dot for unread, not a coloured card.
       *
       * The order number left with it: it is nine characters of Latin in the
       * middle of an Arabic line, and a customer scanning their notifications
       * is not matching reference numbers — it is on the order itself, one tap
       * away, where somebody reading it out on the phone will actually need it.
       */}
      {unseen ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: radius.full,
            backgroundColor: color.brand,
          }}
        />
      ) : null}
    </Pressable>
  );
}

/** Icon and colour per outcome. Colour is never the only signal — the row says it. */
function toneFor(status: OrderStatus): {
  icon: 'check-circle' | 'close-circle' | 'moped' | 'chef-hat' | 'receipt';
  soft: string;
  strong: string;
} {
  switch (status) {
    case 'DELIVERED':
    case 'COMPLETED':
      return { icon: 'check-circle', soft: color.successSoft, strong: color.success };
    case 'REJECTED':
    case 'CANCELLED':
      return { icon: 'close-circle', soft: color.dangerSoft, strong: color.danger };
    case 'OUT_FOR_DELIVERY':
      return { icon: 'moped', soft: color.brandSoft, strong: color.brand };
    case 'PREPARING':
    case 'READY':
      return { icon: 'chef-hat', soft: color.brandSoft, strong: color.brand };
    default:
      return { icon: 'receipt', soft: color.surfaceSunken, strong: color.textSecondary };
  }
}

interface DayGroup {
  label: string;
  entries: OrderNotification[];
}

/**
 * «اليوم», «أمس», then the date.
 *
 * A feed of bare clock times says nothing about whether an update is from an
 * hour ago or last week, which is the first thing anyone wants to know.
 */
function groupByDay(entries: readonly OrderNotification[]): DayGroup[] {
  const groups: DayGroup[] = [];

  for (const entry of entries) {
    const label = dayLabel(entry.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }

  return groups;
}

function dayLabel(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const days = Math.floor((startOfDay(now) - startOfDay(then)) / 86_400_000);

  if (days <= 0) return 'اليوم';
  if (days === 1) return 'أمس';

  try {
    return new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
      day: 'numeric',
      month: 'long',
      timeZone: 'Asia/Baghdad',
    }).format(then);
  } catch {
    return iso.slice(0, 10);
  }
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Baghdad time, 24-hour, Western digits — the same clock the order screen uses. */
function formatClock(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Baghdad',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}
