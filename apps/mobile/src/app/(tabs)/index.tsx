import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { cuisineLabelAr } from '@jibli/contracts';
import { formatIqdArabic, iqd } from '@jibli/money';
import {
  api,
  ApiError,
  assetUrl,
  type DishResult,
  type RestaurantCard as RestaurantSummary,
} from '@/lib/api';
import { useArea } from '@/lib/area';
import { ensureLocationPermissionAsked } from '@/lib/location';
import { useCart } from '@/lib/cart';
import { useIsGuest } from '@/lib/session';
import { useUnseenCount } from '@/lib/notification-inbox';
import { notify } from '@/lib/dialog';
import { TAP_TARGET, accent, color, palette, radius, shadow, space } from '@/theme';
import { missingImageGlyph } from '@/ui/section-glyph';
import { EmptyState, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';
import { Enter } from '@/ui/enter';
import type { MerchantType } from '@jibli/contracts';
import { useVertical } from '@/lib/vertical';
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
  const { width: windowWidth } = useWindowDimensions();
  const isGuest = useIsGuest();
  const router = useRouter();
  const { area, isResolving } = useArea();

  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pickingArea, setPickingArea] = useState(false);

  /*
   * Which half of Jibli this is, decided on the screen before this one.
   *
   * Never null here: the Gate routes anyone without an answer to the chooser,
   * so by the time this renders the question is settled. The fallback exists
   * only to satisfy the type — a frame rendered during the redirect should
   * show the commoner half rather than nothing.
   */
  const { vertical: chosen, clear: backToChooser } = useVertical();
  const vertical = chosen ?? 'RESTAURANT';

  const storefront = useQuery({
    // Keyed by the half, because the banners and the category strip differ
    // between them — that is the reason the chooser exists.
    queryKey: ['storefront', vertical],
    queryFn: () => api.storefront(vertical),
    // Merchandising changes on the hour, not the minute.
    staleTime: 5 * 60_000,
  });

  const restaurants = useQuery({
    // The type is in the key, so switching halves does not show the other
    // one's merchants for a frame while the new request is in flight.
    queryKey: ['restaurants', area?.cityId, vertical],
    queryFn: () => api.restaurants(area?.cityId as string, undefined, vertical),
    enabled: Boolean(area?.cityId),
  });

  const term = search.trim();

  /*
   * Searching means searching the menu, not the sign above the door.
   *
   * Someone who types «دجاج» wants chicken; they do not know, and should not
   * have to know, which restaurant sells it. So a search asks the server for
   * dishes across the whole city and the answer is something orderable —
   * with open kitchens first, because a dish from a shut one is a worse
   * answer whatever its rating.
   *
   * Debounced, because this one is a real request per keystroke otherwise.
   */
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  /*
   * The location prompt, here and nowhere else.
   *
   * On the home screen rather than at the root, because the root also holds
   * the sign-in and the splash, and a permission dialog over a welcome screen
   * is the one every customer denies. By the time this renders they have
   * chosen an area and are looking at restaurants that deliver to it, which is
   * the sentence the dialog is asking them to agree with. It asks once, ever.
   */
  useEffect(() => {
    void ensureLocationPermissionAsked();
  }, []);

  const dishes = useQuery({
    queryKey: ['dish-search', area?.cityId, debounced],
    queryFn: () => api.searchDishes(area?.cityId as string, debounced),
    enabled: Boolean(area?.cityId) && debounced.length >= 2,
  });

  /** The category filter still runs locally; the list is tens of rows. */
  const shown = useMemo(
    () =>
      (restaurants.data ?? []).filter(
        (restaurant) => !category || restaurant.cuisine_tags.includes(category),
      ),
    [restaurants.data, category],
  );

  const searching = term.length >= 2;

  const categories = storefront.data?.categories ?? [];

  /*
   * What to call the things on this tab, in the two forms Arabic needs.
   *
   * Derived once rather than written into each message. The split arrived
   * before these did, and a customer on the market tab in a city with no
   * markets was told «لا مطاعم في بغداد بعد» — a sentence about the wrong half
   * of the app, in the one place where the app has nothing else to say.
   */
  const noun = vertical === 'MARKET' ? 'ماركتات' : 'مطاعم';
  const nounDefinite = vertical === 'MARKET' ? 'الماركتات' : 'المطاعم';

  return (
    <Screen scroll edges={['top']} padded={false}>
      <Header
        areaLabel={area?.cityNameAr ?? null}
        isResolving={isResolving}
        onPressArea={() => setPickingArea(true)}
        isGuest={isGuest}
        onPressSignIn={() => router.push('/(auth)/phone')}
        vertical={vertical}
        onBack={() => {
          // Clearing the choice is what sends the Gate back to the chooser;
          // navigating there directly would leave a stale half behind it.
          setCategory(null);
          setSearch('');
          backToChooser();
        }}
      />

      {/*
       * The screen arrives in order, top to bottom.
       *
       * Not decoration: home resolves an area, a storefront and a restaurant
       * list, and the pieces land whenever their request does — so the screen
       * used to assemble itself in whatever sequence the network chose. A
       * short stagger imposes the reading order instead, and covers the same
       * moment the skeletons were covering.
       *
       * Sixty milliseconds apart. Any slower and a returning customer, who
       * opens this ten times a day, starts waiting for it.
       */}
      <Enter delay={40} style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder={vertical === 'MARKET' ? 'ابحث عن منتج أو ماركت…' : 'ابحث عن مطعم أو وجبة…'}
          returnKeyType="search"
          accessibilityLabel={
            vertical === 'MARKET' ? 'البحث عن منتج أو ماركت' : 'البحث عن مطعم أو وجبة'
          }
        />
      </Enter>

      {/*
       * The banner runs edge to edge.
       *
       * It was inset by the page gutter like everything else, which made an
       * advertisement look like a card — the one thing on the screen that is
       * paid for, framed smaller than the restaurant cards under it. Full
       * bleed is what every delivery app does with this slot, and it is why
       * the corner radius drops here too: a rounded rectangle touching both
       * edges reads as a mistake.
       */}
      {searching ? null : storefront.isLoading ? (
        // The same 16:9 the real banner uses, so the layout does not jump the
        // moment the carousel replaces it.
        <Skeleton height={(windowWidth * 9) / 16} style={{ marginTop: space[4] }} />
      ) : (
        <Enter delay={60}>
          <BannerCarousel
            banners={storefront.data?.banners ?? []}
            seconds={storefront.data?.banner_rotation_seconds ?? 5}
            onOpenCategory={setCategory}
          />
        </Enter>
      )}

      {searching ? null : storefront.isLoading ? (
        <View style={{ padding: space[4] }}>
          <Skeleton height={92} />
        </View>
      ) : (
        <Enter delay={120}>
          <CategoryStrip
            categories={categories}
            selected={category}
            onSelect={setCategory}
            vertical={vertical}
          />
        </Enter>
      )}

      <View style={{ paddingHorizontal: space[4], paddingTop: space[5] }}>
        <Row justify="space-between" align="flex-start">
          <View style={{ flex: 1 }}>
            <Text variant="h3">
              {searching
                ? `نتائج البحث عن «${term}»`
                : category
                  ? (categories.find((entry) => entry.key === category)?.name_ar ?? 'مطاعم التصنيف')
                  : vertical === 'MARKET'
                    ? 'الماركتات القريبة منك'
                    : 'المطاعم القريبة منك'}
            </Text>
            <Text variant="caption" tone="muted">
              {searching
                ? 'الوجبات المتاحة الآن أولاً'
                : area
                  ? vertical === 'MARKET'
                    ? `ماركتات توصّل إلى ${area.cityNameAr}`
                    : `أفضل المطاعم في ${area.cityNameAr}`
                  : vertical === 'MARKET'
                    ? 'اختر منطقتك لعرض الماركتات'
                    : 'اختر منطقتك لعرض المطاعم'}
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
        {searching ? (
          dishes.isLoading ? (
            <>
              <Skeleton height={96} style={{ borderRadius: radius.lg }} />
              <Skeleton height={96} style={{ borderRadius: radius.lg }} />
            </>
          ) : dishes.isError ? (
            <ErrorState
              message={dishes.error instanceof ApiError ? dishes.error.messageAr : 'تعذّر البحث'}
              onRetry={() => void dishes.refetch()}
            />
          ) : (dishes.data ?? []).length === 0 ? (
            <EmptyState
              title="لا نتائج"
              body={`لم نجد وجبة أو مطعماً باسم «${term}» في ${area?.cityNameAr ?? 'منطقتك'}.`}
              action={{ label: 'مسح البحث', onPress: () => setSearch('') }}
            />
          ) : (
            (dishes.data ?? []).map((dish) => (
              <DishRow
                key={dish.id}
                dish={dish}
                onOpen={() => router.push(`/restaurant/${dish.restaurant.id}`)}
              />
            ))
          )
        ) : isResolving ? (
          <Skeleton height={248} style={{ borderRadius: radius.xl }} />
        ) : !area ? (
          <EmptyState
            title="اختر منطقتك"
            body={`نعرض لك ${nounDefinite} التي توصّل إلى منطقتك فقط.`}
            action={{ label: 'اختيار المنطقة', onPress: () => setPickingArea(true) }}
          />
        ) : restaurants.isError ? (
          <ErrorState
            message={
              restaurants.error instanceof ApiError
                ? restaurants.error.messageAr
                : `تعذّر تحميل ${nounDefinite}`
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
                  ? `لا ${noun} في هذا التصنيف`
                  : `لا ${noun} في ${area.cityNameAr} بعد`
            }
            body={
              search.trim()
                ? 'جرّب اسماً آخر أو امسح البحث.'
                : category
                  ? 'جرّب تصنيفاً آخر.'
                  : `نعمل على إضافة ${noun} قريباً. جرّب منطقة أخرى.`
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
  isGuest,
  onPressSignIn,
  vertical,
  onBack,
}: {
  areaLabel: string | null;
  isResolving: boolean;
  onPressArea: () => void;
  isGuest: boolean;
  onPressSignIn: () => void;
  vertical: MerchantType;
  onBack: () => void;
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
      {/*
       * Which half you are in, and the way out of it.
       *
       * This was a 16px chevron on a tinted chip, and it failed at both jobs.
       * A chevron pointing away from a section name is read as «there is more
       * of this», not «leave this» — the one gesture it has to suggest is a
       * swap, so it says so, in a word and in an icon that shows two
       * directions rather than one. And at caption size on a 24pt chip it was
       * a label that happened to be tappable; it is now a control with a real
       * target, a border, and a filled tile carrying the section's own glyph.
       *
       * It is the first row because it is the outermost thing about this
       * screen: the delivery area below it is a setting within the half, not
       * above it.
       */}
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={`تبديل القسم. القسم الحالي ${
          vertical === 'MARKET' ? 'جيبلي ماركت' : 'جيبلي أكل'
        }`}
        accessibilityHint="يفتح شاشة اختيار القسم"
        style={({ pressed }) => [
          {
            flexDirection: 'row-reverse',
            alignItems: 'center',
            alignSelf: 'flex-start',
            gap: space[2],
            height: 38,
            paddingInlineStart: space[1],
            paddingInlineEnd: space[3],
            marginBottom: space[3],
            borderRadius: radius.full,
            borderWidth: 1,
            borderColor: accent[200],
            backgroundColor: pressed ? accent[100] : color.brandSoft,
          },
        ]}
      >
        {/* The section, as a filled tile — the one element with real contrast. */}
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: radius.full,
            backgroundColor: color.brand,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons
            name={vertical === 'MARKET' ? 'basket-outline' : 'silverware-fork-knife'}
            size={17}
            color={palette.white}
          />
        </View>

        <Text variant="smallBold" style={{ color: color.textBrand }}>
          {vertical === 'MARKET' ? 'جيبلي ماركت' : 'جيبلي أكل'}
        </Text>

        {/* Hairline, so the name and the action read as two things. */}
        <View style={{ width: 1, height: 16, backgroundColor: accent[200] }} />

        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: space[1] }}>
          <MaterialCommunityIcons name="swap-horizontal" size={16} color={color.textBrand} />
          <Text variant="caption" style={{ color: color.textBrand }}>
            تبديل
          </Text>
        </View>
      </Pressable>

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
                borderColor: accent[200],
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
        ) : (
          <NotificationBell />
        )}
      </Row>
    </View>
  );
}

/**
 * The way back to an update nobody was looking at when it arrived.
 *
 * It replaces the initial-in-a-circle that stood here, which was decoration:
 * it was not pressable, it repeated a name the account tab already shows, and
 * it occupied the one corner every app puts its notifications in.
 *
 * The count comes from the same feed the screen behind it renders, so the
 * badge and the list can never disagree about how many there are.
 */
function NotificationBell() {
  const router = useRouter();

  const feed = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.notifications(),
    staleTime: 30_000,
  });

  const unseen = useUnseenCount(feed.data);

  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      accessibilityRole="button"
      accessibilityLabel={unseen > 0 ? `الإشعارات، ${unseen} جديد` : 'الإشعارات'}
      style={({ pressed }) => [pressed ? { opacity: 0.7 } : null]}
    >
      <IconTile size={40} tone="neutral">
        <MaterialCommunityIcons
          name={unseen > 0 ? 'bell-badge' : 'bell-outline'}
          size={20}
          color={unseen > 0 ? color.brand : color.textSecondary}
        />
      </IconTile>

      {unseen > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -4,
            left: -4,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: radius.full,
            backgroundColor: color.brand,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: color.surfaceCard,
          }}
        >
          <Text variant="caption" tone="inverse" style={{ fontSize: 10, lineHeight: 12 }}>
            {unseen > 9 ? '+9' : String(unseen)}
          </Text>
        </View>
      ) : null}
    </Pressable>
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

  // One screen per slide, so a swipe lands on the next banner rather than
  // halfway between two.
  const slide = width;
  const stride = width;

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
    <View style={{ gap: space[2], paddingTop: space[4] }}>
      <FlatList
        ref={list}
        data={banners}
        horizontal
        pagingEnabled
        snapToInterval={stride}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        // Once the customer takes hold of it, it is theirs.
        onScrollBeginDrag={() => setPaused(true)}
        onMomentumScrollEnd={(event) => {
          setIndex(Math.round(event.nativeEvent.contentOffset.x / stride));
        }}
        keyExtractor={(banner) => banner.id}
        renderItem={({ item }) => (
          <View style={{ width: slide }}>
            <PromoBanner
              fullBleed
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
  vertical,
}: {
  categories: NonNullable<Awaited<ReturnType<typeof api.storefront>>>['categories'];
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** «اختر وجبتك» is the wrong instruction above a shelf of detergent. */
  vertical: MerchantType;
}) {
  if (categories.length === 0) return null;

  return (
    <View style={{ paddingTop: space[5], gap: space[3] }}>
      <Row justify="space-between" style={{ paddingHorizontal: space[4] }}>
        <Text variant="h3">التصنيفات</Text>
        <Text variant="caption" tone="muted">
          {vertical === 'MARKET' ? 'تسوّق حسب القسم' : 'اختر وجبتك'}
        </Text>
      </Row>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: space[4],
          gap: space[3],
          // Room for the selected ring's shadow, which a tight container clips.
          paddingVertical: space[1],
        }}
      >
        {categories.map((entry) => (
          <CategoryTile
            key={entry.key}
            category={entry}
            active={selected === entry.key}
            onPress={() => onSelect(selected === entry.key ? null : entry.key)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** Every tile is this wide, so the labels form a row rather than a ragged edge. */
const CATEGORY_TILE = 78;
const CATEGORY_SLOT = 88;

/**
 * One category: a photograph, at a size worth photographing for.
 *
 * Three things were wrong with the strip this replaces, and they compounded.
 * The picture was 44px inside a 64px chip, so a third of the tile was padding
 * and the food was the size of a favicon. Selecting a category then filled
 * that chip with solid brand orange — *behind* a photo that covers it, so the
 * one visible effect was on the sliver of padding around the edge, and on an
 * emoji category the fill swallowed the emoji whole. And the labels ran to two
 * lines only when they had to, leaving every tile at a different height and
 * the bottom of the row looking torn.
 *
 * So: the image fills its tile edge to edge, selection is a ring around the
 * picture rather than a wash over it, and the label occupies a fixed two-line
 * block whether it needs one line or two.
 *
 * Not `IconTile`. That is a chip that holds an icon — small, tinted, with the
 * icon floating inside it — and this is a photograph with a selected state.
 * Bending one component to be both would have meant an `image` mode where
 * half its props stop applying.
 */
function CategoryTile({
  category,
  active,
  onPress,
}: {
  category: NonNullable<Awaited<ReturnType<typeof api.storefront>>>['categories'][number];
  active: boolean;
  onPress: () => void;
}) {
  const hasImage = Boolean(category.image_asset_id);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={category.name_ar}
      style={({ pressed }) => [
        { alignItems: 'center', gap: space[2], width: CATEGORY_SLOT },
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      <View
        style={[
          {
            width: CATEGORY_TILE,
            height: CATEGORY_TILE,
            borderRadius: radius.xl,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            // Only ever seen behind an emoji: a photograph covers it entirely.
            backgroundColor: hasImage ? color.surfaceSunken : color.brandSoft,
            /*
             * The ring is drawn inside the tile rather than as an outer glow,
             * so selecting something never nudges its neighbours sideways —
             * a row that shifts under the finger is the reason a second tap
             * lands on the wrong category.
             */
            borderWidth: active ? 3 : 1,
            borderColor: active ? color.brand : color.borderSubtle,
          },
          active ? shadow.md : null,
        ]}
      >
        {category.image_asset_id ? (
          <Image
            source={{ uri: assetUrl(category.image_asset_id) }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <Text style={{ fontSize: 34, lineHeight: 42 }}>{category.emoji ?? '🍽️'}</Text>
        )}
      </View>

      {/*
       * A fixed block, not a line that grows.
       *
       * A third of the real category list — «أسماك ومأكولات بحرية» — needs two
       * lines at this width, and reserving them for everybody is what keeps
       * the tiles a row instead of a staircase.
       */}
      <View style={{ height: 32, justifyContent: 'flex-start' }}>
        <Text
          variant={active ? 'captionBold' : 'caption'}
          align="center"
          tone={active ? 'brand' : 'secondary'}
          numberOfLines={2}
        >
          {category.name_ar}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * One search result: the dish, and the restaurant that sells it.
 *
 * The restaurant is the second line rather than the first because the customer
 * searched for food. A closed kitchen's dish is still shown — it may be what
 * they want tomorrow — but it is dimmed and says so, and it sorts below every
 * open one.
 */
function DishRow({ dish, onOpen }: { dish: DishResult; onOpen: () => void }) {
  const { add } = useCart();
  const router = useRouter();
  const orderable = dish.restaurant.accepts_orders && dish.is_available;

  // A View, not a Pressable: the plus below is its own control, and a button
  // inside a button is invalid on the web and ambiguous on a phone.
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space[3],
        padding: space[3],
        backgroundColor: color.surfaceCard,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.borderSubtle,
        opacity: orderable ? 1 : 0.62,
      }}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${dish.name_ar} من ${dish.restaurant.display_name}`}
        style={({ pressed }) => [{ flex: 1, gap: space[1] }, pressed ? { opacity: 0.7 } : null]}
      >
        <Text variant="bodyBold" numberOfLines={1}>
          {dish.name_ar}
        </Text>

        <Row gap={space[1]}>
          <MaterialCommunityIcons name="store-outline" size={14} color={color.textMuted} />
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {dish.restaurant.display_name}
          </Text>
          {!dish.restaurant.accepts_orders ? (
            <Text variant="caption" tone="danger">
              · مغلق الآن
            </Text>
          ) : null}
        </Row>

        <Row gap={space[3]}>
          <Text variant="smallBold" tone="brand">
            {formatIqdArabic(iqd(dish.price_iqd))}
          </Text>
          <Text variant="caption" tone="secondary">
            {dish.restaurant.estimated_preparation_minutes} دقيقة
          </Text>
        </Row>
      </Pressable>

      <View>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: radius.md,
            overflow: 'hidden',
            backgroundColor: color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {dish.image_asset_id ? (
            <Image
              source={{ uri: assetUrl(dish.image_asset_id) }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            <MaterialCommunityIcons name={missingImageGlyph()} size={22} color={accent[300]} />
          )}
        </View>

        {orderable ? (
          <Pressable
            onPress={() => {
              /*
               * A dish with a required choice cannot be added from here.
               *
               * Adding it produced a cart line with no size or bread chosen,
               * which the quote refuses — so the customer only found out at
               * checkout, facing «اختيارات الإضافات غير صحيحة» over a whole
               * order with nothing naming the line at fault. The sheet needs
               * the restaurant and the item's groups, so the row sends them to
               * the menu with the dish named and it opens there.
               */
              if (dish.requires_choice) {
                router.push(`/restaurant/${dish.restaurant.id}?item=${dish.id}`);
                return;
              }

              const result = add(
                {
                  restaurantId: dish.restaurant.id,
                  branchId: dish.restaurant.branch_id,
                  restaurantName: dish.restaurant.display_name,
                  deliveryFeeIqd: dish.restaurant.delivery_fee_iqd,
                  minimumOrderIqd: dish.restaurant.minimum_order_iqd,
                },
                {
                  menuItemId: dish.id,
                  nameAr: dish.name_ar,
                  unitPriceIqd: dish.price_iqd,
                  quantity: 1,
                  imageAssetId: dish.image_asset_id,
                  notes: null,
                },
              );
              if (result === 'replaced') {
                notify(
                  'تم تفريغ السلة',
                  'السلة تحتوي طلباً من مطعم آخر، وقد استبدلناها بهذا الطلب.',
                );
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={
              dish.requires_choice
                ? `اختيار خيارات ${dish.name_ar}`
                : `إضافة ${dish.name_ar} إلى السلة`
            }
            hitSlop={space[2]}
            style={({ pressed }) => [
              {
                position: 'absolute',
                bottom: -space[2],
                insetInlineStart: -space[2],
                width: 32,
                height: 32,
                borderRadius: radius.full,
                backgroundColor: color.brand,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: color.surfaceCard,
              },
              pressed ? { opacity: 0.75 } : null,
            ]}
          >
            {/* A chevron, not a plus: this one opens something rather than
                adding something, and drawing them the same is how a customer
                learns that «+» sometimes lies. */}
            <MaterialCommunityIcons
              name={dish.requires_choice ? 'chevron-left' : 'plus'}
              size={18}
              color={palette.white}
            />
          </Pressable>
        ) : null}
      </View>
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
      deliveryFee={
        free ? 'التوصيل مجاني' : `التوصيل ${formatIqdArabic(iqd(restaurant.delivery_fee_iqd))}`
      }
      etaMinutes={restaurant.estimated_preparation_minutes}
      offer={free ? 'توصيل مجاني' : null}
      closed={closed}
      onPress={onPress}
    />
  );
}
