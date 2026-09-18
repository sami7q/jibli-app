import { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { normalizeDigits } from '@jibli/validation';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError, assetUrl, type OwnerCategory } from '@/lib/api';
import { catalogNoun, useOwner } from '@/lib/owner';
import { lastCategory, rememberLastCategory } from '@/lib/owner-store';
import { confirmAsync, notify } from '@/lib/dialog';
import { accent, color, radius, space, TAP_TARGET, TEXT_START, text } from '@/theme';
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
 *   **Three required fields and no more.** A name, a price, a category. A
 *   grocery product has no preparation time and no modifier groups; asking for
 *   them would be the restaurant's form wearing a market's label.
 *
 *   **The category remembers itself.** Somebody stocking a shelf adds eight
 *   things from one aisle in a row, and re-picking «ألبان وأجبان» eight times
 *   is most of the minute.
 *
 *   **Saving a new product returns to a blank form**, not to the list. The next
 *   product is the likeliest next action by a wide margin, and a list you have
 *   to tap «إضافة» from again costs a screen each time.
 *
 * The photograph is phase two: it needs `expo-image-picker`, which is a native
 * module and therefore a new build rather than an over-the-air update. The slot
 * is drawn here and says so, because a product with no picture is the commonest
 * reason a customer scrolls past it and the owner should know that is coming.
 */
export default function OwnerProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const owner = useOwner();
  const queryClient = useQueryClient();

  const shop = owner.shop;
  const isNew = id === 'new';
  const noun = catalogNoun(shop);

  const catalog = useQuery({
    queryKey: ['owner-catalog', shop?.id],
    queryFn: () => api.ownerCatalog(shop?.id as string),
    enabled: Boolean(shop?.id),
    staleTime: 60_000,
  });

  const categories = useMemo<OwnerCategory[]>(
    () => catalog.data?.categories ?? [],
    [catalog.data],
  );

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
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

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
      setCategoryId(existing.category_id);
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
  const canSave = nameValid && priceValid && Boolean(categoryId) && owner.can('menu.write');

  const save = useMutation({
    mutationFn: async () => {
      if (!shop || !categoryId) throw new Error('no shop');
      const body = {
        category_id: categoryId,
        name_ar: nameAr.trim(),
        base_price_iqd: priceIqd,
      };
      if (isNew) return api.ownerCreateProduct(shop.id, body);
      return api.ownerUpdateProduct(shop.id, id, body);
    },
    onSuccess: async () => {
      if (categoryId) await rememberLastCategory(categoryId);
      await queryClient.invalidateQueries({ queryKey: ['owner-catalog', shop?.id] });

      if (isNew) {
        // Straight back to a blank form: the next product is one tap, not four.
        notify('تمت الإضافة', `أُضيف «${nameAr.trim()}» إلى ${noun}.`);
        setNameAr('');
        setPrice('');
        setTouched(false);
        return;
      }
      router.back();
    },
    onError: (error) =>
      notify('تعذّر الحفظ', error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى.'),
  });

  const remove = useMutation({
    mutationFn: () => api.ownerDeleteProduct(shop?.id as string, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['owner-catalog', shop?.id] });
      router.back();
    },
    onError: (error) =>
      notify('تعذّر الحذف', error instanceof ApiError ? error.messageAr : 'حاول مرة أخرى.'),
  });

  if (!shop) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="منتج" />
        <EmptyState title="لا يوجد متجر مفتوح" body="ارجع واختر متجراً." />
      </Screen>
    );
  }

  if (catalog.isLoading) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title={isNew ? 'منتج جديد' : 'تعديل المنتج'} />
        <View style={{ gap: space[3], paddingTop: space[4] }}>
          <Skeleton height={160} style={{ borderRadius: radius.lg }} />
          <Skeleton height={64} style={{ borderRadius: radius.md }} />
          <Skeleton height={64} style={{ borderRadius: radius.md }} />
        </View>
      </Screen>
    );
  }

  if (catalog.isError) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title={isNew ? 'منتج جديد' : 'تعديل المنتج'} />
        <ErrorState message="تعذّر تحميل الأقسام" onRetry={() => void catalog.refetch()} />
      </Screen>
    );
  }

  if (categories.length === 0) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title="منتج جديد" />
        <EmptyState
          title="أضف قسماً أولاً"
          body="كل منتج يقع تحت قسم — «ألبان وأجبان»، «منظفات». أنشئ الأقسام من لوحة التحكم، ثم أضف المنتجات من هنا."
        />
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
        <OwnerHeader title={isNew ? 'منتج جديد' : 'تعديل المنتج'} />
      </View>

      <Screen scroll padded={false} edges={[]}>
        <View style={{ padding: space[4], gap: space[4], paddingBottom: space[10] }}>
          <PhotoSlot assetId={existing?.image_asset_id ?? null} />

          <Field label="اسم المنتج" hint="كما يقرأه الزبون — «حليب طازج ١ لتر»">
            <TextInput
              value={nameAr}
              onChangeText={(value) => {
                setNameAr(value);
                setTouched(true);
              }}
              placeholder="حليب طازج ١ لتر"
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
                  textAlign: TEXT_START,
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

          <View style={{ gap: space[1] }}>
            <Text variant="smallBold" tone="secondary">
              القسم
            </Text>
            <Row gap={space[2]} style={{ flexWrap: 'wrap' }}>
              {categories.map((entry) => {
                const active = categoryId === entry.id;
                return (
                  <Pressable
                    key={entry.id}
                    onPress={() => {
                      setCategoryId(entry.id);
                      setTouched(true);
                    }}
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
            </Row>
          </View>

          <Button
            label={isNew ? 'إضافة المنتج' : 'حفظ التعديل'}
            block
            size="lg"
            disabled={!canSave || save.isPending}
            loading={save.isPending}
            onPress={() => save.mutate()}
          />

          {!owner.can('menu.write') ? (
            <Text variant="caption" tone="muted" align="center">
              حسابك يستطيع العرض فقط.
            </Text>
          ) : null}

          {/*
            A way out, not an invitation — the same shape the order screen gives
            cancellation. A filled red button is how a shelf gets emptied by
            accident.
          */}
          {!isNew && owner.can('menu.write') ? (
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
 * Where the photograph goes.
 *
 * Drawn but not yet wired: capture needs `expo-image-picker`, a native module,
 * which means a new build rather than an over-the-air update. Showing the slot
 * with the reason on it beats hiding it — the owner learns that a picture is
 * expected, and an existing one is visible while editing.
 */
function PhotoSlot({ assetId }: { assetId: string | null }) {
  return (
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
      ) : (
        <>
          <MaterialCommunityIcons name="camera-outline" size={34} color={accent[300]} />
          <Text variant="caption" tone="muted" align="center">
            التصوير من التطبيق قريباً
          </Text>
          <Text variant="caption" tone="muted" align="center">
            حتى ذلك الحين ارفع الصورة من لوحة التحكم
          </Text>
        </>
      )}
    </View>
  );
}
