import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { cuisineLabelAr } from '@jibli/contracts';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError, assetUrl, type RestaurantCard as RestaurantSummary } from '@/lib/api';
import { useArea } from '@/lib/area';
import { useIsGuest, useMe } from '@/lib/session';
import { color, palette, radius, space, TAP_TARGET } from '@/theme';
import { EmptyState, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';
import { IconTile, PromoBanner, RestaurantCard, SearchBar } from '@/ui/catalog';
import { AreaPicker } from '@/ui/area-picker';

/**
 * Home (`main.html`).
 *
 * Everything on this screen is arranged from the Admin portal — the banners,
 * their order, how long each holds the screen, the categories and their order.
 * Nothing here is a constant in the app, which is the whole point: a Ramadan
 * banner or a promoted category should not need a release, and a release takes
 * a week to reach every phone through two review queues.
 *
 * It runs for a guest too. Discovery is public on the server already, so the
 * only thing a guest was missing was a city to browse — hence the area picker
 * in the header, which is the comp's location row doing real work.
 */
export default function HomeScreen() {
  const me = useMe();
  const isGuest = useIsGuest();
  const router = useRouter();
  const { area, isResolving } = useArea();

  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pickingArea, setPickingArea] = useState(false);

  const storefront = useQuery({
    queryKey: ['storefront'],
    queryFn: () => api.storefront(),
    // Merchandising changes on the hour, not the minute.
    staleTime: 5 * 60_000,
  });

  const restaurants = useQuery({
    queryKey: ['restaurants', area?.cityId],
    queryFn: () => api.restaurants(area?.cityId as string),
    enabled: Boolean(area?.cityId),
  });

  /*
   * Filtering runs here rather than as a request per keystroke.
   *
   * A city's restaurant list is tens of rows, not thousands, and it is already
   * in memory — so the search feels instant and costs nothing. The server's
   * `q` parameter stays for the day a city is large enough to need it.
   */
  const shown = useMemo(() => {
    const term = search.trim();
    return (restaurants.data ?? []).filter((restaurant) => {
      if (category && !restaurant.cuisine_tags.includes(category)) return false;
      if (!term) return true;
      return (
        restaurant.display_name.includes(term) ||
        restaurant.cuisine_tags.some((tag) => tag.includes(term))
      );
    });
  }, [restaurants.data, category, search]);

  const categories = storefront.data?.categories ?? [];

  return (
    <Screen scroll edges={['top']} padded={false}>
      <Header
        areaLabel={area?.cityNameAr ?? null}
        isResolving={isResolving}
        onPressArea={() => setPickingArea(true)}
        greeting={me?.full_name ?? null}
        isGuest={isGuest}
        onPressSignIn={() => router.push('/(auth)/phone')}
      />

      <View style={{ paddingHorizontal: space[4], paddingTop: space[3], gap: space[5] }}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="ابحث عن مطعم أو صنف…"
          returnKeyType="search"
          accessibilityLabel="البحث عن مطعم"
        />

        {storefront.isLoading ? (
          <Skeleton height={164} style={{ borderRadius: radius['2xl'] }} />
        ) : (
          <BannerCarousel
            banners={storefront.data?.banners ?? []}
            seconds={storefront.data?.banner_rotation_seconds ?? 5}
            onOpenCategory={setCategory}
          />
        )}
      </View>

      {storefront.isLoading ? (
        <View style={{ padding: space[4] }}>
          <Skeleton height={92} />
        </View>
      ) : (
        <CategoryStrip categories={categories} selected={category} onSelect={setCategory} />
      )}

      <View style={{ paddingHorizontal: space[4], paddingTop: space[5] }}>
        <Row justify="space-between" align="flex-start">
          <View style={{ flex: 1 }}>
            <Text variant="h3">
              {category
                ? (categories.find((entry) => entry.key === category)?.name_ar ?? 'مطاعم التصنيف')
                : 'المطاعم القريبة منك'}
            </Text>
            <Text variant="caption" tone="muted">
              {area ? `أفضل المطاعم في ${area.cityNameAr}` : 'اختر منطقتك لعرض المطاعم'}
            </Text>
          </View>

          {category ? (
            <Pressable
              onPress={() => setCategory(null)}
              accessibilityRole="button"
              accessibilityLabel="عرض كل المطاعم"
              hitSlop={space[2]}
              style={{ minHeight: TAP_TARGET, justifyContent: 'center' }}
            >
              <Text variant="smallBold" tone="brand">
                عرض الكل
              </Text>
            </Pressable>
          ) : null}
        </Row>
      </View>

      <View style={{ padding: space[4], gap: space[4] }}>
        {isResolving ? (
          <Skeleton height={248} style={{ borderRadius: radius.xl }} />
        ) : !area ? (
          <EmptyState
            title="اختر منطقتك"
            body="نعرض لك المطاعم التي توصّل إلى منطقتك فقط."
            action={{ label: 'اختيار المنطقة', onPress: () => setPickingArea(true) }}
          />
        ) : restaurants.isError ? (
          <ErrorState
            message={
              restaurants.error instanceof ApiError
                ? restaurants.error.messageAr
                : 'تعذّر تحميل المطاعم'
            }
            onRetry={() => void restaurants.refetch()}
          />
        ) : restaurants.isLoading ? (
          <>
            <Skeleton height={248} style={{ borderRadius: radius.xl }} />
            <Skeleton height={248} style={{ borderRadius: radius.xl }} />
          </>
        ) : shown.length === 0 ? (
          <EmptyState
            title={
              search.trim()
                ? 'لا نتائج للبحث'
                : category
                  ? 'لا مطاعم في هذا التصنيف'
                  : `لا مطاعم في ${area.cityNameAr} بعد`
            }
            body={
              search.trim()
                ? 'جرّب اسماً آخر أو امسح البحث.'
                : category
                  ? 'جرّب تصنيفاً آخر.'
                  : 'نعمل على إضافة مطاعم قريباً. جرّب منطقة أخرى.'
            }
            action={
              search.trim()
                ? { label: 'مسح البحث', onPress: () => setSearch('') }
                : category
                  ? { label: 'كل التصنيفات', onPress: () => setCategory(null) }
                  : { label: 'تغيير المنطقة', onPress: () => setPickingArea(true) }
            }
          />
        ) : (
          shown.map((restaurant) => (
            <RestaurantSummaryCard
              key={restaurant.id}
              restaurant={restaurant}
              onPress={() => router.push(`/restaurant/${restaurant.id}`)}
            />
          ))
        )}
      </View>

      <AreaPicker visible={pickingArea} onClose={() => setPickingArea(false)} />
    </Screen>
  );
}

/**
 * The header: where the order is going, and who is ordering.
 *
 * The comp puts the address here as a button, which is right — it is the one
 * piece of state that changes what the whole screen shows, so it belongs at
 * the top where it can be seen and changed.
 */
function Header({
  areaLabel,
  isResolving,
  onPressArea,
  greeting,
  isGuest,
  onPressSignIn,
}: {
  areaLabel: string | null;
  isResolving: boolean;
  onPressArea: () => void;
  greeting: string | null;
  isGuest: boolean;
  onPressSignIn: () => void;
}) {
  return (
    <View
      style={{
        paddingHorizontal: space[4],
        paddingTop: space[2],
        paddingBottom: space[3],
        backgroundColor: color.surfaceCard,
        borderBottomWidth: 1,
        borderBottomColor: color.borderSubtle,
      }}
    >
      <Row justify="space-between" gap={space[3]}>
        <Pressable
          onPress={onPressArea}
          accessibilityRole="button"
          accessibilityLabel="تغيير منطقة التوصيل"
          accessibilityValue={areaLabel ? { text: areaLabel } : undefined}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', gap: space[2], flex: 1 },
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <IconTile size={40}>
            <MaterialCommunityIcons name="map-marker-outline" size={20} color={color.brand} />
          </IconTile>

          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="muted">
              التوصيل إلى
            </Text>
            <Row gap={space[1]}>
              <Text variant="smallBold" numberOfLines={1} style={{ flexShrink: 1 }}>
                {isResolving ? '…' : (areaLabel ?? 'اختر منطقتك')}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={16} color={color.textMuted} />
            </Row>
          </View>
        </Pressable>

        {/*
         * A guest sees the way in, not a locked door. This is the only place
         * the app asks — everything else stays browsable.
         */}
        {isGuest ? (
          <Pressable
            onPress={onPressSignIn}
            accessibilityRole="button"
            accessibilityLabel="تسجيل الدخول"
            style={({ pressed }) => [
              {
                minHeight: TAP_TARGET - 8,
                paddingHorizontal: space[3],
                borderRadius: radius.full,
                backgroundColor: color.brandSoft,
                borderWidth: 1,
                borderColor: palette.orange[200],
                alignItems: 'center',
                justifyContent: 'center',
              },
              pressed ? { opacity: 0.7 } : null,
            ]}
          >
            <Text variant="caption" tone="brand">
              تسجيل الدخول
            </Text>
          </Pressable>
        ) : greeting ? (
          <IconTile size={40} tone="neutral">
            <Text variant="bodyBold" tone="secondary">
              {greeting.slice(0, 1)}
            </Text>
          </IconTile>
        ) : null}
      </Row>
    </View>
  );
}

/**
 * The banner carousel.
 *
 * Rotates at whatever interval Admin set, and stops rotating the moment the
 * customer touches it: an auto-advance that fights the finger is the most
 * annoying thing a carousel can do, and the one everyone gets wrong.
 */
function BannerCarousel({
  banners,
  seconds,
  onOpenCategory,
}: {
  banners: NonNullable<Awaited<ReturnType<typeof api.storefront>>>['banners'];
  seconds: number;
  onOpenCategory: (key: string) => void;
}) {
  const { width } = useWindowDimensions();
  const list = useRef<FlatList>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const slide = width - space[4] * 2;
  const stride = slide + space[3];

  useEffect(() => {
    if (paused || banners.length < 2) return;

    const timer = setInterval(
      () => {
        setIndex((current) => {
          const next = (current + 1) % banners.length;
          list.current?.scrollToOffset({ offset: next * stride, animated: true });
          return next;
        });
      },
      Math.max(2, seconds) * 1000,
    );

    return () => clearInterval(timer);
  }, [banners.length, seconds, stride, paused]);

  if (banners.length === 0) return null;

  return (
    <View style={{ gap: space[2] }}>
      <FlatList
        ref={list}
        data={banners}
        horizontal
        snapToInterval={stride}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space[3] }}
        // Once the customer takes hold of it, it is theirs.
        onScrollBeginDrag={() => setPaused(true)}
        onMomentumScrollEnd={(event) => {
          setIndex(Math.round(event.nativeEvent.contentOffset.x / stride));
        }}
        keyExtractor={(banner) => banner.id}
        renderItem={({ item }) => (
          <View style={{ width: slide }}>
            <PromoBanner
              title={item.title_ar}
              subtitle={item.subtitle_ar}
              imageUrl={item.image_asset_id ? assetUrl(item.image_asset_id) : null}
              {...(item.link_type === 'CATEGORY' && item.link_value
                ? {
                    ctaLabel: 'اطلب الآن',
                    onPress: () => onOpenCategory(item.link_value as string),
                  }
                : {})}
            />
          </View>
        )}
      />

      {banners.length > 1 ? (
        <Row gap={4} justify="center">
          {banners.map((banner, dot) => (
            <View
              key={banner.id}
              style={{
                width: dot === index ? 18 : 6,
                height: 6,
                borderRadius: radius.full,
                backgroundColor: dot === index ? color.brand : color.borderStrong,
              }}
            />
          ))}
        </Row>
      ) : null}
    </View>
  );
}

function CategoryStrip({
  categories,
  selected,
  onSelect,
}: {
  categories: NonNullable<Awaited<ReturnType<typeof api.storefront>>>['categories'];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  if (categories.length === 0) return null;

  return (
    <View style={{ paddingTop: space[5], gap: space[2] }}>
      <Row justify="space-between" style={{ paddingHorizontal: space[4] }}>
        <Text variant="h3">التصنيفات</Text>
        <Text variant="caption" tone="muted">
          اختر وجبتك
        </Text>
      </Row>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space[4], gap: space[3], paddingVertical: 4 }}
      >
        {categories.map((entry) => {
          const active = selected === entry.key;

          return (
            <Pressable
              key={entry.key}
              onPress={() => onSelect(active ? null : entry.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={entry.name_ar}
              style={{ alignItems: 'center', gap: space[1], width: 72 }}
            >
              <IconTile size={64} active={active}>
                {entry.image_asset_id ? (
                  <Image
                    source={{ uri: assetUrl(entry.image_asset_id) }}
                    style={{ width: 44, height: 44, borderRadius: radius.md }}
                    resizeMode="cover"
                  />
                ) : (
                  <Text variant="h2">{entry.emoji ?? '🍽️'}</Text>
                )}
              </IconTile>

              {/* Two lines: a third of the real category list — «أسماك
                  ومأكولات بحرية» — does not fit on one at this width. */}
              <Text
                variant="caption"
                align="center"
                tone={active ? 'brand' : 'secondary'}
                numberOfLines={2}
              >
                {entry.name_ar}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function RestaurantSummaryCard({
  restaurant,
  onPress,
}: {
  restaurant: RestaurantSummary;
  onPress: () => void;
}) {
  const closed = !restaurant.is_open || !restaurant.accepts_orders;
  const free = restaurant.delivery_fee_iqd === 0;

  return (
    <RestaurantCard
      name={restaurant.display_name}
      /*
       * Arabic labels, not the stored keys. `cuisine_tags` holds `shawarma`,
       * `levantine` — the contract calls them "never shown" and means it;
       * joining the raw array put English into the middle of an Arabic card.
       */
      tags={
        restaurant.cuisine_tags.slice(0, 3).map(cuisineLabelAr).join('، ') ||
        restaurant.city_name_ar
      }
      coverUrl={restaurant.cover_asset_id ? assetUrl(restaurant.cover_asset_id) : null}
      rating={restaurant.rating}
      ratingCount={restaurant.rating_count}
      deliveryFee={free ? 'التوصيل مجاني' : `التوصيل ${formatIqdArabic(iqd(restaurant.delivery_fee_iqd))}`}
      etaMinutes={restaurant.estimated_preparation_minutes}
      offer={free ? 'توصيل مجاني' : null}
      closed={closed}
      onPress={onPress}
    />
  );
}
