import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { normalizeDigits } from '@jibli/validation';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError, assetUrl, type OwnerSettingsInput } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { useOwner } from '@/lib/owner';
import { sectionOf } from '@/lib/sections';
import { describePickOutcome, pickImage, uploadShopImage, type PickSource } from '@/lib/upload';
import { useVertical } from '@/lib/vertical';
import { color, INPUT_TEXT_START, radius, ROW, space, TAP_TARGET, text } from '@/theme';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  RemoteImage,
  Row,
  Screen,
  Skeleton,
  Text,
} from '@/ui';
import { OwnerHeader } from './index';

/**
 * The shop's own page, as its owner edits it.
 *
 * The things a customer sees before a single product: the picture, the name,
 * a line about the shop, whether it is taking orders right now. They used to
 * live only on the web portal, and the picture could not be changed from the
 * phone at all — the one device that has a camera pointed at the shop.
 *
 * Working hours, the location and the commission stay on the portal. This is
 * the page an owner opens on the first day and then when something changes,
 * which is not the same page as the one a manager tunes a schedule on.
 */
export default function OwnerSettingsScreen() {
  const router = useRouter();
  const owner = useOwner();
  const shop = owner.shop;
  const queryClient = useQueryClient();
  const { choose } = useVertical();
  const canWrite = owner.can('settings.write');

  const settings = useQuery({
    queryKey: ['owner-settings', shop?.id],
    queryFn: () => api.ownerSettings(shop?.id as string),
    enabled: Boolean(shop?.id),
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [minimumOrder, setMinimumOrder] = useState('');
  const [acceptsOrders, setAcceptsOrders] = useState(true);
  const [touched, setTouched] = useState(false);

  // Fill once the shop arrives, and never over what somebody is typing.
  useEffect(() => {
    const data = settings.data;
    if (!data || touched) return;
    setName(data.restaurant.display_name);
    setDescription(data.restaurant.description_ar ?? '');
    setPhone(data.branch.phone ?? '');
    setDeliveryFee(String(data.branch.delivery_fee_iqd));
    setMinimumOrder(String(data.restaurant.minimum_order_iqd));
    setAcceptsOrders(data.branch.accepts_orders);
  }, [settings.data, touched]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['owner-settings', shop?.id] });
    // The name and the picture also live on the lobby's shop card.
    await queryClient.invalidateQueries({ queryKey: ['owner-shops'] });
  };
  const explain = (caught: unknown) =>
    caught instanceof ApiError ? caught.messageAr : 'حاول مرة أخرى.';

  const number = (value: string) => Number.parseInt(normalizeDigits(value).replace(/\D/g, ''), 10);
  const feeIqd = number(deliveryFee);
  const minimumIqd = number(minimumOrder);
  const nameValid = name.trim().length >= 2;
  const feeValid = Number.isFinite(feeIqd) && feeIqd >= 0;
  const minimumValid = Number.isFinite(minimumIqd) && minimumIqd >= 0;

  /** Only what changed, so an untouched field never overwrites the portal's. */
  const changes = (): OwnerSettingsInput => {
    const data = settings.data;
    if (!data) return {};
    const body: Record<string, unknown> = {};
    if (name.trim() !== data.restaurant.display_name) body.display_name = name.trim();
    if (description.trim() !== (data.restaurant.description_ar ?? '')) {
      body.description_ar = description.trim();
    }
    if (phone.trim() !== (data.branch.phone ?? '')) body.phone = phone.trim();
    if (feeValid && feeIqd !== data.branch.delivery_fee_iqd) body.delivery_fee_iqd = feeIqd;
    if (minimumValid && minimumIqd !== data.restaurant.minimum_order_iqd) {
      body.minimum_order_iqd = minimumIqd;
    }
    if (acceptsOrders !== data.branch.accepts_orders) body.accepts_orders = acceptsOrders;
    return body as OwnerSettingsInput;
  };
  const pending = changes();
  const dirty = Object.keys(pending).length > 0;

  const save = useMutation({
    mutationFn: () => api.ownerUpdateSettings(shop?.id as string, pending),
    onSuccess: async () => {
      setTouched(false);
      await refresh();
      notify('تم الحفظ', 'يرى الزبائن التغيير الآن.');
    },
    onError: (caught) => notify('تعذّر الحفظ', explain(caught)),
  });

  const logo = useMutation({
    mutationFn: async (source: PickSource) => {
      if (!shop) return false;
      const picked = await pickImage(source, 'icon');
      if (picked.status !== 'picked') {
        const message = describePickOutcome(picked);
        if (message) throw new Error(message);
        return false;
      }
      const assetId = await uploadShopImage(shop.id, picked.dataUrl, 'RESTAURANT_LOGO');
      await api.ownerUpdateSettings(shop.id, { logo_asset_id: assetId });
      return true;
    },
    onSuccess: async (changed) => {
      if (changed) await refresh();
    },
    onError: (caught) =>
      notify(
        'تعذّر تغيير الصورة',
        caught instanceof ApiError
          ? caught.messageAr
          : String(caught instanceof Error ? caught.message : caught),
      ),
  });

  const clearLogo = useMutation({
    mutationFn: () => api.ownerUpdateSettings(shop?.id as string, { logo_asset_id: null }),
    onSuccess: refresh,
    onError: (caught) => notify('تعذّر إزالة الصورة', explain(caught)),
  });

  if (!shop) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="إعدادات المتجر" />
        <EmptyState title="لا يوجد متجر مفتوح" body="ارجع واختر متجراً." />
      </Screen>
    );
  }

  const section = sectionOf(shop.merchant_type);
  const data = settings.data;
  const logoAssetId = data?.restaurant.logo_asset_id ?? null;
  const live = shop.operational_status === 'ACTIVE';

  const viewAsCustomer = () => {
    // The customer's shop page draws in the shop's section; the Gate needs it chosen.
    choose(shop.merchant_type);
    router.push({ pathname: '/restaurant/[id]', params: { id: shop.id } });
  };

  const field = (invalid = false) => [
    text.body,
    {
      minHeight: TAP_TARGET + 4,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: invalid ? color.danger : color.borderSubtle,
      backgroundColor: color.surfaceCard,
      paddingHorizontal: space[3],
      color: color.textPrimary,
      textAlign: INPUT_TEXT_START,
    },
  ];

  return (
    <Screen scroll edges={['top', 'bottom']} padded={false}>
      <View style={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
        <OwnerHeader title="إعدادات المتجر" />

        {settings.isLoading ? (
          <View style={{ gap: space[3] }}>
            <Skeleton height={140} style={{ borderRadius: radius.xl }} />
            <Skeleton height={64} style={{ borderRadius: radius.md }} />
            <Skeleton height={64} style={{ borderRadius: radius.md }} />
          </View>
        ) : settings.isError ? (
          <ErrorState
            message="تعذّر تحميل إعدادات المتجر"
            onRetry={() => void settings.refetch()}
          />
        ) : data ? (
          <>
            {/* ── The picture ─────────────────────────────────────────── */}
            <View
              style={{
                padding: space[4],
                gap: space[3],
                borderRadius: radius.xl,
                backgroundColor: color.surfaceCard,
                borderWidth: 1,
                borderColor: color.borderSubtle,
                alignItems: 'center',
              }}
            >
              <View
                style={{
                  width: 104,
                  height: 104,
                  borderRadius: 52,
                  overflow: 'hidden',
                  backgroundColor: section.ramp[50],
                  borderWidth: 3,
                  borderColor: section.ramp[500],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {logoAssetId ? (
                  <RemoteImage
                    uri={assetUrl(logoAssetId)}
                    style={{ width: '100%', height: '100%' }}
                    priority="high"
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={section.shopIcon}
                    size={44}
                    color={section.ramp[500]}
                  />
                )}
              </View>
              <Text variant="caption" tone="muted" align="center">
                {logoAssetId
                  ? 'صورة متجرك كما تظهر للزبائن'
                  : 'لا صورة بعد — المتاجر ذات الصورة تُفتح أكثر'}
              </Text>
              {canWrite ? (
                <Row gap={space[2]}>
                  <Button
                    label="التقاط صورة"
                    size="md"
                    icon={
                      <MaterialCommunityIcons
                        name="camera-outline"
                        size={18}
                        color={color.textInverse}
                      />
                    }
                    loading={logo.isPending && logo.variables === 'camera'}
                    disabled={logo.isPending || clearLogo.isPending}
                    onPress={() => logo.mutate('camera')}
                  />
                  <Button
                    label="من الصور"
                    variant="secondary"
                    icon={
                      <MaterialCommunityIcons
                        name="image-outline"
                        size={18}
                        color={color.textPrimary}
                      />
                    }
                    loading={logo.isPending && logo.variables === 'library'}
                    disabled={logo.isPending || clearLogo.isPending}
                    onPress={() => logo.mutate('library')}
                  />
                </Row>
              ) : null}
              {canWrite && logoAssetId ? (
                <Pressable
                  onPress={() => clearLogo.mutate()}
                  disabled={clearLogo.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="إزالة الصورة"
                  style={{ minHeight: TAP_TARGET - 8, justifyContent: 'center' }}
                >
                  <Text variant="caption" tone="danger">
                    {clearLogo.isPending ? 'جارٍ الإزالة…' : 'إزالة الصورة'}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {/* ── Taking orders, or not ───────────────────────────────── */}
            <View
              style={{
                flexDirection: ROW,
                alignItems: 'center',
                gap: space[3],
                padding: space[3],
                borderRadius: radius.lg,
                backgroundColor: acceptsOrders ? color.successSoft : color.warningSoft,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="smallBold">
                  {acceptsOrders ? 'يستقبل الطلبات' : 'متوقف عن استقبال الطلبات'}
                </Text>
                <Text variant="caption" tone="secondary">
                  {!live
                    ? 'يظهر متجرك للزبائن بعد أن يفعّله فريق جيبلي.'
                    : acceptsOrders
                      ? data.is_open
                        ? 'مفتوح الآن حسب ساعات العمل.'
                        : 'مغلق الآن حسب ساعات العمل، ويفتح تلقائياً في موعده.'
                      : 'أوقفه مؤقتاً حين تكون مشغولاً؛ يختفي زر الطلب عند الزبائن.'}
                </Text>
              </View>
              <Switch
                value={acceptsOrders}
                disabled={!canWrite}
                onValueChange={(value) => {
                  setAcceptsOrders(value);
                  setTouched(true);
                }}
                trackColor={{ true: color.success, false: color.borderStrong }}
                accessibilityLabel="استقبال الطلبات"
              />
            </View>

            {/* ── Words ───────────────────────────────────────────────── */}
            <Field label="اسم المتجر" hint="كما يظهر في التطبيق وعلى فاتورة الزبون.">
              <TextInput
                value={name}
                editable={canWrite}
                onChangeText={(value) => {
                  setName(value);
                  setTouched(true);
                }}
                maxLength={120}
                accessibilityLabel="اسم المتجر"
                style={field(Boolean(name) && !nameValid)}
              />
            </Field>

            <Field label="نبذة عن المتجر" hint="سطر أو سطران يقرأهما الزبون تحت الاسم. اختياري.">
              <TextInput
                value={description}
                editable={canWrite}
                onChangeText={(value) => {
                  setDescription(value);
                  setTouched(true);
                }}
                maxLength={300}
                multiline
                accessibilityLabel="نبذة عن المتجر"
                style={[
                  field(),
                  {
                    minHeight: TAP_TARGET * 1.6,
                    paddingVertical: space[2],
                    textAlignVertical: 'top',
                  },
                ]}
              />
            </Field>

            <Field label="هاتف المتجر" hint="يتصل به المندوب وفريق جيبلي.">
              <TextInput
                value={phone}
                editable={canWrite}
                onChangeText={(value) => {
                  setPhone(normalizeDigits(value));
                  setTouched(true);
                }}
                keyboardType="phone-pad"
                maxLength={20}
                accessibilityLabel="هاتف المتجر"
                style={[field(), { writingDirection: 'ltr', textAlign: 'left' }]}
              />
            </Field>

            <Row gap={space[3]} align="flex-start">
              <View style={{ flex: 1 }}>
                <Field
                  label="رسوم التوصيل"
                  hint={feeValid ? formatIqdArabic(iqd(feeIqd)) : 'بالدينار'}
                  error={deliveryFee && !feeValid ? 'رقم صحيح' : null}
                >
                  <TextInput
                    value={deliveryFee}
                    editable={canWrite}
                    onChangeText={(value) => {
                      setDeliveryFee(value);
                      setTouched(true);
                    }}
                    keyboardType="number-pad"
                    maxLength={7}
                    accessibilityLabel="رسوم التوصيل"
                    style={[
                      field(Boolean(deliveryFee) && !feeValid),
                      { writingDirection: 'ltr', textAlign: 'left' },
                    ]}
                  />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="الحد الأدنى للطلب"
                  hint={
                    minimumValid
                      ? minimumIqd === 0
                        ? 'بلا حد'
                        : formatIqdArabic(iqd(minimumIqd))
                      : 'بالدينار'
                  }
                  error={minimumOrder && !minimumValid ? 'رقم صحيح' : null}
                >
                  <TextInput
                    value={minimumOrder}
                    editable={canWrite}
                    onChangeText={(value) => {
                      setMinimumOrder(value);
                      setTouched(true);
                    }}
                    keyboardType="number-pad"
                    maxLength={7}
                    accessibilityLabel="الحد الأدنى للطلب"
                    style={[
                      field(Boolean(minimumOrder) && !minimumValid),
                      { writingDirection: 'ltr', textAlign: 'left' },
                    ]}
                  />
                </Field>
              </View>
            </Row>

            {canWrite ? (
              <Button
                label={save.isPending ? 'جارٍ الحفظ…' : dirty ? 'حفظ التغييرات' : 'لا تغييرات'}
                block
                size="lg"
                disabled={!dirty || !nameValid || !feeValid || !minimumValid || save.isPending}
                loading={save.isPending}
                onPress={() => save.mutate()}
              />
            ) : (
              <Text variant="caption" tone="muted" align="center">
                حسابك يستطيع العرض فقط. التعديل يحتاج صلاحية من صاحب المتجر.
              </Text>
            )}

            {/* ── Where the shop is, read-only ───────────────────────── */}
            <View
              style={{
                padding: space[3],
                gap: space[1],
                borderRadius: radius.lg,
                backgroundColor: color.surfaceSunken,
              }}
            >
              <Row gap={space[2]}>
                <MaterialCommunityIcons
                  name="map-marker-outline"
                  size={18}
                  color={color.textSecondary}
                />
                <Text variant="smallBold">
                  {[data.branch.city_name_ar, data.branch.governorate_name_ar]
                    .filter((part, index, all) => part && all.indexOf(part) === index)
                    .join(' · ')}
                </Text>
              </Row>
              <Text variant="caption" tone="secondary">
                {data.branch.address_text}
              </Text>
              <Text variant="caption" tone="muted">
                تغيير الموقع وساعات العمل من لوحة التحكم على المتصفّح.
              </Text>
            </View>

            {/* ── As the customer sees it ────────────────────────────── */}
            <Button
              label="عرض المتجر كما يراه الزبون"
              variant="secondary"
              block
              icon={
                <MaterialCommunityIcons name="eye-outline" size={18} color={color.textPrimary} />
              }
              disabled={!live}
              onPress={viewAsCustomer}
            />
            {!live ? (
              <Text variant="caption" tone="muted" align="center">
                صفحة المتجر تظهر للزبائن بعد التفعيل من فريق جيبلي.
              </Text>
            ) : null}

            {logo.isPending ? <ActivityIndicator color={color.brand} /> : null}
          </>
        ) : null}
      </View>
    </Screen>
  );
}
