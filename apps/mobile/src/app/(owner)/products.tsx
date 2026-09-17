import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError, assetUrl, type OwnerProduct } from '@/lib/api';
import { catalogNoun, useOwner } from '@/lib/owner';
import { accent, color, radius, ROW, shadow, space, TAP_TARGET } from '@/theme';
import {
  Button,
  EmptyState,
  ErrorState,
  RemoteImage,
  Row,
  Screen,
  Skeleton,
  Text,
} from '@/ui';
import { SearchBar } from '@/ui/catalog';
import { missingImageGlyph } from '@/ui/section-glyph';
import { OwnerHeader } from './index';

/**
 * Everything the shop sells, as a shopkeeper needs to see it.
 *
 * Not the customer's storefront. A customer wants to be sold to; an owner wants
 * to find one product among four hundred and change one thing about it. So the
 * row is dense, the price is the loudest thing on it after the name, and the
 * two states that cost money — out of stock, and no photograph — are visible
 * without opening anything.
 *
 * Flat rather than grouped by category. A grocer looking for «شامبو» does not
 * know or care which aisle it was filed under, and search across everything is
 * how they will actually find it; the category filter is there for the other
 * job, which is working through one shelf.
 */
export default function OwnerProductsScreen() {
  const router = useRouter();
  const owner = useOwner();
  const { filter } = useLocalSearchParams<{ filter?: string }>();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [onlyMissingPhoto, setOnlyMissingPhoto] = useState(filter === 'no-photo');

  const shop = owner.shop;
  const noun = catalogNoun(shop);

  const catalog = useQuery({
    queryKey: ['owner-catalog', shop?.id],
    queryFn: () => api.ownerCatalog(shop?.id as string),
    enabled: Boolean(shop?.id),
    staleTime: 60_000,
  });

  const categories = catalog.data?.categories ?? [];

  /** Every product with the name of the category it came from, flattened. */
  const rows = useMemo(() => {
    const term = search.trim();
    return categories
      .flatMap((entry) => entry.items.map((item) => ({ item, categoryId: entry.id })))
      .filter(({ item, categoryId }) => {
        if (category && categoryId !== category) return false;
        if (onlyMissingPhoto && item.image_asset_id) return false;
        if (term && !item.name_ar.includes(term)) return false;
        return true;
      });
  }, [categories, search, category, onlyMissingPhoto]);

  const total = categories.reduce((sum, entry) => sum + entry.items.length, 0);

  if (!shop) {
    return (
      <Screen edges={['top', 'bottom']}>
        <OwnerHeader title={noun} />
        <EmptyState title="لا يوجد متجر مفتوح" body="ارجع واختر متجراً." />
      </Screen>
    );
  }

  return (
    <Screen edges={['top']} padded={false}>
      <View style={{ paddingHorizontal: space[4], paddingTop: space[2], gap: space[3] }}>
        <OwnerHeader title={noun} />

        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder={`ابحث في ${noun}…`}
          accessibilityLabel={`البحث في ${noun}`}
          returnKeyType="search"
        />

        {/* The filters, only once there is enough to filter. Two chips over
            six products is furniture. */}
        {total > 8 ? (
          <Row gap={space[2]} style={{ flexWrap: 'wrap' }}>
            <Chip
              label="الكل"
              active={!category && !onlyMissingPhoto}
              onPress={() => {
                setCategory(null);
                setOnlyMissingPhoto(false);
              }}
            />
            <Chip
              label="بلا صورة"
              active={onlyMissingPhoto}
              onPress={() => {
                setOnlyMissingPhoto((value) => !value);
                setCategory(null);
              }}
            />
            {categories.map((entry) => (
              <Chip
                key={entry.id}
                label={entry.name_ar}
                active={category === entry.id}
                onPress={() => {
                  setCategory((current) => (current === entry.id ? null : entry.id));
                  setOnlyMissingPhoto(false);
                }}
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
          ) : total === 0 ? (
            <EmptyState
              title={`لا توجد ${noun} بعد`}
              body="أضف أول منتج — صورة واسم وسعر، وينتهي الأمر."
              {...(owner.can('menu.write')
                ? { action: { label: 'إضافة منتج', onPress: () => router.push('/(owner)/product/new') } }
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
                  setOnlyMissingPhoto(false);
                },
              }}
            />
          ) : (
            rows.map(({ item }) => (
              <ProductRow
                key={item.id}
                product={item}
                onPress={() => router.push(`/(owner)/product/${item.id}`)}
              />
            ))
          )}
        </View>
      </Screen>

      {/*
        The add button floats, because this screen is a list somebody scrolls
        and the reason they opened it is usually to add the next thing.
      */}
      {owner.can('menu.write') && total > 0 ? (
        <View style={{ padding: space[4], paddingBottom: space[6], backgroundColor: color.surfaceCard }}>
          <Button
            label="إضافة منتج"
            block
            size="lg"
            icon={<MaterialCommunityIcons name="plus" size={20} color="#fff" />}
            onPress={() => router.push('/(owner)/product/new')}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
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

function ProductRow({ product, onPress }: { product: OwnerProduct; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={product.name_ar}
      style={({ pressed }) => [
        {
          flexDirection: ROW,
          alignItems: 'center',
          gap: space[3],
          padding: space[2],
          borderRadius: radius.lg,
          backgroundColor: color.surfaceCard,
          borderWidth: 1,
          borderColor: color.borderSubtle,
          opacity: product.is_available ? 1 : 0.6,
        },
        shadow.sm,
        pressed ? { backgroundColor: color.surfaceSunken } : null,
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
        <Text variant="caption" tone="brand">
          {formatIqdArabic(iqd(product.base_price_iqd))}
        </Text>
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

      <MaterialCommunityIcons name="chevron-left" size={22} color={color.textMuted} />
    </Pressable>
  );
}
