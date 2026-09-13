import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError, idempotencyKey, NetworkError, type Address } from '@/lib/api';
import { useArea } from '@/lib/area';
import { captureCurrentLocation, LOCATION_MESSAGES_AR, type Coordinates } from '@/lib/location';
import { useCart, useOrderLines } from '@/lib/cart';
import { color, radius, space, TAP_TARGET, text } from '@/theme';
import { Button, EmptyState, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';
import { Sheet, SummaryRow } from '@/ui/catalog';

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

  // Default to the address the customer marked as default, else the first.
  useEffect(() => {
    if (addressId || !addresses.data || addresses.data.length === 0) return;
    const preferred = addresses.data.find((entry) => entry.is_default) ?? addresses.data[0];
    if (preferred) setAddressId(preferred.id);
  }, [addresses.data, addressId]);

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
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      router.replace(`/order/${order.order_id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        // PRICE_CHANGED and MINIMUM_ORDER_NOT_MET are answers, not failures:
        // re-quote so the customer sees the new number and decides again.
        void quote.refetch();
        Alert.alert('تعذّر إتمام الطلب', error.messageAr);
        return;
      }
      if (error instanceof NetworkError) {
        Alert.alert(
          'انقطع الاتصال',
          'لم نتمكن من تأكيد الطلب. تحقّق من «طلباتي» قبل المحاولة مرة أخرى.',
        );
        return;
      }
      Alert.alert('خطأ غير متوقع', 'حاول مرة أخرى.');
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

  return (
    <Screen edges={['top']} padded={false}>
      <Row justify="space-between" style={{ paddingHorizontal: space[4], minHeight: TAP_TARGET }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/cart'))}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          style={{ width: TAP_TARGET, height: TAP_TARGET, justifyContent: 'center' }}
        >
          <MaterialCommunityIcons name="chevron-right" size={26} color={color.textPrimary} />
        </Pressable>
        <Text variant="h3">تأكيد الطلب</Text>
        <View style={{ width: TAP_TARGET }} />
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
                style={{ minHeight: TAP_TARGET, justifyContent: 'center' }}
              >
                <Text variant="smallBold" tone="brand">
                  + إضافة عنوان جديد
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
          <Row gap={space[2]}>
            <MaterialCommunityIcons name="check-circle" size={18} color={color.success} />
            <Text variant="small">الدفع نقداً عند الاستلام</Text>
          </Row>
        </Section>

        <Section title="الملخص" icon="wallet-outline">
          {quote.isLoading ? (
            <Skeleton height={112} />
          ) : quote.isError ? (
            <ErrorState
              message={quote.error instanceof ApiError ? quote.error.messageAr : 'تعذّر حساب الطلب'}
              onRetry={() => void quote.refetch()}
            />
          ) : quote.data ? (
            <View style={{ gap: space[2] }}>
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
              <SummaryRow
                label="رسوم التوصيل"
                value={
                  quote.data.delivery_fee_iqd === 0
                    ? 'مجاناً'
                    : formatIqdArabic(iqd(quote.data.delivery_fee_iqd))
                }
                tone={quote.data.delivery_fee_iqd === 0 ? 'success' : undefined}
              />
              {quote.data.platform_service_fee_iqd > 0 ? (
                <SummaryRow
                  label="رسوم الخدمة"
                  value={formatIqdArabic(iqd(quote.data.platform_service_fee_iqd))}
                />
              ) : null}
              <SummaryRow
                label="الإجمالي"
                value={formatIqdArabic(iqd(quote.data.customer_total_iqd))}
                emphasis
              />
              <Text variant="caption" tone="muted">
                يصل خلال {quote.data.estimated_preparation_minutes} دقيقة تقريباً
              </Text>
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

      <View
        style={{
          padding: space[4],
          paddingBottom: space[6],
          backgroundColor: color.surfaceCard,
          borderTopWidth: 1,
          borderTopColor: color.borderSubtle,
          gap: space[2],
        }}
      >
        <Row justify="space-between">
          <Text variant="small" tone="muted">
            الإجمالي
          </Text>
          <Text variant="h3" tone="brand">
            {formatIqdArabic(iqd(quote.data?.customer_total_iqd ?? subtotalIqd))}
          </Text>
        </Row>
        <Button
          label="تأكيد الطلب"
          block
          loading={place.isPending}
          disabled={!selected || !quote.data || place.isPending}
          onPress={() => place.mutate()}
        />
      </View>

      <AddressSheet
        visible={addingAddress}
        onClose={() => setAddingAddress(false)}
        onCreated={(created) => {
          setAddressId(created.id);
          setAddingAddress(false);
          void addresses.refetch();
        }}
      />
    </Screen>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        gap: space[3],
        padding: space[4],
        borderRadius: radius.lg,
        backgroundColor: color.surfaceCard,
        borderWidth: 1,
        borderColor: color.borderSubtle,
      }}
    >
      <Row gap={space[2]}>
        <MaterialCommunityIcons name={icon} size={18} color={color.brand} />
        <Text variant="smallBold">{title}</Text>
      </Row>
      {children}
    </View>
  );
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
  const summary = [address.district_text, address.street, address.building]
    .filter(Boolean)
    .join('، ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={address.label ?? summary}
      style={{
        minHeight: TAP_TARGET + 8,
        paddingHorizontal: space[3],
        paddingVertical: space[2],
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: selected ? color.brand : color.borderSubtle,
        backgroundColor: selected ? color.brandSoft : color.surfaceCard,
        justifyContent: 'center',
      }}
    >
      <Row justify="space-between">
        <View style={{ flex: 1 }}>
          <Text variant="smallBold">{address.label ?? 'عنوان'}</Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {summary || '—'}
          </Text>
        </View>
        {selected ? (
          <MaterialCommunityIcons name="check-circle" size={20} color={color.brand} />
        ) : null}
      </Row>
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
function AddressSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (address: Address) => void;
}) {
  const { area } = useArea();
  const [label, setLabel] = useState('المنزل');
  const [district, setDistrict] = useState('');
  const [street, setStreet] = useState('');
  const [landmark, setLandmark] = useState('');
  /**
   * A point on the address, captured once with permission.
   *
   * Optional on purpose: in a city where addresses are landmarks rather than
   * street numbers, «قرب صيدلية النور» is what actually gets the driver there,
   * and a coordinate is an extra rather than a replacement. Everything works
   * without it.
   */
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);

  const locate = async () => {
    setLocating(true);
    const outcome = await captureCurrentLocation();
    setLocating(false);

    if (outcome.status === 'ok') {
      setCoordinates(outcome.coordinates);
      return;
    }
    Alert.alert('تحديد الموقع', LOCATION_MESSAGES_AR[outcome.status]);
  };

  const create = useMutation({
    mutationFn: () =>
      api.createAddress({
        label,
        governorate_id: area?.governorateId,
        city_id: area?.cityId,
        ...(district ? { district_text: district } : {}),
        ...(street ? { street } : {}),
        ...(landmark ? { landmark } : {}),
        ...(coordinates
          ? {
              coordinates: {
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
              },
            }
          : {}),
        is_default: true,
      }),
    onSuccess: onCreated,
    onError: (error) => {
      Alert.alert(
        'تعذّر حفظ العنوان',
        error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى.',
      );
    },
  });

  const canSave = Boolean(area) && district.trim().length > 0;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="عنوان جديد"
      footer={
        <Button
          label="حفظ العنوان"
          block
          disabled={!canSave || create.isPending}
          loading={create.isPending}
          onPress={() => create.mutate()}
        />
      }
    >
      {area ? (
        <Row gap={space[2]}>
          <MaterialCommunityIcons name="map-marker-outline" size={18} color={color.brand} />
          <Text variant="small" tone="secondary">
            {area.governorateNameAr} — {area.cityNameAr}
          </Text>
        </Row>
      ) : (
        <Text variant="small" tone="danger">
          اختر منطقتك من الشاشة الرئيسية أولاً.
        </Text>
      )}

      {/*
        * The point, offered before the fields.
        *
        * It is the one thing that removes ambiguity from a landmark address,
        * and offering it first means a customer who taps it has less typing to
        * feel guilty about skipping.
        */}
      <Pressable
        onPress={() => void locate()}
        disabled={locating}
        accessibilityRole="button"
        accessibilityLabel="تحديد موقعي الحالي"
        style={({ pressed }) => [
          {
            minHeight: TAP_TARGET + 6,
            borderRadius: radius.md,
            borderWidth: 1,
            borderStyle: coordinates ? 'solid' : 'dashed',
            borderColor: coordinates ? color.success : color.borderStrong,
            backgroundColor: coordinates ? color.successSoft : color.surfaceCard,
            paddingHorizontal: space[3],
            justifyContent: 'center',
          },
          pressed ? { opacity: 0.7 } : null,
        ]}
      >
        <Row gap={space[2]}>
          <MaterialCommunityIcons
            name={coordinates ? 'map-marker-check' : 'crosshairs-gps'}
            size={20}
            color={coordinates ? color.successStrong : color.brand}
          />
          <View style={{ flex: 1 }}>
            <Text variant="smallBold" tone={coordinates ? 'success' : 'brand'}>
              {locating
                ? 'جارٍ تحديد الموقع…'
                : coordinates
                  ? 'تم تحديد الموقع'
                  : 'تحديد موقعي الحالي'}
            </Text>
            <Text variant="caption" tone="muted">
              {coordinates
                ? `دقة تقريبية ${Math.round(coordinates.accuracy ?? 0)} متر — اضغط للتحديث`
                : 'اختياري، يساعد المندوب في الوصول بدقة'}
            </Text>
          </View>
        </Row>
      </Pressable>

      <LabelledInput label="الاسم" value={label} onChangeText={setLabel} placeholder="المنزل، العمل…" />
      <LabelledInput
        label="المنطقة / الحي"
        value={district}
        onChangeText={setDistrict}
        placeholder="المنصور، حي الجامعة…"
      />
      <LabelledInput label="الشارع" value={street} onChangeText={setStreet} placeholder="شارع ١٤ رمضان" />
      <LabelledInput
        label="أقرب نقطة دالة"
        value={landmark}
        onChangeText={setLandmark}
        placeholder="قرب صيدلية النور"
      />
    </Sheet>
  );
}

function LabelledInput({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
}) {
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.textMuted}
        accessibilityLabel={label}
        style={[
          text.small,
          {
            minHeight: TAP_TARGET,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: color.borderSubtle,
            backgroundColor: color.surfaceCard,
            paddingHorizontal: space[3],
            color: color.textPrimary,
          },
        ]}
      />
    </View>
  );
}
