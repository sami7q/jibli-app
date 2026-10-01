import { useEffect, useMemo, useState } from 'react';
import type { MerchantType } from '@jibli/contracts';
import { ActivityIndicator, Pressable, Switch, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { normalizeDigits } from '@jibli/validation/arabic';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError, assetUrl, type OwnerCategory } from '@/lib/api';
import { countAr } from '@/lib/arabic-count';
import { confirmAsync, notify } from '@/lib/dialog';
import { catalogNoun, useOwner } from '@/lib/owner';
import { PRODUCTS, suggestedCategories } from '@/lib/owner-catalog';
import { lastCategory, rememberLastCategory } from '@/lib/owner-store';
import { describePickOutcome, pickImage, uploadShopImage, type PickSource } from '@/lib/upload';
import { accent, color, INPUT_TEXT_START, radius, ROW, space, TAP_TARGET, text } from '@/theme';
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
import { OwnerHeader } from '../index';

/**
 * Add a product, or change one.
 *
 * The screen a grocer uses two hundred times while every other screen in Owner
 * Mode gets used once, so it is the one that has to be fast. The target is a
 * product added in under a minute, standing in the aisle, one-handed.
 *
 * Which decides the shape:
 *
 *   **A photo, a name, a price, a category — and nothing else required.** A
 *   grocery product has no preparation time and no modifier groups; asking for
 *   them would be the restaurant's form wearing a market's label.
 *
 *   **The photo is the first thing on the screen and one tap from the camera.**
 *   A product without one is the commonest reason a customer scrolls past it,
 *   and the phone is the device that fixes that.
 *
 *   **The category remembers itself, and can be made right here.** Somebody
 *   stocking a shelf adds eight things from one aisle in a row; and a shop with
 *   no aisles yet should not be sent to another screen to make the first one.
 *
 *   **Saving a new product returns to a blank form**, not to the list, with a
 *   running count. The next product is the likeliest next action by a wide
 *   margin.
 */
export default function OwnerProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const owner = useOwner();
  const queryClient = useQueryClient();

  const shop = owner.shop;
  const isNew = id === 'new';
  const noun = catalogNoun(shop);
  const canWrite = owner.can('menu.write');
  const productExample = PRODUCT_EXAMPLE[shop?.merchant_type ?? 'MARKET'];

  const catalog = useQuery({
    queryKey: ['owner-catalog', shop?.id],
    queryFn: () => api.ownerCatalog(shop?.id as string),
    enabled: Boolean(shop?.id),
    staleTime: 60_000,
  });

  const categories = useMemo<OwnerCategory[]>(() => catalog.data?.categories ?? [], [catalog.data]);

  /** The product being edited, found in the tree rather than fetched again. */
  const existing = useMemo(() => {
    if (isNew) return null;
    for (const entry of categories) {
      const found = entry.items.find((item) => item.id === id);
      if (found) return { ...found, category_id: entry.id };
    }
    return null;
  }, [categories, id, isNew]);

  const [nameAr, setNameAr] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [describing, setDescribing] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [imageAssetId, setImageAssetId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [addedThisSession, setAddedThisSession] = useState(0);

  /*
   * Fill the form once the product arrives, and never again.
   *
   * `touched` is what stops a refetch — the catalog is shared with the list
   * screen and revalidates on focus — from overwriting what somebody is in the
   * middle of typing.
   */
  useEffect(() => {
    if (touched) return;
    if (existing) {
      setNameAr(existing.name_ar);
      setPrice(String(existing.base_price_iqd));
      setDescription(existing.description_ar ?? '');
      setDescribing(Boolean(existing.description_ar));
      setCategoryId(existing.category_id);
      setImageAssetId(existing.image_asset_id);
    }
  }, [existing, touched]);

  /** A new product starts in the aisle the last one was filed under. */
  useEffect(() => {
    if (!isNew || categoryId || categories.length === 0) return;
    void (async () => {
      const remembered = await lastCategory();
      const match = categories.find((entry) => entry.id === remembered);
      setCategoryId(match?.id ?? categories[0]?.id ?? null);
    })();
  }, [isNew, categoryId, categories]);

  /*
   * Arabic-Indic digits are what an Arabic keyboard produces, and a price typed
   * as ١٢٥٠ must mean 1250 — the same normalisation the OTP screen applies to a
   * verification code, for the same reason.
   */
  const priceIqd = Number.parseInt(normalizeDigits(price).replace(/\D/g, ''), 10);
  const priceValid = Number.isFinite(priceIqd) && priceIqd > 0;
  const nameValid = nameAr.trim().length >= 2;
  const canSave = nameValid && priceValid && Boolean(categoryId) && canWrite;

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['owner-catalog', shop?.id] });
    // The lobby's activation card counts products.
    await queryClient.invalidateQueries({ queryKey: ['owner-readiness', shop?.id] });
  };
  const explain = (caught: unknown) =>
    caught instanceof ApiError ? caught.messageAr : 'حاول مرة أخرى.';

  const save = useMutation({
    mutationFn: async () => {
      if (!shop || !categoryId) throw new Error('no shop');
      const body = {
        category_id: categoryId,
        name_ar: nameAr.trim(),
        base_price_iqd: priceIqd,
        ...(description.trim()
          ? { description_ar: description.trim() }
          : isNew
            ? {}
            : { description_ar: '' }),
        image_asset_id: imageAssetId,
      };
      if (isNew) return api.ownerCreateProduct(shop.id, body);
      return api.ownerUpdateProduct(shop.id, id, body);
    },
    onSuccess: async () => {
      if (categoryId) await rememberLastCategory(categoryId);
      await invalidate();

      if (isNew) {
        // Straight back to a blank form: the next product is one tap, not four.
        setAddedThisSession((count) => count + 1);
        notify('تمت الإضافة', `أُضيف «${nameAr.trim()}» إلى ${noun}.`);
        setNameAr('');
        setPrice('');
        setDescription('');
        setDescribing(false);
        setImageAssetId(null);
        setTouched(false);
        return;
      }
      router.back();
    },
    onError: (caught) => notify('تعذّر الحفظ', explain(caught)),
  });

  /*
   * The picture goes up the moment it is chosen, not with the save: an upload
   * on a shop's connection takes a few seconds, and doing it while the owner
   * types the name and price hides that time entirely.
   */
  const photo = useMutation({
    mutationFn: async (source: PickSource) => {
      if (!shop) return null;
      const picked = await pickImage(source, 'photo');
      if (picked.status !== 'picked') {
        const message = describePickOutcome(picked);
        if (message) throw new Error(message);
        return null;
      }
      return uploadShopImage(shop.id, picked.dataUrl, 'MENU_ITEM');
    },
    onSuccess: (assetId) => {
      if (!assetId) return;
      setImageAssetId(assetId);
      setTouched(true);
    },
    onError: (caught) =>
      notify(
        'تعذّر رفع الصورة',
        caught instanceof ApiError
          ? caught.messageAr
          : caught instanceof Error
            ? caught.message
            : 'حاول مرة أخرى.',
      ),
  });

  const availability = useMutation({
    mutationFn: (available: boolean) => api.ownerSetAvailability(shop?.id as string, id, available),
    onSuccess: invalidate,
    onError: (caught) => notify('تعذّر التغيير', explain(caught)),
  });

  const createCategory = useMutation({
    mutationFn: (name: string) =>
      api.ownerCreateCategory(shop?.id as string, {
        name_ar: name,
        sort_order: Math.max(0, ...categories.map((entry) => entry.sort_order)) + 1,
      }),
    onSuccess: async (created) => {
      await invalidate();
      setCategoryId(created.id);
      setTouched(true);
    },
    onError: (caught) => notify('تعذّرت إضافة القسم', explain(caught)),
  });

  const remove = useMutation({
    mutationFn: () => api.ownerDeleteProduct(shop?.id as string, id),
    onSuccess: async () => {
      await invalidate();
      router.back();
    },
    onError: (caught) => notify('تعذّر الحذف', explain(caught)),
  });

  if (!shop) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="منتج" />
        <EmptyState title="لا يوجد متجر مفتوح" body="ارجع واختر متجراً." />
      </Screen>
    );
  }

  const title = isNew ? 'منتج جديد' : 'تعديل المنتج';

  if (catalog.isLoading) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title={title} />
        <View style={{ gap: space[3], paddingTop: space[4] }}>
          <Skeleton height={180} style={{ borderRadius: radius.lg }} />
          <Skeleton height={64} style={{ borderRadius: radius.md }} />
          <Skeleton height={64} style={{ borderRadius: radius.md }} />
        </View>
      </Screen>
    );
  }

  if (catalog.isError) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title={title} />
        <ErrorState message="تعذّر تحميل الأقسام" onRetry={() => void catalog.refetch()} />
      </Screen>
    );
  }

  if (!isNew && !existing) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="تعديل المنتج" />
        <EmptyState title="لم نجد هذا المنتج" body="ربما حُذف من جهاز آخر." />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']} padded={false}>
      <View style={{ paddingHorizontal: space[4], paddingTop: space[2] }}>
        <OwnerHeader title={title} />
      </View>

      <Screen scroll padded={false} edges={[]}>
        <View style={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
          {addedThisSession > 0 ? (
            <View
              style={{
                flexDirection: ROW,
                alignItems: 'center',
                gap: space[2],
                padding: space[2],
                borderRadius: radius.md,
                backgroundColor: color.successSoft,
              }}
            >
              <MaterialCommunityIcons name="check-circle" size={18} color={color.successStrong} />
              <Text variant="caption" style={{ color: color.successStrong, flex: 1 }}>
                أضفت {countAr(addedThisSession, PRODUCTS)} في هذه الجلسة. تابع — القسم محفوظ.
              </Text>
            </View>
          ) : null}

          <PhotoSlot
            assetId={imageAssetId}
            busy={photo.isPending}
            canWrite={canWrite}
            onPick={(source) => photo.mutate(source)}
            onClear={() => {
              setImageAssetId(null);
              setTouched(true);
            }}
          />

          <Field label="اسم المنتج" hint={`كما يقرأه الزبون — «${productExample}»`}>
            <TextInput
              value={nameAr}
              editable={canWrite}
              onChangeText={(value) => {
                setNameAr(value);
                setTouched(true);
              }}
              placeholder={productExample}
              placeholderTextColor={color.textMuted}
              accessibilityLabel="اسم المنتج"
              maxLength={100}
              style={[
                text.body,
                {
                  minHeight: TAP_TARGET + 6,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: nameAr && !nameValid ? color.danger : color.borderSubtle,
                  backgroundColor: color.surfaceCard,
                  paddingHorizontal: space[3],
                  color: color.textPrimary,
                  textAlign: INPUT_TEXT_START,
                },
              ]}
            />
          </Field>

          <Field
            label="السعر بالدينار"
            hint={priceValid ? formatIqdArabic(iqd(priceIqd)) : 'رقم صحيح، بلا فواصل'}
            error={price && !priceValid ? 'أدخل سعراً أكبر من صفر' : null}
          >
            <TextInput
              value={price}
              editable={canWrite}
              onChangeText={(value) => {
                setPrice(value);
                setTouched(true);
              }}
              keyboardType="number-pad"
              placeholder="1500"
              placeholderTextColor={color.textMuted}
              accessibilityLabel="السعر بالدينار"
              maxLength={9}
              style={[
                text.h3,
                {
                  minHeight: TAP_TARGET + 10,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: price && !priceValid ? color.danger : color.borderSubtle,
                  backgroundColor: color.surfaceCard,
                  paddingHorizontal: space[3],
                  color: color.textPrimary,
                  // A price is a number and reads left to right in every script.
                  writingDirection: 'ltr',
                  textAlign: 'left',
                },
              ]}
            />
          </Field>

          <CategoryPicker
            kind={shop.merchant_type}
            categories={categories}
            selected={categoryId}
            canWrite={canWrite}
            creating={createCategory.isPending}
            onSelect={(next) => {
              setCategoryId(next);
              setTouched(true);
            }}
            onCreate={(name) => createCategory.mutate(name)}
          />

          {/* A line under the name, for the product that needs one. Folded away
              because most do not, and an empty field is a question. */}
          {describing ? (
            <Field label="وصف قصير" hint="الوزن، العدد، أو ما يميّزه. اختياري.">
              <TextInput
                value={description}
                editable={canWrite}
                onChangeText={(value) => {
                  setDescription(value);
                  setTouched(true);
                }}
                placeholder={
                  shop.merchant_type === 'COSMETICS'
                    ? 'مثال: ٣٠ مل، مناسب للبشرة الجافة'
                    : 'مثال: عبوة ٢ كغم'
                }
                placeholderTextColor={color.textMuted}
                maxLength={300}
                multiline
                accessibilityLabel="وصف المنتج"
                style={[
                  text.body,
                  {
                    minHeight: TAP_TARGET * 1.4,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: color.borderSubtle,
                    backgroundColor: color.surfaceCard,
                    paddingHorizontal: space[3],
                    paddingVertical: space[2],
                    color: color.textPrimary,
                    textAlign: INPUT_TEXT_START,
                    textAlignVertical: 'top',
                  },
                ]}
              />
            </Field>
          ) : canWrite ? (
            <Pressable
              onPress={() => setDescribing(true)}
              accessibilityRole="button"
              style={{
                alignSelf: 'flex-start',
                minHeight: TAP_TARGET - 8,
                justifyContent: 'center',
              }}
            >
              <Row gap={space[1]}>
                <MaterialCommunityIcons name="plus" size={16} color={color.brand} />
                <Text variant="small" tone="brand">
                  إضافة وصف قصير
                </Text>
              </Row>
            </Pressable>
          ) : null}

          {!isNew && existing && canWrite ? (
            <View
              style={{
                flexDirection: ROW,
                alignItems: 'center',
                gap: space[3],
                padding: space[3],
                borderRadius: radius.lg,
                backgroundColor: existing.is_available ? color.successSoft : color.dangerSoft,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="smallBold">
                  {existing.is_available ? 'متوفر للزبائن' : 'غير متوفر — نفد'}
                </Text>
                <Text variant="caption" tone="secondary">
                  يُحفظ فوراً، بلا حاجة لزر الحفظ.
                </Text>
              </View>
              <Switch
                value={existing.is_available}
                disabled={availability.isPending}
                onValueChange={(value) => availability.mutate(value)}
                trackColor={{ true: color.success, false: color.borderStrong }}
                accessibilityLabel="متوفر"
              />
            </View>
          ) : null}

          <Button
            label={isNew ? 'إضافة المنتج' : 'حفظ التعديل'}
            block
            size="lg"
            disabled={!canSave || save.isPending || photo.isPending}
            loading={save.isPending}
            onPress={() => save.mutate()}
          />
          {photo.isPending ? (
            <Text variant="caption" tone="muted" align="center">
              بانتظار رفع الصورة…
            </Text>
          ) : null}

          {!canWrite ? (
            <Text variant="caption" tone="muted" align="center">
              حسابك يستطيع العرض فقط.
            </Text>
          ) : null}

          {/*
            A way out, not an invitation — the same shape the order screen gives
            cancellation. A filled red button is how a shelf gets emptied by
            accident.
          */}
          {!isNew && canWrite ? (
            <Pressable
              onPress={() =>
                void confirmAsync({
                  title: 'حذف المنتج',
                  message: `سيختفي «${existing?.name_ar ?? ''}» من المتجر. الطلبات السابقة لا تتأثر.`,
                  confirmLabel: 'حذف',
                  destructive: true,
                }).then((yes) => {
                  if (yes) remove.mutate();
                })
              }
              disabled={remove.isPending}
              accessibilityRole="button"
              accessibilityLabel="حذف المنتج"
              style={{ minHeight: TAP_TARGET, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text variant="small" tone="danger">
                {remove.isPending ? 'جارٍ الحذف…' : 'حذف المنتج'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Screen>
    </Screen>
  );
}

/**
 * The photograph: the picture, or the two ways to get one.
 *
 * Camera first — the product is on the shelf in front of the owner — and the
 * library second for the one photographed earlier. While the upload runs the
 * slot says so, and the form stays usable underneath.
 */
function PhotoSlot({
  assetId,
  busy,
  canWrite,
  onPick,
  onClear,
}: {
  assetId: string | null;
  busy: boolean;
  canWrite: boolean;
  onPick: (source: PickSource) => void;
  onClear: () => void;
}) {
  return (
    <View style={{ gap: space[2] }}>
      <View
        style={{
          aspectRatio: 16 / 9,
          borderRadius: radius.lg,
          overflow: 'hidden',
          backgroundColor: color.brandSoft,
          borderWidth: 1,
          borderColor: color.borderSubtle,
          alignItems: 'center',
          justifyContent: 'center',
          gap: space[2],
        }}
      >
        {assetId ? (
          <RemoteImage
            uri={assetUrl(assetId)}
            style={{ width: '100%', height: '100%' }}
            priority="high"
          />
        ) : busy ? (
          <>
            <ActivityIndicator color={color.brand} />
            <Text variant="caption" tone="muted">
              جارٍ رفع الصورة…
            </Text>
          </>
        ) : (
          <>
            <MaterialCommunityIcons name="camera-outline" size={34} color={accent[300]} />
            <Text variant="caption" tone="muted" align="center">
              {canWrite ? 'صوّر المنتج أو اختر صورة — المنتجات بصور تُباع أكثر' : 'بلا صورة'}
            </Text>
          </>
        )}
      </View>

      {canWrite ? (
        <Row gap={space[2]}>
          <View style={{ flex: 1 }}>
            <Button
              label={assetId ? 'صورة أخرى' : 'التقاط صورة'}
              block
              icon={
                <MaterialCommunityIcons name="camera-outline" size={18} color={color.textInverse} />
              }
              disabled={busy}
              onPress={() => onPick('camera')}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="من الصور"
              variant="secondary"
              block
              icon={
                <MaterialCommunityIcons name="image-outline" size={18} color={color.textPrimary} />
              }
              disabled={busy}
              onPress={() => onPick('library')}
            />
          </View>
          {assetId ? (
            <Pressable
              onPress={onClear}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="إزالة الصورة"
              style={{
                width: TAP_TARGET,
                height: TAP_TARGET,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: color.borderSubtle,
                backgroundColor: color.surfaceCard,
              }}
            >
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={20}
                color={color.dangerStrong}
              />
            </Pressable>
          ) : null}
        </Row>
      ) : null}
    </View>
  );
}

/**
 * Which aisle — and, when the right one does not exist yet, making it here.
 *
 * The suggestions are the usual aisles for this kind of shop, offered right in
 * the picker; a name typed in the field becomes a category on the spot. Either
 * way the new aisle is selected, so the product being added lands in it.
 */
function CategoryPicker({
  kind,
  categories,
  selected,
  canWrite,
  creating,
  onSelect,
  onCreate,
}: {
  kind: MerchantType;
  categories: OwnerCategory[];
  selected: string | null;
  canWrite: boolean;
  creating: boolean;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const [adding, setAdding] = useState(categories.length === 0);
  const [draft, setDraft] = useState('');
  const suggestions = useMemo(
    () =>
      suggestedCategories(
        kind,
        categories.map((entry) => entry.name_ar),
      ),
    [kind, categories],
  );
  const draftName = draft.trim();
  const draftTaken = categories.some((entry) => entry.name_ar.trim() === draftName);
  const canAdd = draftName.length >= 2 && !draftTaken && !creating;

  const submit = () => {
    if (!canAdd) return;
    onCreate(draftName);
    setDraft('');
    setAdding(false);
  };

  return (
    <View style={{ gap: space[2] }}>
      <Row justify="space-between">
        <Text variant="smallBold" tone="secondary">
          القسم
        </Text>
        {categories.length === 0 ? (
          <Text variant="caption" tone="danger">
            مطلوب — أنشئ الأول
          </Text>
        ) : null}
      </Row>

      <Row gap={space[2]} style={{ flexWrap: 'wrap' }}>
        {categories.map((entry) => {
          const active = selected === entry.id;
          return (
            <Pressable
              key={entry.id}
              disabled={!canWrite}
              onPress={() => onSelect(entry.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={entry.name_ar}
              style={{
                minHeight: TAP_TARGET - 6,
                paddingHorizontal: space[3],
                justifyContent: 'center',
                borderRadius: radius.full,
                backgroundColor: active ? color.brand : color.surfaceCard,
                borderWidth: 1,
                borderColor: active ? color.brand : color.borderSubtle,
              }}
            >
              <Text variant="caption" tone={active ? 'inverse' : 'secondary'}>
                {entry.name_ar}
              </Text>
            </Pressable>
          );
        })}
        {canWrite && !adding ? (
          <Pressable
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="قسم جديد"
            style={{
              flexDirection: ROW,
              alignItems: 'center',
              gap: 4,
              minHeight: TAP_TARGET - 6,
              paddingHorizontal: space[3],
              borderRadius: radius.full,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: color.brand,
              backgroundColor: color.brandSoft,
            }}
          >
            <MaterialCommunityIcons name="plus" size={16} color={color.brand} />
            <Text variant="caption" tone="brand">
              قسم جديد
            </Text>
          </Pressable>
        ) : null}
      </Row>

      {canWrite && adding ? (
        <View
          style={{
            padding: space[3],
            gap: space[2],
            borderRadius: radius.lg,
            backgroundColor: color.brandSoft,
            borderWidth: 1,
            borderColor: color.borderSubtle,
          }}
        >
          {suggestions.length > 0 ? (
            <>
              <Text variant="caption" tone="secondary">
                اضغط قسماً لإنشائه واختياره:
              </Text>
              <View style={{ flexDirection: ROW, flexWrap: 'wrap', gap: space[2] }}>
                {suggestions.map((aisle) => (
                  <Pressable
                    key={aisle.key}
                    disabled={creating}
                    onPress={() => {
                      onCreate(aisle.labelAr);
                      setAdding(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`إنشاء قسم ${aisle.labelAr}`}
                    style={({ pressed }) => ({
                      minHeight: TAP_TARGET - 8,
                      paddingHorizontal: space[3],
                      justifyContent: 'center',
                      borderRadius: radius.full,
                      borderWidth: 1,
                      borderColor: color.brand,
                      backgroundColor: pressed ? color.brand : color.surfaceCard,
                    })}
                  >
                    {({ pressed }) => (
                      <Text variant="caption" tone={pressed ? 'inverse' : 'primary'}>
                        {`${aisle.emoji} ${aisle.labelAr}`}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          <Row gap={space[2]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="أو اكتب اسم قسم"
              placeholderTextColor={color.textMuted}
              accessibilityLabel="اسم القسم الجديد"
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={submit}
              style={[
                text.body,
                {
                  flex: 1,
                  minHeight: TAP_TARGET,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: draftTaken ? color.danger : color.borderSubtle,
                  backgroundColor: color.surfaceCard,
                  paddingHorizontal: space[3],
                  color: color.textPrimary,
                  textAlign: INPUT_TEXT_START,
                },
              ]}
            />
            <Button label="إنشاء" disabled={!canAdd} loading={creating} onPress={submit} />
          </Row>
          {categories.length > 0 ? (
            <Pressable
              onPress={() => setAdding(false)}
              accessibilityRole="button"
              style={{ alignSelf: 'center', minHeight: TAP_TARGET - 12, justifyContent: 'center' }}
            >
              <Text variant="caption" tone="muted">
                إغلاق
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** A product name the way this kind of shop would write one. */
const PRODUCT_EXAMPLE: Record<MerchantType, string> = {
  RESTAURANT: 'شاورما دجاج عربي',
  MARKET: 'حليب طازج ١ لتر',
  COSMETICS: 'أحمر شفاه مات',
};
