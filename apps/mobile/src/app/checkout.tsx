import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError, idempotencyKey, NetworkError, type Address } from '@/lib/api';
import { registerForPush } from '@/lib/push';
import { customerDeliveryFee } from '@/lib/delivery-fee';
import { useCart, useOrderLines } from '@/lib/cart';
import { notify } from '@/lib/dialog';
import { color, palette, radius, ROW, shadow, space, TAP_TARGET } from '@/theme';
import { Button, EmptyState, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';
import { SummaryRow } from '@/ui/catalog';
import { AddressSheet } from '@/ui/address-sheet';
import { loadPreferredAddressId, resolvePreferred } from '@/lib/preferred-address';

/**
 * Checkout: where the order is going, what it costs, and placing it.
 *
 * Two rules run this screen.
 *
 * The total shown is the server's, from `POST /checkout/quote` — the same
 * pricing path placement uses, so the customer cannot be charged something
 * other than what they agreed to (plan §22). It is re-quoted whenever the
 * address changes, because delivery is priced per address.
 *
 * The order carries an idempotency key that is generated once and reused on
 * every retry. A mobile network that times out after the server has committed
 * must not produce a second order (plan §27) — the customer would be charged
 * twice for a dinner they ordered once, and the restaurant would cook it twice.
 */
export default function CheckoutScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { notes } = useLocalSearchParams<{ notes?: string }>();
  const { cart, subtotalIqd, clear } = useCart();
  const lines = useOrderLines();

  const [addressId, setAddressId] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);

  /*
   * One key per checkout attempt, not per tap.
   *
   * Generated when the screen mounts and held in a ref: `useState` would give
   * the same guarantee, but a ref says plainly that this value is not allowed
   * to change with a render.
   */
  const orderKey = useRef(idempotencyKey('order'));

  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.addresses(),
  });

  /*
   * Start from the address this phone last chose, then the account's default.
   *
   * The header lets somebody switch to «الأنبار — حديثة» without a round trip,
   * and there is no endpoint to move the server's default — so checkout has to
   * read the same local preference, or the choice made two screens ago quietly
   * does not apply to the order.
   */
  const preferredId = useQuery({
    queryKey: ['addresses', 'preferred'],
    queryFn: () => loadPreferredAddressId(),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (addressId || !addresses.data || addresses.data.length === 0) return;
    if (preferredId.isLoading) return;
    const preferred = resolvePreferred(addresses.data, preferredId.data ?? null);
    if (preferred) setAddressId(preferred.id);
  }, [addresses.data, addressId, preferredId.data, preferredId.isLoading]);

  const quote = useQuery({
    queryKey: ['quote', cart?.restaurantId, addressId, lines],
    queryFn: () =>
      api.quote({
        restaurant_id: cart?.restaurantId as string,
        branch_id: cart?.branchId as string,
        address_id: addressId as string,
        lines,
      }),
    enabled: Boolean(cart && addressId && lines.length > 0),
    // Prices and fees can move; a stale quote is the thing this screen exists
    // to prevent.
    staleTime: 0,
    retry: false,
  });

  const place = useMutation({
    mutationFn: () =>
      api.placeOrder(
        {
          restaurant_id: cart?.restaurantId,
          branch_id: cart?.branchId,
          address_id: addressId,
          lines,
          ...(notes ? { customer_notes: notes } : {}),
          // What the customer was shown. A mismatch raises PRICE_CHANGED on the
          // server rather than silently charging the new number (plan §112).
          ...(quote.data ? { expected_total_iqd: quote.data.customer_total_iqd } : {}),
        },
        orderKey.current,
      ),
    onSuccess: (order) => {
      clear();
      void queryClient.invalidateQueries({ queryKey: ['my-orders'] });

      /*
       * The moment to ask for notifications, and the only one.
       *
       * `registerForPush` was written for exactly this call and nothing ever
       * made it — so the permission the app declares was never requested, no
       * token ever reached the server, and every "your order was accepted" the
       * worker produced had nowhere to go. Asked here rather than at launch
       * because "tell me when my food arrives" is a question with an obvious
       * answer only once there is food on the way. It never rejects, and it is
       * deliberately not awaited: a customer who declines has still placed a
       * perfectly good order and should be looking at it already.
       */
      void registerForPush();

      // `placed=1` is what turns the order screen's header into a confirmation
      // rather than a status it silently already had.
      router.replace(`/order/${order.order_id}?placed=1`);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        // PRICE_CHANGED and MINIMUM_ORDER_NOT_MET are answers, not failures:
        // re-quote so the customer sees the new number and decides again.
        void quote.refetch();
        notify('تعذّر إتمام الطلب', error.messageAr);
        return;
      }
      if (error instanceof NetworkError) {
        notify(
          'انقطع الاتصال',
          'لم نتمكن من تأكيد الطلب. تحقّق من «طلباتي» قبل المحاولة مرة أخرى.',
        );
        return;
      }
      notify('خطأ غير متوقع', 'حاول مرة أخرى.');
    },
  });

  const selected = useMemo(
    () => (addresses.data ?? []).find((entry) => entry.id === addressId) ?? null,
    [addresses.data, addressId],
  );

  if (!cart) {
    return (
      <Screen edges={['top', 'bottom']}>
        <EmptyState
          title="لا يوجد طلب"
          body="سلتك فارغة."
          action={{ label: 'تصفّح المطاعم', onPress: () => router.replace('/(tabs)') }}
        />
      </Screen>
    );
  }

  const deliveryShownIqd = quote.data
    ? customerDeliveryFee(quote.data.delivery_fee_iqd, quote.data.platform_service_fee_iqd)
    : 0;
  const totalIqd = quote.data?.customer_total_iqd ?? null;
  const canPlace = Boolean(selected && quote.data) && !place.isPending;

  return (
    <Screen edges={['top']} padded={false}>
      <Row
        justify="space-between"
        style={{ paddingHorizontal: space[4], paddingVertical: space[2], gap: space[3] }}
      >
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/cart'))}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          style={({ pressed }) => [
            {
              width: 40,
              height: 40,
              borderRadius: radius.full,
              backgroundColor: color.surfaceCard,
              borderWidth: 1,
              borderColor: color.borderSubtle,
              alignItems: 'center',
              justifyContent: 'center',
            },
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <MaterialCommunityIcons name="chevron-right" size={24} color={color.textPrimary} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="h3" align="center">
            تأكيد الطلب
          </Text>
          <Text variant="caption" tone="muted" align="center" numberOfLines={1}>
            من {cart.restaurantName}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </Row>

      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}
        showsVerticalScrollIndicator={false}
      >
        <Section title="عنوان التوصيل" icon="map-marker-radius-outline">
          {addresses.isLoading ? (
            <Skeleton height={72} />
          ) : addresses.isError ? (
            <ErrorState
              message={
                addresses.error instanceof ApiError
                  ? addresses.error.messageAr
                  : 'تعذّر تحميل العناوين'
              }
              onRetry={() => void addresses.refetch()}
            />
          ) : (addresses.data ?? []).length === 0 ? (
            <View style={{ gap: space[3] }}>
              <Text tone="muted" variant="small">
                لم تُضف عنواناً بعد. نحتاج عنواناً لتوصيل الطلب.
              </Text>
              <Button label="إضافة عنوان" onPress={() => setAddingAddress(true)} />
            </View>
          ) : (
            <View style={{ gap: space[2] }}>
              {(addresses.data ?? []).map((entry) => (
                <AddressRow
                  key={entry.id}
                  address={entry}
                  selected={entry.id === addressId}
                  onPress={() => setAddressId(entry.id)}
                />
              ))}
              <Pressable
                onPress={() => setAddingAddress(true)}
                accessibilityRole="button"
                accessibilityLabel="إضافة عنوان جديد"
                style={({ pressed }) => [
                  {
                    minHeight: TAP_TARGET,
                    flexDirection: ROW,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: space[2],
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderStyle: 'dashed',
                    borderColor: color.brand,
                  },
                  pressed ? { backgroundColor: color.brandSoft } : null,
                ]}
              >
                <MaterialCommunityIcons name="plus" size={18} color={color.brand} />
                <Text variant="smallBold" tone="brand">
                  إضافة عنوان جديد
                </Text>
              </Pressable>
            </View>
          )}
        </Section>

        <Section title="طريقة الدفع" icon="cash">
          {/*
           * Cash on delivery is the only method, and that is deliberate: food
           * is a physical good, so Apple's in-app-purchase requirement
           * (guideline 3.1.1) does not apply and must not be used.
           */}
          <View
            style={{
              flexDirection: ROW,
              alignItems: 'center',
              gap: space[3],
              padding: space[3],
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: color.brand,
              backgroundColor: color.brandSoft,
            }}
          >
            <IconTile name="cash-multiple" />
            <View style={{ flex: 1 }}>
              <Text variant="smallBold">نقداً عند الاستلام</Text>
              <Text variant="caption" tone="muted">
                ادفع للمندوب عند وصول طلبك
              </Text>
            </View>
            <RadioMark selected />
          </View>
        </Section>

        <Section title="ملخص الطلب" icon="receipt-text-outline">
          {quote.isLoading ? (
            <Skeleton height={112} />
          ) : quote.isError ? (
            <QuoteError error={quote.error} onRetry={() => void quote.refetch()} />
          ) : quote.data ? (
            <View style={{ gap: space[3] }}>
              <SummaryRow
                label="المجموع الفرعي"
                value={formatIqdArabic(iqd(quote.data.items_subtotal_iqd))}
              />
              {quote.data.discount_total_iqd > 0 ? (
                <SummaryRow
                  label="الخصم"
                  value={`− ${formatIqdArabic(iqd(quote.data.discount_total_iqd))}`}
                  tone="success"
                />
              ) : null}
              {/* The service fee is inside this figure — see lib/delivery-fee. */}
              <SummaryRow
                label="رسوم التوصيل"
                value={deliveryShownIqd === 0 ? 'مجاناً' : formatIqdArabic(iqd(deliveryShownIqd))}
                tone={deliveryShownIqd === 0 ? 'success' : undefined}
              />
              <SummaryRow
                label="الإجمالي"
                value={formatIqdArabic(iqd(quote.data.customer_total_iqd))}
                emphasis
              />
              <View
                style={{
                  flexDirection: ROW,
                  alignItems: 'center',
                  alignSelf: 'center',
                  gap: space[2],
                  paddingVertical: space[2],
                  paddingHorizontal: space[3],
                  borderRadius: radius.full,
                  backgroundColor: color.surfaceSunken,
                }}
              >
                <MaterialCommunityIcons name="clock-outline" size={16} color={color.brand} />
                <Text variant="caption" tone="secondary">
                  يصل خلال {quote.data.estimated_preparation_minutes} دقيقة تقريباً
                </Text>
              </View>
            </View>
          ) : (
            <Text variant="small" tone="muted">
              اختر عنوان التوصيل لحساب الإجمالي.
            </Text>
          )}
        </Section>

        {notes ? (
          <Section title="ملاحظاتك" icon="note-text-outline">
            <Text variant="small" tone="secondary">
              {notes}
            </Text>
          </Section>
        ) : null}
      </ScrollView>

      {/*
        One bar, one button, the total on it. The total used to be printed
        above the button as well as inside the summary — three places for one
        number. On the button it is also what is being agreed to.
      */}
      <View
        style={{
          paddingHorizontal: space[4],
          paddingTop: space[3],
          paddingBottom: space[6],
          backgroundColor: color.surfaceCard,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          ...shadow.lg,
        }}
      >
        <Pressable
          onPress={() => place.mutate()}
          disabled={!canPlace}
          accessibilityRole="button"
          accessibilityLabel={
            totalIqd === null
              ? 'تأكيد الطلب'
              : `تأكيد الطلب، الإجمالي ${formatIqdArabic(iqd(totalIqd))}`
          }
          accessibilityState={{ disabled: !canPlace, busy: place.isPending }}
          style={({ pressed }) => [
            {
              minHeight: 56,
              flexDirection: ROW,
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: space[5],
              borderRadius: radius.full,
              backgroundColor: color.brand,
              opacity: canPlace || place.isPending ? 1 : 0.45,
            },
            pressed ? { backgroundColor: color.brandStrong } : null,
          ]}
        >
          {place.isPending ? (
            <View style={{ flex: 1, alignItems: 'center' }}>
              <ActivityIndicator color={palette.white} />
            </View>
          ) : (
            <>
              <Text variant="bodyBold" tone="inverse">
                تأكيد الطلب
              </Text>
              <View
                style={{
                  paddingVertical: space[1],
                  paddingHorizontal: space[3],
                  borderRadius: radius.full,
                  backgroundColor: 'rgba(255,255,255,0.2)',
                }}
              >
                <Text variant="bodyBold" tone="inverse">
                  {formatIqdArabic(iqd(totalIqd ?? subtotalIqd))}
                </Text>
              </View>
            </>
          )}
        </Pressable>
      </View>

      <AddressSheet
        visible={addingAddress}
        // Not «ثبّت منزلك» here: somebody adding a second address mid-checkout
        // is sending this order to the office, not moving house.
        title="عنوان جديد"
        onClose={() => setAddingAddress(false)}
        onSaved={(saved) => {
          setAddressId(saved);
          setAddingAddress(false);
          void addresses.refetch();
        }}
      />
    </Screen>
  );
}

type GlyphName = keyof typeof MaterialCommunityIcons.glyphMap;

/** A glyph on a soft square in the section's colour — the screen's one icon style. */
function IconTile({ name, muted = false }: { name: GlyphName; muted?: boolean }) {
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: radius.md,
        backgroundColor: muted ? color.surfaceSunken : color.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <MaterialCommunityIcons
        name={name}
        size={20}
        color={muted ? color.textSecondary : color.brand}
      />
    </View>
  );
}

/** A radio mark, drawn: filled ring when chosen, empty when not. */
function RadioMark({ selected }: { selected: boolean }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: selected ? color.brand : color.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {selected ? (
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.brand }} />
      ) : null}
    </View>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: GlyphName;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        gap: space[3],
        padding: space[4],
        borderRadius: radius.xl,
        backgroundColor: color.surfaceCard,
        ...shadow.sm,
      }}
    >
      <View style={{ flexDirection: ROW, alignItems: 'center', gap: space[2] }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.full,
            backgroundColor: color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name={icon} size={16} color={color.brand} />
        </View>
        <Text variant="bodyBold">{title}</Text>
      </View>
      {children}
    </View>
  );
}

/** Home, work, or a pin — read from the label the customer gave it. */
function addressGlyph(label: string | null): GlyphName {
  if (!label) return 'map-marker-outline';
  if (/منزل|بيت/.test(label)) return 'home-outline';
  if (/عمل|مكتب|دوام/.test(label)) return 'briefcase-outline';
  return 'map-marker-outline';
}

function AddressRow({
  address,
  selected,
  onPress,
}: {
  address: Address;
  selected: boolean;
  onPress: () => void;
}) {
  /*
   * Never a bare dash. An address saved from a pin often has no street or
   * building, and «المنزل / —» twice in a row gave two identical rows nobody
   * could tell apart; the city and governorate always exist.
   */
  const summary =
    [address.district_text, address.street, address.building, address.landmark]
      .filter(Boolean)
      .join('، ') || `${address.governorate.name_ar} — ${address.city.name_ar}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${address.label ?? 'عنوان'}، ${summary}`}
      style={({ pressed }) => [
        {
          flexDirection: ROW,
          alignItems: 'center',
          gap: space[3],
          minHeight: TAP_TARGET + 12,
          padding: space[3],
          borderRadius: radius.md,
          borderWidth: selected ? 1.5 : 1,
          borderColor: selected ? color.brand : color.borderSubtle,
          backgroundColor: selected ? color.brandSoft : color.surfaceCard,
        },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <IconTile name={addressGlyph(address.label)} muted={!selected} />
      <View style={{ flex: 1 }}>
        <Text variant="smallBold">{address.label ?? 'عنوان'}</Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {summary}
        </Text>
      </View>
      <RadioMark selected={selected} />
    </Pressable>
  );
}

/**
 * Adding an address.
 *
 * The governorate and city come from the area the customer is already
 * browsing, rather than asking them to pick the same thing twice — they are
 * ordering to where they are looking. Both are re-validated on the server
 * against current capability, so an area disabled since this screen loaded is
 * refused there rather than trusted here.
 */
function QuoteError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const router = useRouter();
  const { cart, remove } = useCart();

  const api = error instanceof ApiError ? error : null;
  const details = (api?.details ?? {}) as { menuItemId?: unknown; groupNameAr?: unknown };
  const menuItemId = typeof details.menuItemId === 'string' ? details.menuItemId : null;
  const groupNameAr = typeof details.groupNameAr === 'string' ? details.groupNameAr : null;

  const line = menuItemId
    ? (cart?.lines.find((entry) => entry.menuItemId === menuItemId) ?? null)
    : null;

  if (!line || !cart) {
    return <ErrorState message={api?.messageAr ?? 'تعذّر حساب الطلب'} onRetry={onRetry} />;
  }

  return (
    <View
      style={{
        padding: space[4],
        borderRadius: radius.lg,
        backgroundColor: color.dangerSoft,
        borderWidth: 1,
        borderColor: color.danger,
        gap: space[3],
      }}
    >
      <Text variant="smallBold" tone="danger">
        {api?.messageAr ?? 'تعذّر حساب الطلب'}
      </Text>

      <Text variant="small" tone="secondary">
        {groupNameAr
          ? `«${line.nameAr}» يحتاج اختيار ${groupNameAr} قبل الطلب.`
          : `المشكلة في «${line.nameAr}».`}
      </Text>

      <Row gap={space[2]}>
        <Button
          label="اختيار الخيارات"
          style={{ alignSelf: 'center' }}
          onPress={() => router.push(`/restaurant/${cart.restaurantId}?item=${line.menuItemId}`)}
        />
        <Button
          label="حذف الصنف"
          variant="secondary"
          style={{ alignSelf: 'center' }}
          onPress={() => {
            remove(line.key);
            onRetry();
          }}
        />
      </Row>
    </View>
  );
}
