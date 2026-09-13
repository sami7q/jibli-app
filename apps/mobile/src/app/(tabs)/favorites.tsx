import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { cuisineLabelAr } from '@jibli/contracts';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError, assetUrl } from '@/lib/api';
import { useIsGuest } from '@/lib/session';
import { radius, space } from '@/theme';
import { EmptyState, ErrorState, Screen, Skeleton, Text } from '@/ui';
import { RestaurantCard } from '@/ui/catalog';

/**
 * Favourites — the fourth tab both comps draw.
 *
 * The one part of the home screen Admin does not arrange: this list is the
 * customer's own. `customer_favorites` has existed since the first migration
 * with nothing writing to it; the heart on the restaurant screen is what
 * finally does.
 */
export default function FavoritesScreen() {
  const router = useRouter();
  const isGuest = useIsGuest();

  const favorites = useQuery({
    queryKey: ['favorites'],
    queryFn: () => api.favorites(),
    enabled: !isGuest,
  });

  return (
    <Screen scroll edges={['top']} padded={false}>
      <View style={{ paddingHorizontal: space[4], paddingTop: space[2] }}>
        <Text variant="h2">المفضلة</Text>
        <Text variant="caption" tone="muted">
          المطاعم التي حفظتها
        </Text>
      </View>

      <View style={{ padding: space[4], gap: space[4] }}>
        {isGuest ? (
          /*
           * A favourite has to belong to someone, so this is one of the two
           * places the app asks for an account. It asks rather than hides the
           * tab: a browsing customer should be able to see what signing in
           * would give them.
           */
          <EmptyState
            title="سجّل دخولك لحفظ مطاعمك"
            body="احفظ المطاعم التي تحبها وارجع إليها بنقرة."
            action={{ label: 'تسجيل الدخول', onPress: () => router.push('/(auth)/phone') }}
          />
        ) : favorites.isLoading ? (
          <>
            <Skeleton height={248} style={{ borderRadius: radius.xl }} />
            <Skeleton height={248} style={{ borderRadius: radius.xl }} />
          </>
        ) : favorites.isError ? (
          <ErrorState
            message={
              favorites.error instanceof ApiError
                ? favorites.error.messageAr
                : 'تعذّر تحميل المفضلة'
            }
            onRetry={() => void favorites.refetch()}
          />
        ) : (favorites.data ?? []).length === 0 ? (
          <EmptyState
            title="لا مفضلات بعد"
            body="اضغط على القلب في صفحة أي مطعم لحفظه هنا."
            action={{ label: 'تصفّح المطاعم', onPress: () => router.push('/(tabs)') }}
          />
        ) : (
          (favorites.data ?? []).map((restaurant) => (
            <RestaurantCard
              key={restaurant.id}
              name={restaurant.display_name}
              tags={
                restaurant.cuisine_tags.slice(0, 3).map(cuisineLabelAr).join('، ') ||
                restaurant.city_name_ar
              }
              coverUrl={restaurant.cover_asset_id ? assetUrl(restaurant.cover_asset_id) : null}
              rating={restaurant.rating}
              ratingCount={restaurant.rating_count}
              deliveryFee={
                restaurant.delivery_fee_iqd === 0
                  ? 'التوصيل مجاني'
                  : `التوصيل ${formatIqdArabic(iqd(restaurant.delivery_fee_iqd))}`
              }
              etaMinutes={restaurant.estimated_preparation_minutes}
              closed={!restaurant.is_open || !restaurant.accepts_orders}
              onPress={() => router.push(`/restaurant/${restaurant.id}`)}
            />
          ))
        )}
      </View>
    </Screen>
  );
}
