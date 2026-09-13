import { useEffect, useRef, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError, assetUrl, type RestaurantCard } from '@/lib/api';
import { useMe } from '@/lib/session';
import { color, radius, shadow, space } from '@/theme';
import { Badge, Card, EmptyState, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';

/**
 * Home.
 *
 * Everything on this screen is arranged from the Admin portal — the banners,
 * their order, how long each holds the screen, the categories and their order.
 * Nothing here is a constant in the app, which is the whole point: a Ramadan
 * banner or a promoted category should not need a release, and a release takes
 * a week to reach every phone through two review queues.
 */
export default function HomeScreen() {
  const me = useMe();
  const [category, setCategory] = useState<string | null>(null);

  const storefront = useQuery({
    queryKey: ['storefront'],
    queryFn: () => api.storefront(),
    // Merchandising changes on the hour, not the minute.
    staleTime: 5 * 60_000,
  });

  const restaurants = useQuery({
    queryKey: ['restaurants', me?.city_id, category],
    queryFn: () => api.restaurants(me?.city_id as string),
    enabled: Boolean(me?.city_id),
  });

  const shown = (restaurants.data ?? []).filter(
    (restaurant) => !category || restaurant.cuisine_tags.includes(category),
  );

  return (
    <Screen scroll edges={['top']} padded={false}>
      <View style={{ paddingHorizontal: space[4], paddingTop: space[2] }}>
        <Text variant="h2">{me?.full_name ? `أهلاً ${me.full_name}` : 'أهلاً بك'}</Text>
        <Text tone="muted" variant="small">
          اطلب من مطاعم مدينتك
        </Text>
      </View>

      {storefront.isLoading ? (
        <View style={{ padding: space[4], gap: space[3] }}>
          <Skeleton height={150} style={{ borderRadius: radius.lg }} />
          <Skeleton height={72} />
        </View>
      ) : (
        <>
          <BannerCarousel
            banners={storefront.data?.banners ?? []}
            seconds={storefront.data?.banner_rotation_seconds ?? 5}
          />
          <CategoryStrip
            categories={storefront.data?.categories ?? []}
            selected={category}
            onSelect={setCategory}
          />
        </>
      )}

      <View style={{ paddingHorizontal: space[4], paddingTop: space[4] }}>
        <Text variant="h3">{category ? 'مطاعم التصنيف' : 'كل المطاعم'}</Text>
      </View>

      {!me?.city_id ? (
        <EmptyState
          title="أكمل ملفك أولاً"
          body="نحتاج مدينتك لعرض المطاعم التي توصّل إليك."
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
        <View style={{ padding: space[4], gap: space[3] }}>
          <Skeleton height={92} style={{ borderRadius: radius.lg }} />
          <Skeleton height={92} style={{ borderRadius: radius.lg }} />
          <Skeleton height={92} style={{ borderRadius: radius.lg }} />
        </View>
      ) : shown.length === 0 ? (
        <EmptyState
          title={category ? 'لا مطاعم في هذا التصنيف' : 'لا مطاعم في مدينتك بعد'}
          body={category ? 'جرّب تصنيفاً آخر.' : 'نعمل على إضافة مطاعم قريباً.'}
          {...(category ? { action: { label: 'كل التصنيفات', onPress: () => setCategory(null) } } : {})}
        />
      ) : (
        <View style={{ padding: space[4], gap: space[3] }}>
          {shown.map((restaurant) => (
            <RestaurantRow key={restaurant.id} restaurant={restaurant} />
          ))}
        </View>
      )}
    </Screen>
  );
}

/**
 * The banner carousel.
 *
 * Rotates at whatever interval Admin set, and stops rotating the moment the
 * customer swipes: an auto-advance that fights the finger is the most annoying
 * thing a carousel can do, and the one everyone gets wrong.
 */
function BannerCarousel({
  banners,
  seconds,
}: {
  banners: NonNullable<Awaited<ReturnType<typeof api.storefront>>>['banners'];
  seconds: number;
}) {
  const { width } = useWindowDimensions();
  const list = useRef<FlatList>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const slide = width - space[4] * 2;

  useEffect(() => {
    if (paused || banners.length < 2) return;

    const timer = setInterval(
      () => {
        setIndex((current) => {
          const next = (current + 1) % banners.length;
          list.current?.scrollToOffset({ offset: next * (slide + space[3]), animated: true });
          return next;
        });
      },
      Math.max(2, seconds) * 1000,
    );

    return () => clearInterval(timer);
  }, [banners.length, seconds, slide, paused]);

  if (banners.length === 0) return null;

  return (
    <View style={{ gap: space[2], paddingTop: space[3] }}>
      <FlatList
        ref={list}
        data={banners}
        horizontal
        pagingEnabled={false}
        snapToInterval={slide + space[3]}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space[4], gap: space[3] }}
        // Once the customer takes hold of it, it is theirs.
        onScrollBeginDrag={() => setPaused(true)}
        onMomentumScrollEnd={(event) => {
          setIndex(Math.round(event.nativeEvent.contentOffset.x / (slide + space[3])));
        }}
        keyExtractor={(banner) => banner.id}
        renderItem={({ item }) => (
          <View
            style={[
              {
                width: slide,
                aspectRatio: 2,
                borderRadius: radius.lg,
                overflow: 'hidden',
                backgroundColor: color.brand,
              },
              shadow.sm,
            ]}
          >
            {item.image_asset_id ? (
              <Image
                source={{ uri: assetUrl(item.image_asset_id) }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
                accessibilityLabel={item.title_ar}
              />
            ) : null}

            {/* A scrim, so Arabic over a photograph stays readable whatever
                the photograph turns out to be. */}
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                start: 0,
                end: 0,
                padding: space[3],
                backgroundColor: 'rgba(0,0,0,0.42)',
              }}
            >
              <Text variant="bodyBold" tone="inverse">
                {item.title_ar}
              </Text>
              {item.subtitle_ar ? (
                <Text variant="caption" tone="inverse">
                  {item.subtitle_ar}
                </Text>
              ) : null}
            </View>
          </View>
        )}
      />

      {banners.length > 1 ? (
        <Row gap={4} justify="center" style={{ paddingTop: space[1] }}>
          {banners.map((banner, dot) => (
            <View
              key={banner.id}
              style={{
                width: dot === index ? 16 : 5,
                height: 5,
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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: space[4], paddingTop: space[4], gap: space[3] }}
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
            style={{ alignItems: 'center', gap: space[1], width: 68 }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: radius.full,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? color.brandSoft : color.surfaceSunken,
                borderWidth: active ? 2 : 0,
                borderColor: color.brand,
              }}
            >
              {entry.image_asset_id ? (
                <Image
                  source={{ uri: assetUrl(entry.image_asset_id) }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              ) : (
                <Text variant="h3">{entry.emoji ?? '🍽️'}</Text>
              )}
            </View>
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
  );
}

function RestaurantRow({ restaurant }: { restaurant: RestaurantCard }) {
  const closed = !restaurant.is_open || !restaurant.accepts_orders;

  return (
    <Card padded={false} style={{ overflow: 'hidden', opacity: closed ? 0.7 : 1 }}>
      <Row gap={space[3]} align="stretch">
        <View
          style={{
            width: 92,
            backgroundColor: color.surfaceSunken,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {restaurant.cover_asset_id ? (
            <Image
              source={{ uri: assetUrl(restaurant.cover_asset_id) }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            <Text variant="h2" tone="muted">
              {restaurant.display_name.slice(0, 1)}
            </Text>
          )}
        </View>

        <View style={{ flex: 1, paddingVertical: space[3], paddingEnd: space[3], gap: space[1] }}>
          <Row justify="space-between">
            <Text variant="bodyBold" numberOfLines={1} style={{ flex: 1 }}>
              {restaurant.display_name}
            </Text>
            {closed ? <Badge label="مغلق الآن" tone="neutral" /> : null}
          </Row>

          <Text variant="caption" tone="muted" numberOfLines={1}>
            {restaurant.cuisine_tags.slice(0, 3).join(' · ') || restaurant.city_name_ar}
          </Text>

          <Row gap={space[3]}>
            {restaurant.rating !== null ? (
              <Text variant="caption" tone="secondary">
                ★ {restaurant.rating.toFixed(1)} ({restaurant.rating_count})
              </Text>
            ) : (
              <Text variant="caption" tone="muted">
                جديد
              </Text>
            )}
            <Text variant="caption" tone="secondary">
              {formatIqdArabic(iqd(restaurant.delivery_fee_iqd))} توصيل
            </Text>
            <Text variant="caption" tone="secondary">
              {restaurant.estimated_preparation_minutes} دقيقة
            </Text>
          </Row>
        </View>
      </Row>
    </Card>
  );
}
