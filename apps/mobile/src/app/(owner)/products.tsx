import { useMemo, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError, assetUrl, type OwnerCatalog, type OwnerProduct } from '@/lib/api';
import { notify } from '@/lib/dialog';
import { catalogNoun, useOwner } from '@/lib/owner';
import { accent, color, radius, ROW, shadow, space, TAP_TARGET } from '@/theme';
import { Button, EmptyState, ErrorState, RemoteImage, Row, Screen, Skeleton, Text } from '@/ui';
import { SearchBar } from '@/ui/catalog';
import { missingImageGlyph } from '@/ui/section-glyph';
import { OwnerHeader } from './index';

/**
 * Everything the shop sells, as a shopkeeper needs to see it.
 *
 * Not the customer's storefront. A customer wants to be sold to; an owner wants
 * to find one product among four hundred and change one thing about it. So the
 * row is dense, the price is the loudest thing on it after the name, and the
 * one change made most often — «نفد» — is a switch on the row itself rather
 * than a screen away.
 *
 * Flat rather than grouped by category. A grocer looking for «شامبو» does not
 * know or care which aisle it was filed under, and search across everything is
 * how they will actually find it; the category chips are there for the other
 * job, which is working through one shelf.
 */
type Filter = 'all' | 'no-photo' | 'unavailable';

export default function OwnerProductsScreen() {
  const router = useRouter();
  const owner = useOwner();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ filter?: string }>();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(
    params.filter === 'no-photo' || params.filter === 'unavailable' ? params.filter : 'all',
  );

  const shop = owner.shop;
  const noun = catalogNoun(shop);
  const canWrite = owner.can('menu.write');

  const catalog = useQuery({
    queryKey: ['owner-catalog', shop?.id],
    queryFn: () => api.ownerCatalog(shop?.id as string),
    enabled: Boolean(shop?.id),
    staleTime: 60_000,
  });

  const categories = catalog.data?.categories ?? [];

  /** Every product with the category it came from, flattened. */
  const rows = useMemo(() => {
    const term = search.trim();
    return categories
      .flatMap((entry) =>
        entry.items.map((item) => ({ item, categoryId: entry.id, categoryName: entry.name_ar })),
      )
      .filter(({ item, categoryId }) => {
        if (category && categoryId !== category) return false;
        if (filter === 'no-photo' && item.image_asset_id) return false;
        if (filter === 'unavailable' && item.is_available) return false;
        if (term && !item.name_ar.includes(term)) return false;
        return true;
      });
  }, [categories, search, category, filter]);

  const total = categories.reduce((sum, entry) => sum + entry.items.length, 0);

  /*
   * «نفد» / «متوفر», flipped in place.
   *
   * Optimistic: the switch moves the moment it is tapped and the list holds
   * that until the server answers. A grocer marking six things out of stock
   * in a row should not watch six spinners.
   */
  const availability = useMutation({
    mutationFn: ({ id, available }: { id: string; available: boolean }) =>
      api.ownerSetAvailability(shop?.id as string, id, available),
    onMutate: async ({ id, available }) => {
      const key = ['owner-catalog', shop?.id];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<OwnerCatalog>(key);
      if (previous) {
        queryClient.setQueryData<OwnerCatalog>(key, {
          ...previous,
          categories: previous.categories.map((entry) => ({
            ...entry,
            items: entry.items.map((item) =>
              item.id === id ? { ...item, is_available: available } : item,
            ),
          })),
        });
      }
      return { previous };
    },
    onError: (caught, _input, context) => {
      if (context?.previous)
        queryClient.setQueryData(['owner-catalog', shop?.id], context.previous);
      notify('تعذّر التغيير', caught instanceof ApiError ? caught.messageAr : 'حاول مرة أخرى.');
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['owner-catalog', shop?.id] }),
  });

  if (!shop) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title={noun} />
        <EmptyState title="لا يوجد متجر مفتوح" body="ارجع واختر متجراً." />
      </Screen>
    );
  }

  const chipsWorthShowing = categories.length > 1 || total > 0;

  return (
    <Screen edges={['top']} padded={false}>
      <View style={{ paddingHorizontal: space[4], paddingTop: space[2], gap: space[3] }}>
        <OwnerHeader title={noun} />

        <Row gap={space[2]}>
          <View style={{ flex: 1 }}>
            <SearchBar
              value={search}
              onChangeText={setSearch}
              placeholder={`ابحث في ${noun}…`}
              accessibilityLabel={`البحث في ${noun}`}
              returnKeyType="search"
            />
          </View>
          <Pressable
            onPress={() => router.push('/(owner)/categories')}
            accessibilityRole="button"
            accessibilityLabel="الأقسام"
            style={({ pressed }) => ({
              minHeight: TAP_TARGET,
              paddingHorizontal: space[3],
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: color.borderSubtle,
              backgroundColor: pressed ? color.surfaceSunken : color.surfaceCard,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: ROW,
              gap: space[1],
            })}
          >
            <MaterialCommunityIcons name="label-outline" size={18} color={color.brand} />
            <Text variant="caption" tone="brand">
              الأقسام
            </Text>
          </Pressable>
        </Row>

        {chipsWorthShowing ? (
          <Row gap={space[2]} style={{ flexWrap: 'wrap' }}>
            <Chip
              label="الكل"
              active={!category && filter === 'all'}
              onPress={() => {
                setCategory(null);
                setFilter('all');
              }}
            />
            <Chip
              label="بلا صورة"
              active={filter === 'no-photo'}
              onPress={() => setFilter((current) => (current === 'no-photo' ? 'all' : 'no-photo'))}
            />
            <Chip
              label="غير متوفر"
              active={filter === 'unavailable'}
              onPress={() =>
                setFilter((current) => (current === 'unavailable' ? 'all' : 'unavailable'))
              }
            />
            {categories.map((entry) => (
              <Chip
                key={entry.id}
                label={entry.is_active ? entry.name_ar : `${entry.name_ar} (مخفي)`}
                active={category === entry.id}
                onPress={() => setCategory((current) => (current === entry.id ? null : entry.id))}
              />
            ))}
          </Row>
        ) : null}
      </View>

      <Screen scroll padded={false} edges={[]}>
        <View style={{ padding: space[4], gap: space[2], paddingBottom: space[10] }}>
          {catalog.isLoading ? (
            <>
              <Skeleton height={84} style={{ borderRadius: radius.lg }} />
              <Skeleton height={84} style={{ borderRadius: radius.lg }} />
              <Skeleton height={84} style={{ borderRadius: radius.lg }} />
            </>
          ) : catalog.isError ? (
            <ErrorState
              message={
                catalog.error instanceof ApiError ? catalog.error.messageAr : `تعذّر تحميل ${noun}`
              }
              onRetry={() => void catalog.refetch()}
            />
          ) : categories.length === 0 ? (
            <EmptyState
              title="ابدأ بالأقسام"
              body="كل منتج يقع تحت قسم. أنشئ أقسام متجرك بضغطة — ثم أضف المنتجات."
              {...(canWrite
                ? {
                    action: {
                      label: 'إنشاء الأقسام',
                      onPress: () => router.push('/(owner)/categories'),
                    },
                  }
                : {})}
            />
          ) : total === 0 ? (
            <EmptyState
              title={`لا توجد ${noun} بعد`}
              body="أضف أول منتج — صورة واسم وسعر، وينتهي الأمر."
              {...(canWrite
                ? {
                    action: {
                      label: 'إضافة منتج',
                      onPress: () => router.push('/(owner)/product/new'),
                    },
                  }
                : {})}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="لا نتائج"
              body="جرّب اسماً آخر أو امسح التصفية."
              action={{
                label: 'مسح التصفية',
                onPress: () => {
                  setSearch('');
                  setCategory(null);
                  setFilter('all');
                },
              }}
            />
          ) : (
            rows.map(({ item, categoryName }) => (
              <ProductRow
                key={item.id}
                product={item}
                categoryName={categoryName}
                canWrite={canWrite}
                onPress={() => router.push(`/(owner)/product/${item.id}`)}
                onToggle={(available) => availability.mutate({ id: item.id, available })}
              />
            ))
          )}
        </View>
      </Screen>

      {/*
        The add button floats, because this screen is a list somebody scrolls
        and the reason they opened it is usually to add the next thing.
      */}
      {canWrite && total > 0 ? (
        <View
          style={{ padding: space[4], paddingBottom: space[6], backgroundColor: color.surfaceCard }}
        >
          <Button
            label="إضافة منتج"
            block
            size="lg"
            icon={<MaterialCommunityIcons name="plus" size={20} color={color.textInverse} />}
            onPress={() => router.push('/(owner)/product/new')}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        minHeight: TAP_TARGET - 10,
        paddingHorizontal: space[3],
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: active ? color.brand : color.surfaceCard,
        borderWidth: 1,
        borderColor: active ? color.brand : color.borderSubtle,
      }}
    >
      <Text variant="caption" tone={active ? 'inverse' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

function ProductRow({
  product,
  categoryName,
  canWrite,
  onPress,
  onToggle,
}: {
  product: OwnerProduct;
  categoryName: string;
  canWrite: boolean;
  onPress: () => void;
  onToggle: (available: boolean) => void;
}) {
  /*
   * The switch sits beside the pressable part, not inside it. Nested, a tap
   * on the switch also opened the product — on the web the click bubbles to
   * the row, and a grocer marking something out of stock does not want the
   * edit form in return.
   */
  return (
    <View
      style={[
        {
          flexDirection: ROW,
          alignItems: 'center',
          gap: space[3],
          padding: space[2],
          borderRadius: radius.lg,
          backgroundColor: color.surfaceCard,
          borderWidth: 1,
          borderColor: color.borderSubtle,
          opacity: product.is_available ? 1 : 0.65,
        },
        shadow.sm,
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${product.name_ar}، ${formatIqdArabic(iqd(product.base_price_iqd))}`}
        style={({ pressed }) => [
          {
            flex: 1,
            flexDirection: ROW,
            alignItems: 'center',
            gap: space[3],
            borderRadius: radius.md,
          },
          pressed ? { opacity: 0.7 } : null,
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
          {product.image_asset_id ? (
            <RemoteImage
              uri={assetUrl(product.image_asset_id)}
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <MaterialCommunityIcons name={missingImageGlyph()} size={22} color={accent[300]} />
          )}
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="smallBold" numberOfLines={1}>
            {product.name_ar}
          </Text>
          <Row gap={space[2]}>
            <Text variant="caption" tone="brand">
              {formatIqdArabic(iqd(product.base_price_iqd))}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {categoryName}
            </Text>
          </Row>
          <Row gap={space[2]}>
            {!product.is_available ? (
              <Text variant="caption" tone="danger">
                غير متوفر
              </Text>
            ) : null}
            {!product.image_asset_id ? (
              <Text variant="caption" tone="muted">
                بلا صورة
              </Text>
            ) : null}
          </Row>
        </View>
      </Pressable>

      {canWrite ? (
        <Switch
          value={product.is_available}
          onValueChange={onToggle}
          trackColor={{ true: color.success, false: color.borderStrong }}
          accessibilityLabel={
            product.is_available ? `${product.name_ar} متوفر` : `${product.name_ar} غير متوفر`
          }
        />
      ) : (
        <MaterialCommunityIcons name="chevron-left" size={22} color={color.textMuted} />
      )}
    </View>
  );
}
