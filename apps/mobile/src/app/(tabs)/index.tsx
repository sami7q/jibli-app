import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { LinearGradient } from 'expo-linear-gradient';
import { arabicCuisineTags } from '@/lib/cuisine-tags';
import { formatIqdArabic, iqd } from '@jibli/money';
import { useServiceFee } from '@/lib/use-service-fee';
import { customerDeliveryFee } from '@/lib/delivery-fee';
import {
  api,
  ApiError,
  assetUrl,
  type DishResult,
  type RestaurantCard as RestaurantSummary,
} from '@/lib/api';
import { useArea } from '@/lib/area';
import { countAr, MINUTES } from '@/lib/arabic-count';
import { ensureLocationPermissionAsked } from '@/lib/location';
import { MODIFIERS_ENABLED } from '@/lib/menu-options';
import { useCart } from '@/lib/cart';
import { useIsGuest, useMe } from '@/lib/session';
import { useUnseenCount } from '@/lib/notification-inbox';
import { confirmAsync } from '@/lib/dialog';
import {
  ALIGN_START,
  BRAND,
  ROW,
  TAP_TARGET,
  accent,
  color,
  palette,
  radius,
  shadow,
  space,
  text,
} from '@/theme';
import { missingImageGlyph } from '@/ui/section-glyph';
import { EmptyState, ErrorState, HScroll, RemoteImage, Row, Screen, Skeleton, Text } from '@/ui';
import { Enter } from '@/ui/enter';
import type { MerchantType } from '@jibli/contracts';
import { useVertical } from '@/lib/vertical';
import { sectionOf } from '@/lib/sections';
import { IconTile, PromoBanner, RestaurantCard, SearchBar } from '@/ui/catalog';
import { AreaPicker } from '@/ui/area-picker';
import { AddressSheet } from '@/ui/address-sheet';
import { PinHomeCard } from '@/ui/pin-home-card';

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
    queryKey: ['dish-search', area?.cityId, debounced, vertical],
    queryFn: () => api.searchDishes(area?.cityId as string, debounced, vertical),
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

  /*
   * Shops in this section whose name matches what is typed — suggestions from
   * the list the screen already holds, so they appear as fast as the letters.
   */
  const matchingShops = useMemo(() => {
    if (!searching) return [];
    const needle = normalizeForMatch(term);
    return (restaurants.data ?? []).filter((shop) =>
      normalizeForMatch(shop.display_name).includes(needle),
    );
  }, [restaurants.data, searching, term]);

  const categories = storefront.data?.categories ?? [];

  /*
   * What to call the things on this tab, in the two forms Arabic needs.
   *
   * Derived once rather than written into each message. The split arrived
   * before these did, and a customer on the market tab in a city with no
   * markets was told «لا مطاعم في بغداد بعد» — a sentence about the wrong half
   * of the app, in the one place where the app has nothing else to say.
   */
  const section = sectionOf(vertical);
  const noun = section.shopsNoun;
  const nounDefinite = section.shopsNounDefinite;

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
        search={search}
        onChangeSearch={setSearch}
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
      {/*
       * Offered once, above the merchandising and below the search.
       *
       * It hides itself when there is nothing to ask — a guest, an address
       * that already carries a point, or an offer already waved away — so on
       * the ordinary launch this renders nothing at all.
       */}
      {searching ? null : <PinHomeCard />}

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
                  : section.nearbyTitle}
            </Text>
            <Text variant="caption" tone="muted">
              {searching
                ? 'الوجبات المتاحة الآن أولاً'
                : area
                  ? section.areaCaption(area.cityNameAr)
                  : section.pickAreaCaption}
            </Text>
          </View>

          {category ? (
            <Pressable
              onPress={() => setCategory(null)}
              accessibilityRole="button"
              accessibilityLabel={`عرض كل ${nounDefinite}`}
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
          ) : (dishes.data ?? []).length === 0 && matchingShops.length === 0 ? (
            <EmptyState
              title="لا نتائج"
              body={`لم نجد منتجاً أو متجراً باسم «${term}» في ${section.shopsNounDefinite} في ${area?.cityNameAr ?? 'منطقتك'}.`}
              action={{ label: 'مسح البحث', onPress: () => setSearch('') }}
            />
          ) : (
            <>
              {/*
                Shops first: a search that names a shop is looking for the
                shop, and in this section only — the same list the home screen
                shows, narrowed by the words typed.
              */}
              {matchingShops.length > 0 ? (
                <View style={{ gap: space[3] }}>
                  <Text variant="smallBold" tone="secondary">
                    {section.shopsNounDefinite}
                  </Text>
                  {matchingShops.slice(0, 5).map((shop) => (
                    <RestaurantSummaryCard
                      key={shop.id}
                      restaurant={shop}
                      onPress={() => router.push(`/restaurant/${shop.id}`)}
                    />
                  ))}
                </View>
              ) : null}
              {(dishes.data ?? []).length > 0 ? (
                <Text variant="smallBold" tone="secondary">
                  المنتجات
                </Text>
              ) : null}
              {(dishes.data ?? []).map((dish) => (
                <DishRow
                  key={dish.id}
                  dish={dish}
                  onOpen={() => router.push(`/restaurant/${dish.restaurant.id}`)}
                />
              ))}
            </>
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

      {/*
       * Two different questions behind one line.
       *
       * A signed-in customer has addresses, and «التوصيل إلى» means «to which
       * of them» — asking them to find their governorate in a list is asking
       * them to repeat what the pin already said. A guest has none and nothing
       * to attach one to, so for them it stays what it was: which city to
       * browse.
       */}
      {isGuest ? (
        <AreaPicker visible={pickingArea} onClose={() => setPickingArea(false)} />
      ) : (
        <AddressSheet
          visible={pickingArea}
          start="list"
          title="التوصيل إلى"
          onClose={() => setPickingArea(false)}
        />
      )}
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
/**
 * The header, and the search that hangs off it.
 *
 * A gradient block in the brand's own ramp with its bottom corners drawn in,
 * and the search field overlapping that edge rather than sitting under it.
 * Both are doing work rather than decorating: the block gives the top of the
 * screen a horizon, so the scrolling content below reads as *under* something
 * instead of beginning at the top of a white page; and a field that straddles
 * the edge ties the two together, which is what keeps the header from looking
 * like a banner somebody dropped on.
 *
 * Everything inside it is the control it always was — the section switch, the
 * delivery area, the cart, the bell. Only the ground under them changed.
 */
function Header({
  areaLabel,
  isResolving,
  onPressArea,
  isGuest,
  onPressSignIn,
  vertical,
  onBack,
  search,
  onChangeSearch,
}: {
  areaLabel: string | null;
  isResolving: boolean;
  onPressArea: () => void;
  isGuest: boolean;
  onPressSignIn: () => void;
  vertical: MerchantType;
  onBack: () => void;
  search: string;
  onChangeSearch: (value: string) => void;
}) {
  const section = sectionOf(vertical);

  return (
    <View style={{ marginBottom: space[2] }}>
      <LinearGradient
        // The section's own ramp: orange for food, green for the market. The
        // header is the one surface large enough for the two halves to be told
        // apart across a room, which is the whole point of the split.
        colors={[...section.header]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={{
          paddingHorizontal: space[4],
          paddingTop: space[2],
          paddingBottom: HEADER_OVERLAP + space[4],
          borderBottomLeftRadius: 30,
          borderBottomRightRadius: 30,
        }}
      >
        {/*
         * Which half you are in, and the way out of it. It sits first because
         * it is the outermost thing about this screen: the delivery area below
         * is a setting within the half, not above it.
         */}
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={`تبديل القسم. القسم الحالي ${section.label}`}
          accessibilityHint="يفتح شاشة اختيار القسم"
          style={({ pressed }) => [
            {
              flexDirection: ROW,
              alignItems: 'center',
              // The header's start corner — the right one, above the delivery
              // area it sits over.
              alignSelf: ALIGN_START,
              gap: space[2],
              height: 34,
              // Physical, because the visual order above is pinned: the round
              // glyph leads on the right and wants the tighter inset.
              paddingRight: space[1],
              paddingLeft: space[3],
              marginBottom: space[3],
              borderRadius: radius.full,
              backgroundColor: 'rgba(255,255,255,0.2)',
            },
            pressed ? { backgroundColor: 'rgba(255,255,255,0.32)' } : null,
          ]}
        >
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: radius.full,
              backgroundColor: 'rgba(255,255,255,0.9)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons
              name={section.icon}
              size={15}
              color={vertical === 'RESTAURANT' ? BRAND[500] : section.ramp[600]}
            />
          </View>

          <Text variant="caption" tone="inverse" style={{ fontWeight: '700' }}>
            {section.label}
          </Text>

          <MaterialCommunityIcons name="swap-horizontal" size={15} color={palette.white} />
        </Pressable>

        <Row justify="space-between" gap={space[3]}>
          <Pressable
            onPress={onPressArea}
            accessibilityRole="button"
            accessibilityLabel="تغيير منطقة التوصيل"
            accessibilityValue={areaLabel ? { text: areaLabel } : undefined}
            style={({ pressed }) => [
              { flexDirection: ROW, alignItems: 'center', gap: space[2], flex: 1 },
              pressed ? { opacity: 0.75 } : null,
            ]}
          >
            {/* The same 40 and corner as the bell across from it, so the row's two tiles match. */}
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.lg,
                backgroundColor: 'rgba(255,255,255,0.2)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons name="map-marker" size={20} color={palette.white} />
            </View>

            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="inverse" style={{ opacity: 0.85 }}>
                التوصيل إلى
              </Text>
              <Row gap={space[1]}>
                <Text
                  variant="smallBold"
                  tone="inverse"
                  numberOfLines={1}
                  style={{ flexShrink: 1 }}
                >
                  {isResolving ? '…' : (areaLabel ?? 'اختر منطقتك')}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={16} color={palette.white} />
              </Row>
            </View>
          </Pressable>

          {isGuest ? (
            <Pressable
              onPress={onPressSignIn}
              accessibilityRole="button"
              accessibilityLabel="تسجيل الدخول"
              style={({ pressed }) => [
                {
                  height: 34,
                  paddingHorizontal: space[3],
                  borderRadius: radius.full,
                  backgroundColor: palette.white,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                pressed ? { opacity: 0.85 } : null,
              ]}
            >
              <Text
                variant="caption"
                style={{
                  color: vertical === 'RESTAURANT' ? BRAND[600] : section.ramp[700],
                  fontWeight: '700',
                }}
              >
                تسجيل الدخول
              </Text>
            </Pressable>
          ) : (
            <NotificationBell />
          )}
        </Row>
      </LinearGradient>

      {/*
       * The field straddles the header's edge.
       *
       * Lifted by exactly the padding the header reserved for it, so the two
       * cannot drift apart when either changes — and given a real shadow,
       * because the thing that makes it read as floating is the shadow, not
       * the position.
       */}
      <View style={{ marginTop: -HEADER_OVERLAP, marginHorizontal: space[4] }}>
        <SearchBar
          value={search}
          onChangeText={onChangeSearch}
          placeholder={section.searchPlaceholder}
          returnKeyType="search"
          accessibilityLabel={section.searchLabel}
          style={shadow.lg}
        />
      </View>
    </View>
  );
}

/**
 * How far the search field is lifted over the header's edge.
 *
 * Half its own height, so it straddles the edge rather than sitting on one
 * side of it. The header reserves `HEADER_OVERLAP + space[4]` at its bottom,
 * which is what keeps the lifted field clear of the delivery-area row above —
 * the two numbers are a pair and moving one without the other closes that gap.
 */
const HEADER_OVERLAP = 26;

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
    queryKey: ['notifications', useMe()?.user_id ?? null],
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
          <View style={{ width: slide, paddingHorizontal: space[4] }}>
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
          {sectionOf(vertical).categoriesCaption}
        </Text>
      </Row>

      <HScroll
        contentContainerStyle={{
          paddingHorizontal: space[4],
          gap: space[3],
          // Room for the selected ring's shadow, which a tight container clips.
          paddingVertical: space[2],
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
      </HScroll>
    </View>
  );
}

/**
 * Every tile is this wide, so the labels form a row rather than a ragged edge.
 *
 * 78 was too small to read on a phone: at that size a plate of food is a smudge
 * and the label under it is the only thing carrying the category, which defeats
 * having a photograph at all. 104 shows what is in the picture and still fits
 * three and a half tiles on the narrowest screen the app supports — enough of a
 * fourth showing to say the strip scrolls.
 */
const CATEGORY_TILE = 68;
const CATEGORY_SLOT = 78;
/**
 * Two caption lines, which is what every tile's label block reserves.
 *
 * `lineHeight` is optional on React Native's `TextStyle`; every style in
 * `text` sets it, which is what the assertion says.
 */
const CATEGORY_LABEL_HEIGHT = 2 * text.caption.lineHeight!;

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
            /*
             * A squircle, not a circle and not a rounded square.
             *
             * 22 on 68 is the proportion the design uses throughout — the
             * cart tile, the location tile, the category — and repeating one
             * corner radius across every small surface is most of what makes
             * a screen look like one piece of work rather than several.
             */
            borderRadius: 22,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: hasImage ? color.surfaceCard : color.surfaceCard,
            /*
             * The ring is drawn inside the tile rather than as an outer glow,
             * so selecting something never nudges its neighbours sideways —
             * a row that shifts under the finger is the reason a second tap
             * lands on the wrong category.
             */
            borderWidth: active ? 2 : 0,
            borderColor: active ? color.brand : 'transparent',
          },
          // Every tile is lifted, the selected one more so. A shadow on the
          // selected tile alone makes the rest read as disabled.
          active ? shadow.md : shadow.sm,
        ]}
      >
        {category.image_asset_id ? (
          <RemoteImage
            uri={assetUrl(category.image_asset_id)}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <Text style={{ fontSize: 30, lineHeight: 38 }}>{category.emoji ?? '🍽️'}</Text>
        )}
      </View>

      {/*
       * A fixed block, not a line that grows.
       *
       * A third of the real category list — «أسماك ومأكولات بحرية» — needs two
       * lines at this width, and reserving them for everybody is what keeps
       * the tiles a row instead of a staircase. Two caption lines, exactly:
       * it was 30, which is a line and a half, and the second line of a long
       * name was cut off at the waist.
       */}
      <View style={{ height: CATEGORY_LABEL_HEIGHT, justifyContent: 'flex-start' }}>
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
  const { add, cart } = useCart();
  const router = useRouter();
  const orderable = dish.restaurant.accepts_orders && dish.is_available;
  /*
   * A required-choice dish is excluded from quick-add here too (CUST-2). With
   * modifiers on it opens the sheet to choose; with them off it cannot be
   * ordered at all, so no control is drawn — the row still opens the shop,
   * which shows it as «يتوفر قريباً».
   */
  const showAdd = orderable && (!dish.requires_choice || MODIFIERS_ENABLED);

  // A View, not a Pressable: the plus below is its own control, and a button
  // inside a button is invalid on the web and ambiguous on a phone.
  return (
    <View
      style={{
        flexDirection: ROW,
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
            التحضير {countAr(dish.restaurant.estimated_preparation_minutes, MINUTES)}
          </Text>
        </Row>

        {/* Labelled, not just dimmed — a search result otherwise looks orderable
            (CUST-23). */}
        {!dish.is_available ? (
          <Text variant="caption" tone="danger">
            غير متوفر حالياً
          </Text>
        ) : null}
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
            <RemoteImage
              uri={assetUrl(dish.image_asset_id)}
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <MaterialCommunityIcons name={missingImageGlyph()} size={22} color={accent[300]} />
          )}
        </View>

        {showAdd ? (
          <Pressable
            onPress={() => {
              /*
               * A dish with a required choice opens its shop instead of adding
               * (CUST-2): with options on, the sheet collects the choice; with
               * them off it is shown as «يتوفر قريباً», so this branch is only
               * reached with options on.
               */
              if (dish.requires_choice) {
                router.push(`/restaurant/${dish.restaurant.id}?item=${dish.id}`);
                return;
              }

              const meta = {
                restaurantId: dish.restaurant.id,
                branchId: dish.restaurant.branch_id,
                restaurantName: dish.restaurant.display_name,
                deliveryFeeIqd: dish.restaurant.delivery_fee_iqd,
                minimumOrderIqd: dish.restaurant.minimum_order_iqd,
              };
              const line = {
                menuItemId: dish.id,
                nameAr: dish.name_ar,
                unitPriceIqd: dish.price_iqd,
                quantity: 1,
                imageAssetId: dish.image_asset_id,
                notes: null,
              };

              // Ask before emptying another shop's cart, rather than after
              // (CUST-8).
              if (cart && cart.restaurantId !== meta.restaurantId) {
                void confirmAsync({
                  title: 'بدء سلة جديدة؟',
                  message: `سلتك فيها طلب من «${cart.restaurantName}». إذا أضفت من «${meta.restaurantName}» سنفرّغها.`,
                  confirmLabel: 'تفريغ وإضافة',
                  cancelLabel: 'إبقاء سلتي',
                }).then((yes) => {
                  if (yes) add(meta, line);
                });
                return;
              }
              add(meta, line);
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
                right: -space[2],
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
  const deliveryShown = customerDeliveryFee(restaurant.delivery_fee_iqd, useServiceFee());
  const free = deliveryShown === 0;

  return (
    <RestaurantCard
      name={restaurant.display_name}
      /*
       * Arabic labels, not the stored keys. `cuisine_tags` holds `shawarma`,
       * `levantine` — the contract calls them "never shown" and means it;
       * joining the raw array put English into the middle of an Arabic card,
       * and an untranslated key like «grocery» straight through (CUST-20).
       */
      tags={arabicCuisineTags(restaurant.cuisine_tags, 3).join('، ') || restaurant.city_name_ar}
      coverUrl={restaurant.cover_asset_id ? assetUrl(restaurant.cover_asset_id) : null}
      rating={restaurant.rating}
      ratingCount={restaurant.rating_count}
      deliveryFee={free ? 'التوصيل مجاني' : `التوصيل ${formatIqdArabic(iqd(deliveryShown))}`}
      etaMinutes={restaurant.estimated_preparation_minutes}
      offer={free ? 'توصيل مجاني' : null}
      closed={closed}
      onPress={onPress}
    />
  );
}

/** Fold the alef and taa-marbuta variants so «العراقى» finds «العراقي». */
function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}
