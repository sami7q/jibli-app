import { useState } from 'react';
import { Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, assetUrl } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { useIsGuest } from '@/lib/session';
import { ALIGN_END, ROW, TAP_TARGET, accent, color, radius, shadow, space, text } from '@/theme';
import { missingImageGlyph } from '@/ui/section-glyph';
import { Button, EmptyState, Row, Screen, Text } from '@/ui';
import { Stepper, SummaryRow } from '@/ui/catalog';

/**
 * The cart (`5.html`).
 *
 * The totals here are the ones this screen can be sure of: the prices the menu
 * showed and the delivery fee the restaurant charges. The service fee and any
 * discount come from `POST /checkout/quote` on the next screen, because they
 * depend on the delivery address, and showing a total that later changes is
 * worse than showing one line fewer.
 */
export default function CartScreen() {
  const router = useRouter();
  const isGuest = useIsGuest();
  const { cart, subtotalIqd, itemCount, setQuantity, remove, clear } = useCart();
  const [notes, setNotes] = useState('');

  /*
   * The service fee, read from the storefront.
   *
   * The cart used to show only the subtotal and delivery, and promise the rest
   * "at the next step" — so a 7,000 basket said 7,000 and then became 7,500 at
   * checkout. A total that grows after the customer has decided is the kind of
   * surprise that loses the order, and it is the same number either way.
   */
  const storefront = useQuery({
    queryKey: ['storefront'],
    queryFn: () => api.storefront(),
    staleTime: 5 * 60_000,
  });
  const serviceFeeIqd = storefront.data?.service_fee_iqd ?? 0;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  if (!cart || itemCount === 0) {
    return (
      <Screen edges={['top', 'bottom']}>
        <TopBar title="سلة المشتريات" onBack={goBack} />
        <EmptyState
          title="سلتك فارغة"
          body="تصفّح المطاعم وأضف ما يعجبك."
          action={{ label: 'تصفّح المطاعم', onPress: () => router.replace('/(tabs)') }}
        />
      </Screen>
    );
  }

  const belowMinimum = subtotalIqd < cart.minimumOrderIqd;
  const totalIqd = subtotalIqd + cart.deliveryFeeIqd + serviceFeeIqd;

  return (
    <Screen edges={['top']} padded={false}>
      <View style={{ paddingHorizontal: space[4], paddingTop: space[2] }}>
        <TopBar
          title="سلة المشتريات"
          onBack={goBack}
          onClear={() => {
            clear();
            goBack();
          }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space[4], paddingBottom: space[10], gap: space[4] }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Row gap={space[2]}>
          <MaterialCommunityIcons name="store-outline" size={18} color={color.brand} />
          <Text variant="smallBold">{cart.restaurantName}</Text>
        </Row>

        <View style={{ gap: space[3] }}>
          {cart.lines.map((line) => (
            <View
              key={line.key}
              style={[
                {
                  flexDirection: ROW,
                  gap: space[3],
                  padding: space[3],
                  backgroundColor: color.surfaceCard,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: color.borderSubtle,
                },
                shadow.sm,
              ]}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: radius.md,
                  overflow: 'hidden',
                  backgroundColor: color.brandSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {line.imageAssetId ? (
                  <Image
                    source={{ uri: assetUrl(line.imageAssetId) }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={missingImageGlyph()}
                    size={20}
                    color={accent[300]}
                  />
                )}
              </View>

              <View style={{ flex: 1, gap: space[1] }}>
                <Text variant="bodyBold" numberOfLines={1}>
                  {line.nameAr}
                </Text>
                {line.notes ? (
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {line.notes}
                  </Text>
                ) : null}
                <Text variant="smallBold" tone="brand">
                  {formatIqdArabic(iqd(line.unitPriceIqd * line.quantity))}
                </Text>
              </View>

              <View style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Pressable
                  onPress={() => remove(line.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`حذف ${line.nameAr}`}
                  hitSlop={space[2]}
                  style={{ padding: space[1] }}
                >
                  <MaterialCommunityIcons
                    name="trash-can-outline"
                    size={18}
                    color={color.dangerStrong}
                  />
                </Pressable>

                <Stepper
                  value={line.quantity}
                  onChange={(quantity) => setQuantity(line.key, quantity)}
                  min={0}
                />
              </View>
            </View>
          ))}
        </View>

        <View style={{ gap: space[2] }}>
          <Row gap={space[2]}>
            <MaterialCommunityIcons name="note-text-outline" size={18} color={color.textMuted} />
            <Text variant="smallBold">ملاحظات للمطعم</Text>
          </Row>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="بدون بصل، صلصة إضافية…"
            placeholderTextColor={color.textMuted}
            multiline
            maxLength={300}
            style={[
              text.small,
              {
                minHeight: 88,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: color.borderSubtle,
                backgroundColor: color.surfaceCard,
                padding: space[3],
                color: color.textPrimary,
                textAlignVertical: 'top',
              },
            ]}
          />
        </View>

        <View
          style={{
            gap: space[2],
            padding: space[4],
            borderRadius: radius.lg,
            backgroundColor: color.surfaceCard,
            borderWidth: 1,
            borderColor: color.borderSubtle,
          }}
        >
          <SummaryRow label="المجموع الفرعي" value={formatIqdArabic(iqd(subtotalIqd))} />
          <SummaryRow
            label="رسوم التوصيل"
            value={cart.deliveryFeeIqd === 0 ? 'مجاناً' : formatIqdArabic(iqd(cart.deliveryFeeIqd))}
            tone={cart.deliveryFeeIqd === 0 ? 'success' : undefined}
          />
          {serviceFeeIqd > 0 ? (
            <SummaryRow label="رسوم الخدمة" value={formatIqdArabic(iqd(serviceFeeIqd))} />
          ) : null}
          <SummaryRow label="الإجمالي" value={formatIqdArabic(iqd(totalIqd))} emphasis />
          <Text variant="caption" tone="muted">
            يُعاد احتساب الإجمالي عند تأكيد العنوان، وقد يتغيّر بخصم أو عرض.
          </Text>
        </View>

        {belowMinimum ? (
          <View
            style={{
              padding: space[3],
              borderRadius: radius.md,
              backgroundColor: color.warningSoft,
            }}
          >
            <Text variant="caption" tone="secondary">
              الحد الأدنى للطلب من {cart.restaurantName} هو{' '}
              {formatIqdArabic(iqd(cart.minimumOrderIqd))}. أضف{' '}
              {formatIqdArabic(iqd(cart.minimumOrderIqd - subtotalIqd))} لإتمام الطلب.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View
        style={{
          padding: space[4],
          paddingBottom: space[6],
          backgroundColor: color.surfaceCard,
          borderTopWidth: 1,
          borderTopColor: color.borderSubtle,
        }}
      >
        <Button
          label={isGuest ? 'تسجيل الدخول لإتمام الطلب' : 'متابعة إلى العنوان والدفع'}
          block
          /*
           * The minimum blocks checkout, not signing in.
           *
           * For a guest this button goes to the phone screen, and greying that
           * out because the basket is small disables an action for a reason
           * that has nothing to do with it — the label says «تسجيل الدخول» and
           * nothing on screen explains why it cannot be pressed. They can top
           * the order up after signing in; the server enforces the minimum at
           * placement regardless.
           */
          disabled={!isGuest && belowMinimum}
          onPress={() => {
            /*
             * This is the one place the app requires an account, and the reason
             * is in the label: an order needs an address to go to and a number
             * to call. Everything before this point works signed-out.
             */
            if (isGuest) {
              router.push('/(auth)/phone');
              return;
            }
            router.push({ pathname: '/checkout', params: notes ? { notes } : {} });
          }}
        />
      </View>
    </Screen>
  );
}

function TopBar({
  title,
  onBack,
  onClear,
}: {
  title: string;
  onBack: () => void;
  onClear?: () => void;
}) {
  return (
    <Row justify="space-between" style={{ minHeight: TAP_TARGET }}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="رجوع"
        hitSlop={space[2]}
        style={{ width: TAP_TARGET, height: TAP_TARGET, justifyContent: 'center' }}
      >
        <MaterialCommunityIcons name="chevron-right" size={26} color={color.textPrimary} />
      </Pressable>

      <Text variant="h3">{title}</Text>

      {onClear ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="تفريغ السلة"
          hitSlop={space[2]}
          style={{
            width: TAP_TARGET,
            height: TAP_TARGET,
            justifyContent: 'center',
            // The outer edge of the header, which is the left one here.
            alignItems: ALIGN_END,
          }}
        >
          <Text variant="caption" tone="danger">
            تفريغ
          </Text>
        </Pressable>
      ) : (
        <View style={{ width: TAP_TARGET }} />
      )}
    </Row>
  );
}
