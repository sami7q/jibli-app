import { useEffect, useMemo, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { MerchantType } from '@jibli/contracts';
import MaterialCommunityIcons from '@/ui/icon';
import { api, ApiError, type PartnerApplication } from '@/lib/api';
import { NEW_ORDERS, countAr } from '@/lib/arabic-count';
import { catalogNoun, useOwner } from '@/lib/owner';
import { sectionOf } from '@/lib/sections';
import { PushPrompt } from '@/ui/push-prompt';
import { useMe, useSession } from '@/lib/session';
import { BRAND, color, radius, ROW, shadow, space, TAP_TARGET } from '@/theme';
import { Button, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';

/**
 * Owner Mode — the shop, on one screen.
 *
 * Three questions, in the order a shopkeeper asks them: which shop is this, how
 * many products are in it, and where do I add one. Everything else a merchant
 * account can do — finance, staff, working hours, settlement — stays on the web
 * portal, which is better at tables and is where that work actually gets done.
 *
 * This screen is deliberately small. It is the lobby, and the product list is
 * the room.
 */
export default function OwnerHomeScreen() {
  const router = useRouter();
  const { state, refresh } = useSession();
  const owner = useOwner();

  const shop = owner.shop;

  /*
   * A shop approved while this account was already signed in.
   *
   * Owner Mode finds it — the shop list is asked afresh — but the session was
   * resolved before the approval and still says "no shops", and the live order
   * engine (`WorkLiveProvider`) starts from the session. Asking the session
   * once more is what makes the new owner's phone ring for their first order.
   */
  const rolesKnown =
    state.status === 'ready' ? Object.keys(state.me.restaurant_roles ?? {}).length : null;
  useEffect(() => {
    if (owner.usable.length > 0 && rolesKnown === 0) void refresh();
  }, [owner.usable.length, rolesKnown, refresh]);

  const catalog = useQuery({
    queryKey: ['owner-catalog', shop?.id],
    queryFn: () => api.ownerCatalog(shop?.id as string),
    enabled: Boolean(shop?.id),
    staleTime: 60_000,
  });

  /*
   * Orders waiting for an answer, counted here so the lobby says it. Polled
   * like the board itself: a new order is the one thing on this screen that
   * cannot wait for the owner to think of looking.
   */
  const orders = useQuery({
    queryKey: ['owner-orders', shop?.id],
    queryFn: () => api.ownerLiveOrders(shop?.id as string),
    enabled: Boolean(shop?.id) && owner.can('order.read'),
    refetchInterval: 15_000,
  });
  const waiting = (orders.data ?? []).filter(
    (order) => order.status === 'PENDING_RESTAURANT',
  ).length;
  const inProgress = (orders.data ?? []).filter((order) =>
    ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'].includes(order.status),
  ).length;

  const counts = useMemo(() => {
    const categories = catalog.data?.categories ?? [];
    const products = categories.flatMap((entry) => entry.items);
    return {
      categories: categories.length,
      products: products.length,
      unavailable: products.filter((item) => !item.is_available).length,
      withoutPhoto: products.filter((item) => !item.image_asset_id).length,
    };
  }, [catalog.data]);

  if (state.status === 'signed-out' || state.status === 'guest') {
    return (
      <Screen scroll edges={['top', 'bottom']}>
        <OwnerHeader title="متجري" />
        <PartnerHub restaurantOnly={false} />
      </Screen>
    );
  }

  if (owner.isLoading) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="متجري" />
        <View style={{ gap: space[3], paddingTop: space[4] }}>
          <Skeleton height={104} style={{ borderRadius: radius.xl }} />
          <Skeleton height={72} style={{ borderRadius: radius.lg }} />
        </View>
      </Screen>
    );
  }

  if (owner.isError) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="متجري" />
        <ErrorState message="تعذّر تحميل متاجرك" onRetry={owner.refetch} />
      </Screen>
    );
  }

  /*
   * Signed in, but no shop Owner Mode can open.
   *
   * This used to be a dead end with one button — «الدخول بحساب متجر ماركت أو
   * تجميل» — which wants a username only Jibli staff can issue. Somebody who
   * signed in with their phone had nothing to type there and came straight
   * back. Now the first thing on offer is registering a shop as this very
   * account, which approval turns into a shop this screen opens; the portal
   * login stays, second, for owners who already have one.
   *
   * A restaurant owner is told why their restaurant is not here rather than
   * "you have no shops", which would be false about their own account.
   */
  if (!shop) {
    return (
      <Screen scroll edges={['top', 'bottom']}>
        <OwnerHeader title="متجري" />
        <PartnerHub restaurantOnly={owner.shops.length > 0} onApproved={owner.refetch} />
      </Screen>
    );
  }

  const noun = catalogNoun(shop);

  return (
    <Screen scroll edges={['top']} padded={false}>
      <View style={{ padding: space[4], gap: space[4] }}>
        <OwnerHeader title="متجري" />

        <PushPrompt audience="owner" />

        {/* Which shop this is — and, when there is more than one, the way to
            switch. A grocer who adds stock to the wrong branch blames the app,
            and rightly: the app never told them which one it was on. */}
        <View
          style={{
            padding: space[4],
            borderRadius: radius.xl,
            backgroundColor: sectionOf(shop.merchant_type).ramp[500],
            gap: space[1],
            ...shadow.md,
          }}
        >
          <Row justify="space-between" align="flex-start">
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="caption" tone="inverse" style={{ opacity: 0.85 }}>
                {sectionOf(shop.merchant_type).label}
              </Text>
              <Text variant="h3" tone="inverse" numberOfLines={2}>
                {shop.display_name}
              </Text>
            </View>
            <MaterialCommunityIcons
              name={sectionOf(shop.merchant_type).shopIcon}
              size={30}
              color="rgba(255,255,255,0.9)"
            />
          </Row>

          {owner.usable.length > 1 ? (
            <Pressable
              onPress={() => router.push('/(owner)/shops')}
              accessibilityRole="button"
              accessibilityLabel="تبديل المتجر"
              style={({ pressed }) => [
                {
                  flexDirection: ROW,
                  alignItems: 'center',
                  alignSelf: 'flex-start',
                  gap: space[1],
                  marginTop: space[2],
                  paddingVertical: space[1],
                  paddingHorizontal: space[3],
                  borderRadius: radius.full,
                  backgroundColor: 'rgba(255,255,255,0.22)',
                },
                pressed ? { opacity: 0.8 } : null,
              ]}
            >
              <MaterialCommunityIcons name="swap-horizontal" size={15} color="#fff" />
              <Text variant="caption" tone="inverse">
                تبديل المتجر ({owner.usable.length})
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/*
          Orders first. The menu changes once a week; an order waits on a
          customer now — so it is the first thing in the lobby, and red when
          somebody is waiting.
        */}
        {owner.can('order.read') ? (
          <Pressable
            onPress={() => router.push('/(owner)/orders')}
            accessibilityRole="button"
            accessibilityLabel={`الطلبات: ${waiting} جديدة`}
            style={({ pressed }) => [
              {
                flexDirection: ROW,
                alignItems: 'center',
                gap: space[3],
                padding: space[4],
                borderRadius: radius.lg,
                borderWidth: waiting > 0 ? 2 : 1,
                borderColor: waiting > 0 ? color.danger : color.borderSubtle,
                backgroundColor: waiting > 0 ? color.dangerSoft : color.surfaceCard,
              },
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            <MaterialCommunityIcons
              name={waiting > 0 ? 'bell-ring-outline' : 'clipboard-list-outline'}
              size={28}
              color={waiting > 0 ? color.dangerStrong : color.brand}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyBold" tone={waiting > 0 ? 'danger' : 'primary'}>
                {waiting > 0 ? `${countAr(waiting, NEW_ORDERS)} بانتظار موافقتك` : 'الطلبات'}
              </Text>
              <Text variant="caption" tone="muted">
                {orders.isLoading
                  ? '…'
                  : inProgress > 0
                    ? `${inProgress} قيد التنفيذ — اقبل، حضّر، وأسند للمندوب`
                    : 'اقبل الطلبات وتابع حالتها من هنا'}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-left" size={22} color={color.textMuted} />
          </Pressable>
        ) : null}

        {catalog.isError ? (
          <ErrorState
            message={
              catalog.error instanceof ApiError ? catalog.error.messageAr : `تعذّر تحميل ${noun}`
            }
            onRetry={() => void catalog.refetch()}
          />
        ) : (
          <>
            <Row gap={space[3]}>
              <Stat label={noun} value={catalog.isLoading ? '…' : String(counts.products)} />
              <Stat label="الأقسام" value={catalog.isLoading ? '…' : String(counts.categories)} />
              <Stat
                label="غير متوفر"
                value={catalog.isLoading ? '…' : String(counts.unavailable)}
                tone={counts.unavailable > 0 ? 'warning' : 'plain'}
              />
            </Row>

            {/*
              The one number that is a to-do rather than a fact.
              A product with no photograph is the commonest reason a customer
              scrolls past it, and it is the thing the phone is uniquely good at
              fixing — the camera is right here.
            */}
            {!catalog.isLoading && counts.withoutPhoto > 0 ? (
              <Pressable
                onPress={() => router.push('/(owner)/products?filter=no-photo')}
                accessibilityRole="button"
                style={({ pressed }) => [
                  {
                    flexDirection: ROW,
                    alignItems: 'center',
                    gap: space[3],
                    padding: space[3],
                    borderRadius: radius.lg,
                    backgroundColor: color.warningSoft,
                  },
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <MaterialCommunityIcons
                  name="camera-plus-outline"
                  size={22}
                  color={color.warningStrong}
                />
                <Text variant="small" style={{ flex: 1, color: color.warningStrong }}>
                  {counts.withoutPhoto} من {noun} بلا صورة
                </Text>
                <MaterialCommunityIcons name="chevron-left" size={20} color={color.warningStrong} />
              </Pressable>
            ) : null}

            <Button
              label={`عرض ${noun}`}
              block
              size="lg"
              onPress={() => router.push('/(owner)/products')}
            />

            {owner.can('menu.write') ? (
              <Button
                label="إضافة منتج"
                variant="secondary"
                block
                onPress={() => router.push('/(owner)/product/new')}
              />
            ) : (
              <Text variant="caption" tone="muted" align="center">
                حسابك يستطيع العرض فقط. الإضافة والتعديل تحتاج صلاحية من صاحب المتجر.
              </Text>
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

const isOpenApplication = (status: PartnerApplication['status']) =>
  status === 'DRAFT' || status === 'UNDER_REVIEW' || status === 'INFO_REQUESTED';

/**
 * Where an account without a shop starts selling.
 *
 * First the offer — register a market or cosmetics shop as this account, and
 * manage it here once Jibli approves — then, if an application is already in,
 * where it stands, and last the portal login for owners who have one. The
 * order matters: the login used to be the only thing here, and it was the
 * wrong door for almost everyone who opened this screen.
 */
function PartnerHub({
  restaurantOnly,
  onApproved,
}: {
  restaurantOnly: boolean;
  onApproved?: () => void;
}) {
  const router = useRouter();
  const { state } = useSession();
  const me = useMe();
  const signedIn = state.status === 'ready' || state.status === 'offline-ready';

  const application = useQuery({
    queryKey: ['partner-application', me?.user_id ?? null],
    queryFn: () => api.partnerApplication(),
    enabled: signedIn,
    // Decided in Admin while this screen is open.
    refetchInterval: (query) =>
      query.state.data && isOpenApplication(query.state.data.status) ? 60_000 : false,
  });

  /*
   * Approved onto this account: the shop exists; the shop list has not asked
   * yet. Once — `onApproved` is a fresh function every render, and calling it
   * on each would refetch in a loop.
   */
  const approvedHere = application.data?.status === 'APPROVED' && application.data.owned;
  const toldApproved = useRef(false);
  useEffect(() => {
    if (!approvedHere || toldApproved.current) return;
    toldApproved.current = true;
    onApproved?.();
  }, [approvedHere, onApproved]);

  const pending =
    application.data && isOpenApplication(application.data.status) ? application.data : null;
  const rejected = application.data?.status === 'REJECTED' ? application.data : null;

  return (
    <View style={{ gap: space[4], paddingTop: space[2], paddingBottom: space[6] }}>
      <View
        style={{
          padding: space[5],
          borderRadius: radius.xl,
          backgroundColor: BRAND[50],
          borderWidth: 1,
          borderColor: BRAND[200],
          gap: space[3],
        }}
      >
        <Row gap={space[2]}>
          <KindBadge kind="MARKET" />
          <KindBadge kind="COSMETICS" />
        </Row>
        <Text variant="h2">
          {restaurantOnly ? 'مطعمك يُدار من لوحة التحكم' : 'ابدأ البيع على جيبلي'}
        </Text>
        <Text variant="small" tone="secondary">
          {restaurantOnly
            ? 'قوائم المطاعم فيها خيارات وإضافات وأسعار لكل خيار، وتحريرها أدقّ على لوحة التحكم. ولديك ماركت أو متجر تجميل؟ سجّله من هنا وأدِره من التطبيق بحسابك هذا.'
            : 'سجّل ماركتك أو متجر التجميل من هنا. بعد موافقة فريق جيبلي يظهر متجرك في هذه الصفحة بحسابك نفسه: منتجات بالصور، أسعار، وطلبات تستلمها وتجهّزها.'}
        </Text>
        {!pending ? (
          <View style={{ gap: space[2], paddingTop: space[1] }}>
            <Step number="١" text="سجّل بيانات متجرك — دقيقتان" />
            <Step number="٢" text="يتصل بك فريق جيبلي ويوافق على المتجر" />
            <Step number="٣" text="أضف منتجاتك وأسعارك، واستلم الطلبات" />
          </View>
        ) : null}
      </View>

      {pending ? (
        <ApplicationCard
          application={pending}
          icon="clock-outline"
          title={`طلب «${pending.display_name}» قيد المراجعة`}
          body="سيتصل بك فريق جيبلي على رقمك. بعد الموافقة يظهر متجرك هنا مباشرة."
          onPress={() => router.push('/(owner)/apply')}
        />
      ) : null}

      {rejected ? (
        <ApplicationCard
          application={rejected}
          icon="close-circle-outline"
          tone="danger"
          title={`لم يُقبل طلب «${rejected.display_name}»`}
          body={rejected.rejection_reason ? `السبب: ${rejected.rejection_reason}` : 'يمكنك تعديل البيانات وتقديم طلب جديد.'}
          onPress={() => router.push('/(owner)/apply')}
        />
      ) : null}

      {!pending ? (
        <Button
          label={rejected ? 'قدّم طلباً جديداً' : 'سجّل متجرك الآن'}
          block
          size="lg"
          onPress={() => router.push('/(owner)/apply')}
        />
      ) : null}

      {/* Second, on purpose: only owners the team issued a login to have one. */}
      <Button
        label="لديّ حساب متجر — الدخول باسم المستخدم"
        variant="ghost"
        block
        onPress={() => router.push('/(auth)/owner-login')}
      />
    </View>
  );
}

/** A section's own colour and icon: what «ماركت» and «كوزمتك» look like everywhere else. */
function KindBadge({ kind }: { kind: MerchantType }) {
  const section = sectionOf(kind);
  return (
    <Row
      gap={space[1]}
      style={{
        paddingVertical: space[1],
        paddingHorizontal: space[3],
        borderRadius: radius.full,
        backgroundColor: section.ramp[500],
      }}
    >
      <MaterialCommunityIcons name={section.shopIcon} size={16} color="#fff" />
      <Text variant="captionBold" tone="inverse">
        {section.shortName}
      </Text>
    </Row>
  );
}

function Step({ number, text }: { number: string; text: string }) {
  return (
    <Row gap={space[2]}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: BRAND[500],
        }}
      >
        <Text variant="captionBold" tone="inverse">
          {number}
        </Text>
      </View>
      <Text variant="small" style={{ flex: 1 }}>
        {text}
      </Text>
    </Row>
  );
}

function ApplicationCard({
  application,
  icon,
  tone = 'brand',
  title,
  body,
  onPress,
}: {
  application: PartnerApplication;
  icon: 'clock-outline' | 'close-circle-outline';
  tone?: 'brand' | 'danger';
  title: string;
  body: string;
  onPress: () => void;
}) {
  const accent = tone === 'danger' ? color.dangerStrong : BRAND[500];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. تفاصيل الطلب`}
      style={({ pressed }) => ({
        flexDirection: ROW,
        alignItems: 'center',
        gap: space[3],
        padding: space[4],
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: tone === 'danger' ? color.danger : BRAND[200],
        backgroundColor: tone === 'danger' ? color.dangerSoft : color.surfaceCard,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <MaterialCommunityIcons name={icon} size={28} color={accent} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyBold" tone={tone === 'danger' ? 'danger' : 'primary'}>
          {title}
        </Text>
        <Text variant="caption" tone="muted">
          {`${sectionOf(application.merchant_type).shortName} · ${application.city_name_ar}`}
        </Text>
        <Text variant="caption" tone="secondary">
          {body}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-left" size={22} color={color.textMuted} />
    </Pressable>
  );
}

/** A number and what it counts. Three of these fit one row on the narrowest phone. */
function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'warning';
}) {
  return (
    <View
      style={{
        flex: 1,
        padding: space[3],
        borderRadius: radius.lg,
        backgroundColor: color.surfaceCard,
        borderWidth: 1,
        borderColor: tone === 'warning' ? color.warning : color.borderSubtle,
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Text variant="h3" tone={tone === 'warning' ? 'danger' : 'primary'}>
        {value}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The bar every owner screen wears: a title and the way back out. */
export function OwnerHeader({ title }: { title: string }) {
  const router = useRouter();

  return (
    <Row justify="space-between" style={{ minHeight: TAP_TARGET }}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/account'))}
        accessibilityRole="button"
        accessibilityLabel="رجوع"
        style={{ width: TAP_TARGET, height: TAP_TARGET, justifyContent: 'center' }}
      >
        <MaterialCommunityIcons name="chevron-right" size={26} color={color.textPrimary} />
      </Pressable>
      <Text variant="h3">{title}</Text>
      <View style={{ width: TAP_TARGET }} />
    </Row>
  );
}
