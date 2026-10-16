import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIqdArabic, iqd } from '@jibli/money';
import MaterialCommunityIcons, { type IconName } from '@/ui/icon';
import { api, ApiError, assetUrl, type OwnerReadiness, type PartnerApplication } from '@/lib/api';
import { NEW_ORDERS, countAr } from '@/lib/arabic-count';
import { notify } from '@/lib/dialog';
import { catalogNoun, useOwner } from '@/lib/owner';
import { activationState } from '@/lib/owner-activation';
import { PRODUCTS } from '@/lib/owner-catalog';
import { sectionOf } from '@/lib/sections';
import { useVertical } from '@/lib/vertical';
import { ActivationCard } from '@/ui/activation-card';
import { PushPrompt } from '@/ui/push-prompt';
import { Door, KindBadge, Step } from '@/ui/partner-doors';
import { useMe, useSession } from '@/lib/session';
import { BRAND, color, radius, ROW, shadow, space, TAP_TARGET } from '@/theme';
import { Button, ErrorState, RemoteImage, Row, Screen, Skeleton, Text } from '@/ui';
import { OwnerHeader } from '@/ui/owner-header';

/**
 * Owner Mode — the shop, on one screen.
 *
 * The questions a shopkeeper asks, in order: is anybody waiting on me, how
 * did today go, and where do I add the next thing. Everything else a merchant
 * account can do — finance, staff, working hours, settlement — stays on the
 * web portal, which is better at tables and is where that work gets done.
 *
 * The lobby is deliberately a set of doors: the board, the products, the
 * aisles, the shop's own page, and the way back to the customer app without
 * losing the shop's sign-in.
 */
export default function OwnerHomeScreen() {
  const router = useRouter();
  const { state, refresh, parkedAccount, switchToParked } = useSession();
  const owner = useOwner();
  const queryClient = useQueryClient();
  const { choose } = useVertical();
  const me = useMe();

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

  /** The shop's picture and whether it is taking orders — the card's two facts. */
  const settings = useQuery({
    queryKey: ['owner-settings', shop?.id],
    queryFn: () => api.ownerSettings(shop?.id as string),
    enabled: Boolean(shop?.id) && owner.can('settings.read'),
    staleTime: 60_000,
  });

  /** Today, in two numbers. */
  const dashboard = useQuery({
    queryKey: ['owner-dashboard', shop?.id],
    queryFn: () => api.ownerDashboard(shop?.id as string),
    enabled: Boolean(shop?.id) && owner.can('order.read'),
    refetchInterval: 60_000,
  });

  /*
   * Why the shop is not live, while it is not. Asked again every minute so
   * the card notices what the owner just did on another screen, and the
   * moment Jibli switches the shop on — which the shop list, cached from
   * sign-in, would not learn on its own.
   */
  const awaitingActivation = Boolean(shop) && shop?.operational_status !== 'ACTIVE';
  const readiness = useQuery({
    queryKey: ['owner-readiness', shop?.id],
    queryFn: () => api.ownerReadiness(shop?.id as string),
    enabled: Boolean(shop?.id) && awaitingActivation && owner.can('settings.read'),
    refetchInterval: 60_000,
  });
  // Back from the product form or settings: the card counts what just happened.
  const refetchReadiness = readiness.refetch;
  useFocusEffect(
    useCallback(() => {
      if (awaitingActivation) void refetchReadiness();
    }, [awaitingActivation, refetchReadiness]),
  );
  const nowLive = readiness.data?.operational_status === 'ACTIVE';
  const refetchShops = owner.refetch;
  useEffect(() => {
    if (awaitingActivation && nowLive) void refetchShops();
  }, [awaitingActivation, nowLive, refetchShops]);

  const requestActivation = useMutation({
    mutationFn: () => api.ownerRequestActivation(shop?.id as string),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['owner-readiness', shop?.id] });
      notify('وصل طلبك', result.note_ar);
    },
    onError: (caught) =>
      notify('تعذّر طلب التفعيل', caught instanceof ApiError ? caught.messageAr : 'حاول مرة أخرى.'),
  });

  const acceptsOrders = settings.data?.branch.accepts_orders ?? true;
  const toggleOrders = useMutation({
    mutationFn: (accepts: boolean) =>
      api.ownerUpdateSettings(shop?.id as string, { accepts_orders: accepts }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['owner-settings', shop?.id] }),
    onError: (caught) =>
      notify('تعذّر التغيير', caught instanceof ApiError ? caught.messageAr : 'حاول مرة أخرى.'),
  });

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
          <Skeleton height={124} style={{ borderRadius: radius.xl }} />
          <Skeleton height={72} style={{ borderRadius: radius.lg }} />
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
   * The first thing on offer is registering a shop as this very account, which
   * approval turns into a shop this screen opens; the portal login stays,
   * second, for owners who already have one. A restaurant owner is told why
   * their restaurant is not here rather than "you have no shops", which would
   * be false about their own account.
   */
  if (!shop) {
    return (
      <Screen scroll edges={['top', 'bottom']}>
        <OwnerHeader title="متجري" />
        <PartnerHub restaurantOnly={owner.shops.length > 0} onApproved={owner.refetch} />
      </Screen>
    );
  }

  const section = sectionOf(shop.merchant_type);
  const noun = catalogNoun(shop);
  const live = shop.operational_status === 'ACTIVE';
  const logoAssetId = settings.data?.restaurant.logo_asset_id ?? null;

  /**
   * Back to the customer app. The shop stays signed in: if the owner came from
   * a customer account it is restored, and «حسابي» keeps a way back here.
   */
  const leaveToApp = async () => {
    if (parkedAccount === 'customer') await switchToParked();
    router.replace('/(tabs)');
  };

  /** The shop's page as a customer sees it, drawn in the shop's own section. */
  const viewAsCustomer = () => {
    choose(shop.merchant_type);
    router.push({ pathname: '/restaurant/[id]', params: { id: shop.id } });
  };

  return (
    <Screen scroll edges={['top']} padded={false}>
      <View style={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
        <OwnerHeader title="متجري" />

        <PushPrompt audience="owner" />

        {/*
          The password Jibli issued was read out and written down. Until the
          owner replaces it, this is the first thing on the screen.
        */}
        {me?.username && me.must_change_password ? (
          <Pressable
            onPress={() => router.push('/(owner)/password')}
            accessibilityRole="button"
            accessibilityLabel="غيّر كلمة المرور المؤقتة"
            style={({ pressed }) => [
              {
                flexDirection: ROW,
                alignItems: 'center',
                gap: space[3],
                padding: space[3],
                borderRadius: radius.lg,
                backgroundColor: color.warningSoft,
                borderWidth: 1,
                borderColor: color.warningStrong,
              },
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            <MaterialCommunityIcons name="lock-reset" size={24} color={color.warningStrong} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="smallBold">غيّر كلمة المرور المؤقتة</Text>
              <Text variant="caption" tone="secondary">
                كلمة المرور التي أعطاك إياها فريق جيبلي مؤقتة. اختر كلمتك بعد التحقق من رقم هاتفك
                المسجّل.
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-left" size={20} color={color.textMuted} />
          </Pressable>
        ) : null}

        {/* ── The shop ────────────────────────────────────────────────── */}
        <View
          style={{
            padding: space[4],
            borderRadius: radius.xl,
            backgroundColor: section.ramp[500],
            gap: space[3],
            ...shadow.md,
          }}
        >
          <Row gap={space[3]} align="flex-start">
            <Pressable
              onPress={() => router.push('/(owner)/settings')}
              accessibilityRole="button"
              accessibilityLabel="صورة المتجر — تغيير"
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                overflow: 'hidden',
                backgroundColor: 'rgba(255,255,255,0.22)',
                borderWidth: 2,
                borderColor: 'rgba(255,255,255,0.6)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {logoAssetId ? (
                <RemoteImage
                  uri={assetUrl(logoAssetId)}
                  style={{ width: '100%', height: '100%' }}
                />
              ) : (
                <MaterialCommunityIcons
                  name={section.shopIcon}
                  size={30}
                  color="rgba(255,255,255,0.95)"
                />
              )}
            </Pressable>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="caption" tone="inverse" style={{ opacity: 0.85 }}>
                {section.label}
              </Text>
              <Text variant="h3" tone="inverse" numberOfLines={2}>
                {shop.display_name}
              </Text>
              <Text variant="caption" tone="inverse" style={{ opacity: 0.85 }}>
                {!live
                  ? pendingLine(readiness.data)
                  : acceptsOrders
                    ? settings.data && !settings.data.is_open
                      ? 'مغلق الآن حسب ساعات العمل'
                      : 'يستقبل الطلبات'
                    : 'متوقف عن استقبال الطلبات'}
              </Text>
            </View>
            {owner.can('settings.write') && live ? (
              <Switch
                value={acceptsOrders}
                disabled={settings.isLoading || toggleOrders.isPending}
                onValueChange={(value) => toggleOrders.mutate(value)}
                trackColor={{ true: 'rgba(255,255,255,0.55)', false: 'rgba(0,0,0,0.25)' }}
                thumbColor="#fff"
                accessibilityLabel="استقبال الطلبات"
              />
            ) : null}
          </Row>

          <Row gap={space[2]} style={{ flexWrap: 'wrap' }}>
            <CardPill
              icon="pencil-outline"
              label="تعديل المتجر"
              onPress={() => router.push('/(owner)/settings')}
            />
            <CardPill
              icon="clock-outline"
              label="أوقات العمل"
              onPress={() => router.push('/(owner)/hours')}
            />
            {me?.username ? (
              <CardPill
                icon="lock-outline"
                label="كلمة المرور"
                onPress={() => router.push('/(owner)/password')}
              />
            ) : null}
            {owner.usable.length > 1 ? (
              <CardPill
                icon="swap-horizontal"
                label={`تبديل المتجر (${owner.usable.length})`}
                onPress={() => router.push('/(owner)/shops')}
              />
            ) : null}
          </Row>
        </View>

        {/* ── Why not live yet, and what to do about it ─────────────── */}
        {!live && owner.can('settings.read') ? (
          <ActivationCard
            readiness={readiness.data}
            loading={readiness.isLoading}
            error={readiness.isError}
            onRetry={() => void readiness.refetch()}
            onAction={(action) =>
              router.push(
                action === 'pin'
                  ? '/(owner)/settings'
                  : action === 'hours'
                    ? '/(owner)/hours'
                    : counts.categories === 0 && !catalog.isLoading
                      ? '/(owner)/categories'
                      : '/(owner)/product/new',
              )
            }
            // A market or a cosmetics shop is delivered by Jibli's couriers.
            hide={shop.merchant_type === 'RESTAURANT' ? [] : ['hasActiveDriver']}
            onRequest={() => requestActivation.mutate()}
            requesting={requestActivation.isPending}
            canRequest={owner.can('settings.write')}
          />
        ) : null}

        {/* ── Orders first: an order waits on a customer now. ─────────── */}
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
                    ? `${inProgress} قيد التنفيذ — اقبل، جهّز، وأسند للمندوب`
                    : 'اقبل الطلبات وتابع حالتها من هنا'}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-left" size={22} color={color.textMuted} />
          </Pressable>
        ) : null}

        {/* ── Today ───────────────────────────────────────────────────── */}
        {owner.can('order.read') ? (
          <Row gap={space[3]}>
            <Stat
              label="طلبات اليوم"
              value={dashboard.isLoading ? '…' : String(dashboard.data?.orders_today ?? 0)}
            />
            <Stat
              label="مبيعات اليوم"
              value={
                dashboard.isLoading
                  ? '…'
                  : formatIqdArabic(iqd(dashboard.data?.sales_today_iqd ?? 0))
              }
            />
          </Row>
        ) : null}

        {/* ── The catalog ─────────────────────────────────────────────── */}
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
              <Tile
                icon="basket-outline"
                title={noun}
                caption={
                  catalog.isLoading
                    ? '…'
                    : counts.products === 0
                      ? 'لا شيء بعد'
                      : countAr(counts.products, PRODUCTS)
                }
                onPress={() => router.push('/(owner)/products')}
              />
              <Tile
                icon="label-outline"
                title="الأقسام"
                caption={
                  catalog.isLoading
                    ? '…'
                    : counts.categories === 0
                      ? 'أنشئها أولاً'
                      : String(counts.categories)
                }
                highlight={!catalog.isLoading && counts.categories === 0 && owner.can('menu.write')}
                onPress={() => router.push('/(owner)/categories')}
              />
            </Row>

            {/*
              The two numbers that are to-dos rather than facts: a product with
              no photograph is the commonest reason a customer scrolls past it,
              and the phone is the device that fixes that.
            */}
            {!catalog.isLoading && (counts.withoutPhoto > 0 || counts.unavailable > 0) ? (
              <Row gap={space[2]} style={{ flexWrap: 'wrap' }}>
                {counts.withoutPhoto > 0 ? (
                  <Todo
                    icon="camera-plus-outline"
                    label={`${counts.withoutPhoto} بلا صورة`}
                    onPress={() => router.push('/(owner)/products?filter=no-photo')}
                  />
                ) : null}
                {counts.unavailable > 0 ? (
                  <Todo
                    icon="eye-off-outline"
                    label={`${counts.unavailable} غير متوفر`}
                    onPress={() => router.push('/(owner)/products?filter=unavailable')}
                  />
                ) : null}
              </Row>
            ) : null}

            {owner.can('menu.write') ? (
              <Button
                label="إضافة منتج"
                block
                size="lg"
                icon={<MaterialCommunityIcons name="plus" size={20} color={color.textInverse} />}
                onPress={() =>
                  router.push(
                    counts.categories === 0 && !catalog.isLoading
                      ? '/(owner)/categories'
                      : '/(owner)/product/new',
                  )
                }
              />
            ) : (
              <Text variant="caption" tone="muted" align="center">
                حسابك يستطيع العرض فقط. الإضافة والتعديل تحتاج صلاحية من صاحب المتجر.
              </Text>
            )}
          </>
        )}

        {/* ── Out, without leaving ────────────────────────────────────── */}
        <View style={{ gap: space[2], paddingTop: space[2] }}>
          <Button
            label="عرض المتجر كما يراه الزبون"
            variant="secondary"
            block
            icon={<MaterialCommunityIcons name="eye-outline" size={18} color={color.textPrimary} />}
            onPress={viewAsCustomer}
          />
          {!live ? (
            <Text variant="caption" tone="muted" align="center">
              قبل التفعيل تفتح الصفحة لك وحدك؛ لا يراها الزبائن.
            </Text>
          ) : null}
          <LeaveRow parked={parkedAccount === 'customer'} onPress={() => void leaveToApp()} />
        </View>
      </View>
    </Screen>
  );
}

/** The one line under the shop's name while it is not live. */
function pendingLine(readiness: OwnerReadiness | undefined): string {
  if (!readiness) return 'غير مفعّل بعد';
  const state = activationState(readiness);
  switch (state.kind) {
    case 'requested':
      return 'طُلب التفعيل — بانتظار فريق جيبلي';
    case 'ready':
      return 'جاهز للتفعيل';
    case 'suspended':
      return 'موقوف مؤقتاً';
    case 'todo':
      return state.mine > 0 ? 'غير مفعّل — أكمل الخطوات أدناه' : 'غير مفعّل — بانتظار فريق جيبلي';
    default:
      return 'يستقبل الطلبات';
  }
}

/** A small white action on the shop card. */
function CardPill({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          flexDirection: ROW,
          alignItems: 'center',
          gap: space[1],
          paddingVertical: space[1],
          paddingHorizontal: space[3],
          minHeight: TAP_TARGET - 12,
          borderRadius: radius.full,
          backgroundColor: 'rgba(255,255,255,0.22)',
        },
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={15} color="#fff" />
      <Text variant="caption" tone="inverse">
        {label}
      </Text>
    </Pressable>
  );
}

/** A door to one part of the shop, with the one number worth knowing before opening it. */
function Tile({
  icon,
  title,
  caption,
  highlight = false,
  onPress,
}: {
  icon: IconName;
  title: string;
  caption: string;
  highlight?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${caption}`}
      style={({ pressed }) => [
        {
          flex: 1,
          padding: space[3],
          gap: space[2],
          borderRadius: radius.lg,
          backgroundColor: highlight ? color.brandSoft : color.surfaceCard,
          borderWidth: 1,
          borderColor: highlight ? color.brand : color.borderSubtle,
        },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={24} color={color.brand} />
      <View style={{ gap: 2 }}>
        <Text variant="bodyBold">{title}</Text>
        <Text variant="caption" tone={highlight ? 'brand' : 'muted'} numberOfLines={1}>
          {caption}
        </Text>
      </View>
    </Pressable>
  );
}

/** Something on the shelf that needs doing, one tap from the list that shows it. */
function Todo({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flexDirection: ROW,
          alignItems: 'center',
          gap: space[1],
          minHeight: TAP_TARGET - 8,
          paddingHorizontal: space[3],
          borderRadius: radius.full,
          backgroundColor: color.warningSoft,
        },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={16} color={color.warningStrong} />
      <Text variant="caption" style={{ color: color.warningStrong }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The way back to the customer app — with the shop kept signed in. */
function LeaveRow({ parked, onPress }: { parked: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flexDirection: ROW,
          alignItems: 'center',
          gap: space[3],
          padding: space[3],
          borderRadius: radius.lg,
          backgroundColor: color.surfaceSunken,
        },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <MaterialCommunityIcons name="home-outline" size={22} color={color.textSecondary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="smallBold">{parked ? 'العودة إلى حسابي كزبون' : 'تصفّح التطبيق كزبون'}</Text>
        <Text variant="caption" tone="muted">
          يبقى متجرك مسجّلاً — ارجع إليه من «حسابي» بلا كلمة مرور.
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-left" size={20} color={color.textMuted} />
    </Pressable>
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
        {/*
         * The commonest way for a market to land here is to have been filed
         * as a restaurant, and the fix is one field in Admin — said here, or
         * the owner concludes the app does not do what it was sold as doing.
         */}
        {restaurantOnly ? (
          <Text variant="caption" tone="muted">
            متجرك ماركت أو متجر تجميل وظهر هنا كمطعم؟ نوعه مسجّل خطأً — يصحّحه فريق جيبلي من لوحة
            الإدارة (صفحة المتجر ← نوع الشريك) ثم يفتح هنا.
          </Text>
        ) : null}
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
          body={
            rejected.rejection_reason
              ? `السبب: ${rejected.rejection_reason}`
              : 'يمكنك تعديل البيانات وتقديم طلب جديد.'
          }
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

      {/*
       * The other door, the same size as the first. It was a ghost link under
       * the primary button, and the owner of a real username read the screen
       * as "register, or nothing".
       */}
      <Door
        icon="key-outline"
        tint={sectionOf('MARKET').ramp}
        title="لديّ حساب متجر"
        body="أصدر لك فريق جيبلي اسم مستخدم وكلمة مرور؟ ادخل بهما لتفتح متجرك: المنتجات، الأسعار، والطلبات الحيّة."
        cta="الدخول باسم المستخدم"
        onPress={() => router.push('/(auth)/owner-login')}
      />

      {/* The courier's door, as on the welcome screen's version of this hub. */}
      <Door
        icon="motorbike"
        title="مندوب توصيل؟"
        body="أصدر لك المطعم أو المتجر الذي تعمل معه اسم مستخدم وكلمة مرور؟ ادخل بهما لتستلم التوصيلات وتتابعها من هذا التطبيق."
        cta="دخول المندوبين"
        onPress={() => router.push('/(auth)/driver-login')}
      />
    </View>
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

/** A number and what it counts. Two of these share a row. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flex: 1,
        padding: space[3],
        borderRadius: radius.lg,
        backgroundColor: color.surfaceCard,
        borderWidth: 1,
        borderColor: color.borderSubtle,
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Text variant="h3" numberOfLines={1}>
        {value}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
