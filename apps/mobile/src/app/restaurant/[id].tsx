import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { DishPlaceholder } from '@/ui/dish-placeholder';
import { cuisineLabelAr } from '@jibli/contracts';
import { formatIqdArabic, iqd } from '@jibli/money';
import { api, ApiError, assetUrl, type MenuItem } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { useIsGuest } from '@/lib/session';
import { notify } from '@/lib/dialog';
import { ROW, TAP_TARGET, accent, color, palette, radius, shadow, space } from '@/theme';
import { missingImageGlyph } from '@/ui/section-glyph';
import { Button, ErrorState, Row, Screen, Skeleton, Text } from '@/ui';
import { CartBar, RatingPill, Sheet, Stepper } from '@/ui/catalog';

/**
 * Restaurant detail and menu (`6.html`).
 *
 * Public: a guest reads the whole menu and fills a cart. The account is asked
 * for at checkout, which is the only step that actually needs one — an order
 * needs an address to go to (App Store 5.1.1(ii)).
 *
 * The cover, the badges and the category tabs come straight from the comp. The
 * open/closed state does not: it is computed on the server from the working
 * hours the restaurant set in its own portal, so a closed kitchen cannot be
 * ordered from no matter what this screen renders.
 */
/**
 * Whether a dish can carry options — sizes, extras, removals.
 *
 * Off, and deliberately, until the whole path exists rather than half of it.
 * The catalog reports `requires_choice` and this screen could collect a
 * selection, but nothing downstream carries it: the cart has no field for it,
 * `POST /orders` has no parameter for it, and the API re-prices every line
 * from the menu. A choice was flattened into the order's free-text note and
 * its price added on the client only — so a customer could pick a 2,000 dinar
 * extra, watch the total rise, and be charged the base price for a dish the
 * kitchen would read about in a comment.
 *
 * Turning it off removes that, and it costs the customer nothing today: every
 * dish is orderable with one tap, which is what this stage of the product
 * needs. The code stays because the work to finish it is downstream, not here
 * — a column on the order line, a parameter on the endpoint, and pricing that
 * the server owns. Then this becomes `true`.
 */
const MODIFIERS_ENABLED = false;

export default function RestaurantScreen() {
  const { id, item: itemToOpen } = useLocalSearchParams<{ id: string; item?: string }>();
  const router = useRouter();
  const { cart, itemCount, subtotalIqd } = useCart();

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  /** So arriving with `?item=` opens the sheet once and not again on every render. */
  const autoOpened = useRef(false);

  /*
   * Where each category section starts, measured as it lays out.
   *
   * Without this the category tabs are decoration — they highlight and nothing
   * moves, which is the sort of control that teaches people to stop trusting
   * the interface.
   */
  const scroller = useRef<ScrollView>(null);
  const sectionTops = useRef<Record<string, number>>({});

  const jumpTo = (categoryId: string) => {
    setActiveCategory(categoryId);
    const top = sectionTops.current[categoryId];
    if (top !== undefined) {
      scroller.current?.scrollTo({ y: Math.max(0, top - space[2]), animated: true });
    }
  };

  const { add } = useCart();

  const restaurant = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => api.restaurant(id),
    enabled: Boolean(id),
  });

  /*
   * Arriving from a search result that needs a choice.
   *
   * The row on the home screen cannot open the sheet itself — the sheet needs
   * the restaurant, its menu and the item's groups — so it sends the customer
   * here with the dish named, and the sheet opens on top of the menu the
   * moment it loads. Once: re-opening on every render would trap anyone who
   * closed it.
   */
  useEffect(() => {
    if (autoOpened.current || !itemToOpen || !restaurant.data) return;

    const found = restaurant.data.categories
      .flatMap((category) => category.items)
      .find((item) => item.id === itemToOpen);

    autoOpened.current = true;
    if (found) setOpenItem(found);
  }, [itemToOpen, restaurant.data]);

  /**
   * One tap, one item, no sheet.
   *
   * Straight to the cart at the listed price with no options chosen — which is
   * correct for a dish that has none, and is what most dishes are. An item
   * whose options include a required group still has to go through the sheet,
   * so this is only offered where it cannot produce an order the kitchen
   * cannot fill; see `quickAddable` below.
   */
  const quickAdd = (item: MenuItem) => {
    const detail = restaurant.data;
    if (!detail) return;

    const result = add(
      {
        restaurantId: detail.id,
        branchId: detail.branch_id,
        restaurantName: detail.display_name,
        deliveryFeeIqd: detail.delivery_fee_iqd,
        minimumOrderIqd: detail.minimum_order_iqd,
      },
      {
        menuItemId: item.id,
        nameAr: item.name_ar,
        unitPriceIqd: item.price_iqd,
        quantity: 1,
        imageAssetId: item.image_asset_id,
        notes: null,
      },
    );

    if (result === 'replaced') {
      notify('تم تفريغ السلة', 'السلة تحتوي طلباً من مطعم آخر، وقد استبدلناها بهذا الطلب.');
    }
  };

  const categories = restaurant.data?.categories ?? [];
  const shownCategories = useMemo(
    () => categories.filter((category) => category.items.length > 0),
    [categories],
  );

  if (restaurant.isLoading) {
    return (
      <Screen padded={false} edges={['top']}>
        <Skeleton height={220} />
        <View style={{ padding: space[4], gap: space[3] }}>
          <Skeleton height={96} style={{ borderRadius: radius.xl }} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      </Screen>
    );
  }

  if (restaurant.isError || !restaurant.data) {
    return (
      <Screen edges={['top']}>
        <ErrorState
          message={
            restaurant.error instanceof ApiError ? restaurant.error.messageAr : 'تعذّر تحميل المطعم'
          }
          onRetry={() => void restaurant.refetch()}
        />
      </Screen>
    );
  }

  const detail = restaurant.data;
  const cartIsThisRestaurant = cart?.restaurantId === detail.id;

  return (
    <Screen padded={false} edges={[]} background={color.surfacePage}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={{ paddingBottom: itemCount > 0 ? 120 : space[8] }}
        showsVerticalScrollIndicator={false}
      >
        <Cover
          coverUrl={detail.cover_asset_id ? assetUrl(detail.cover_asset_id) : null}
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          restaurantId={detail.id}
        />

        <InfoCard
          name={detail.display_name}
          tags={detail.cuisine_tags.map(cuisineLabelAr).join('، ') || detail.city_name_ar}
          logoUrl={detail.logo_asset_id ? assetUrl(detail.logo_asset_id) : null}
          rating={detail.rating}
          ratingCount={detail.rating_count}
          etaMinutes={detail.estimated_preparation_minutes}
          deliveryFeeIqd={detail.delivery_fee_iqd}
          minimumOrderIqd={detail.minimum_order_iqd}
          isOpen={detail.is_open}
          orderable={detail.orderable}
        />

        {/*
         * Why nothing responds.
         *
         * A closed restaurant's dishes are faded and inert, which is correct
         * — but the «مغلق الآن» badge is in the card at the top, and by the
         * time someone has scrolled into the menu it is off screen. Tapping a
         * dish and getting nothing is the experience this line prevents.
         */}
        {!detail.orderable ? (
          <View
            style={{
              marginHorizontal: space[4],
              marginTop: space[4],
              padding: space[3],
              borderRadius: radius.md,
              backgroundColor: color.warningSoft,
              flexDirection: ROW,
              alignItems: 'center',
              gap: space[2],
            }}
          >
            <MaterialCommunityIcons name="clock-outline" size={18} color={palette.warning[700]} />
            <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
              {detail.is_open
                ? 'المطعم لا يستقبل طلبات حالياً. يمكنك تصفّح المنيو.'
                : 'المطعم مغلق الآن. يمكنك تصفّح المنيو والعودة لاحقاً.'}
            </Text>
          </View>
        ) : null}

        {shownCategories.length === 0 ? (
          <View style={{ padding: space[6], alignItems: 'center' }}>
            <Text tone="muted" align="center">
              لم يُضف المنيو بعد.
            </Text>
          </View>
        ) : (
          <>
            <CategoryTabs
              categories={shownCategories.map((category) => ({
                id: category.id,
                name: category.name_ar,
              }))}
              active={activeCategory ?? shownCategories[0]?.id ?? null}
              onSelect={jumpTo}
            />

            {shownCategories.map((category) => (
              <View
                key={category.id}
                onLayout={(event) => {
                  sectionTops.current[category.id] = event.nativeEvent.layout.y;
                }}
                style={{ paddingHorizontal: space[4], paddingTop: space[5] }}
              >
                <Text variant="h3">{category.name_ar}</Text>
                {category.description_ar ? (
                  <Text variant="caption" tone="muted">
                    {category.description_ar}
                  </Text>
                ) : null}

                <View style={{ gap: space[3], paddingTop: space[3] }}>
                  {category.items.map((item) => (
                    <MenuItemRow
                      key={item.id}
                      item={item}
                      disabled={!detail.orderable}
                      onPress={() => setOpenItem(item)}
                      onQuickAdd={() => quickAdd(item)}
                    />
                  ))}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/*
       * The cart bar rides above the content rather than living at the bottom
       * of the scroll: someone who has added three things and is still reading
       * the menu should not have to scroll to the end to find out what they
       * have.
       */}
      {itemCount > 0 && cartIsThisRestaurant ? (
        <CartBar count={itemCount} totalIqd={subtotalIqd} onPress={() => router.push('/cart')} />
      ) : null}

      <ItemSheet item={openItem} restaurant={detail} onClose={() => setOpenItem(null)} />
    </Screen>
  );
}

function Cover({
  coverUrl,
  onBack,
  restaurantId,
}: {
  coverUrl: string | null;
  onBack: () => void;
  restaurantId: string;
}) {
  return (
    <View style={{ height: 268, backgroundColor: color.surfaceSunken }}>
      {coverUrl ? (
        <Image
          source={{ uri: coverUrl }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : (
        /*
         * No photograph yet — which is the normal state for a restaurant on
         * the day it is approved. 224px of plain grey reads as a failed image;
         * the brand tint reads as one that was never uploaded.
         */
        <View
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name={missingImageGlyph()} size={56} color={accent[300]} />
        </View>
      )}

      {/*
       * A scrim under the controls, not a darker button.
       *
       * The back and favourite buttons sit on whatever photograph the
       * restaurant uploaded, and some of them are bright food shot on a white
       * plate. Making the buttons darker until they survive that is how a
       * control ends up looking heavy on every *other* photo; a short
       * top-down fade darkens only what is behind them and leaves the middle
       * of the image alone.
       *
       * `pointerEvents="none"` because a gradient laid over the cover would
       * otherwise swallow the taps meant for the buttons under it.
       */}
      <LinearGradient
        colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120 }}
        pointerEvents="none"
      />

      {/*
       * And a fade into the page at the bottom.
       *
       * The cover used to end on a hard horizontal line with the info card
       * butted against it, which reads as two screenshots stacked. The fade
       * hands the photograph over to the page instead.
       */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.25)']}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 96 }}
        pointerEvents="none"
      />

      <View
        style={{
          position: 'absolute',
          top: space[10],
          insetInlineStart: space[4],
          insetInlineEnd: space[4],
          // Back sits under the thumb on the right, where the chevron points.
          flexDirection: ROW,
          justifyContent: 'space-between',
        }}
      >
        <CircleButton label="رجوع" icon="chevron-right" onPress={onBack} />
        <FavoriteButton restaurantId={restaurantId} />
      </View>
    </View>
  );
}

/** A round control over the cover art, dark enough to read on any photograph. */
function CircleButton({
  label,
  icon,
  onPress,
  tint = palette.white,
}: {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          width: TAP_TARGET,
          height: TAP_TARGET,
          borderRadius: radius.full,
          backgroundColor: 'rgba(17,24,39,0.5)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={22} color={tint} />
    </Pressable>
  );
}

/**
 * The heart.
 *
 * Optimistic, because the answer is never in doubt and a heart that waits for
 * a round trip feels broken. A guest is sent to sign in instead: a favourite
 * has to belong to someone.
 */
function FavoriteButton({ restaurantId }: { restaurantId: string }) {
  const isGuest = useIsGuest();
  const router = useRouter();
  const queryClient = useQueryClient();

  const favorites = useQuery({
    queryKey: ['favorites'],
    queryFn: () => api.favorites(),
    enabled: !isGuest,
    staleTime: 60_000,
  });

  const isFavorite = (favorites.data ?? []).some((entry) => entry.id === restaurantId);

  const toggle = useMutation({
    mutationFn: () => (isFavorite ? api.unfavorite(restaurantId) : api.favorite(restaurantId)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['favorites'] }),
  });

  return (
    <CircleButton
      label={isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
      icon={isFavorite ? 'heart' : 'heart-outline'}
      tint={isFavorite ? palette.danger[500] : palette.white}
      onPress={() => {
        if (isGuest) {
          router.push('/(auth)/phone');
          return;
        }
        toggle.mutate();
      }}
    />
  );
}

function InfoCard({
  name,
  tags,
  logoUrl,
  rating,
  ratingCount,
  etaMinutes,
  deliveryFeeIqd,
  minimumOrderIqd,
  isOpen,
  orderable,
}: {
  name: string;
  tags: string;
  logoUrl: string | null;
  rating: number | null;
  ratingCount: number;
  etaMinutes: number;
  deliveryFeeIqd: number;
  minimumOrderIqd: number;
  isOpen: boolean;
  orderable: boolean;
}) {
  return (
    <View
      style={[
        {
          marginTop: -space[6],
          marginHorizontal: space[4],
          padding: space[4],
          backgroundColor: color.surfaceCard,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: color.borderSubtle,
          gap: space[3],
        },
        shadow.md,
      ]}
    >
      <Row gap={space[3]} align="flex-start">
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.lg,
            overflow: 'hidden',
            backgroundColor: color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {logoUrl ? (
            <Image
              source={{ uri: logoUrl }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            <Text variant="h2" tone="brand">
              {name.slice(0, 1)}
            </Text>
          )}
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="h3" numberOfLines={2}>
            {name}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {tags}
          </Text>
        </View>

        <RatingPill rating={rating} count={ratingCount > 0 ? ratingCount : undefined} />
      </Row>

      {/*
       * Open/closed is the server's answer, computed from the hours the
       * restaurant keeps in its own portal — not something this screen decides.
       */}
      <Row gap={space[2]}>
        <View
          style={{
            paddingHorizontal: space[2],
            paddingVertical: 3,
            borderRadius: radius.full,
            backgroundColor: orderable ? color.successSoft : color.surfaceSunken,
          }}
        >
          <Text variant="caption" tone={orderable ? 'success' : 'muted'}>
            {orderable ? 'مفتوح الآن' : isOpen ? 'لا يستقبل طلبات حالياً' : 'مغلق الآن'}
          </Text>
        </View>
      </Row>

      <Row
        justify="space-between"
        style={{ borderTopWidth: 1, borderTopColor: color.borderSubtle, paddingTop: space[3] }}
      >
        <Fact icon="clock-outline" label="يصل خلال" value={`${etaMinutes} دقيقة`} />
        <Fact
          icon="bike-fast"
          label="رسوم التوصيل"
          value={deliveryFeeIqd === 0 ? 'مجاناً' : formatIqdArabic(iqd(deliveryFeeIqd))}
        />
        <Fact
          icon="store-outline"
          label="أقل طلب"
          value={minimumOrderIqd === 0 ? 'لا يوجد' : formatIqdArabic(iqd(minimumOrderIqd))}
        />
      </Row>
    </View>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 2, flex: 1 }}>
      <MaterialCommunityIcons name={icon} size={18} color={color.brand} />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="caption" tone="primary">
        {value}
      </Text>
    </View>
  );
}

function CategoryTabs({
  categories,
  active,
  onSelect,
}: {
  categories: { id: string; name: string }[];
  active: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: space[4],
        paddingTop: space[4],
        gap: space[2],
      }}
    >
      {categories.map((category) => {
        const selected = active === category.id;
        return (
          <Pressable
            key={category.id}
            onPress={() => onSelect(category.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={category.name}
            style={{
              minHeight: TAP_TARGET - 8,
              paddingHorizontal: space[4],
              justifyContent: 'center',
              borderRadius: radius.full,
              backgroundColor: selected ? color.brand : color.surfaceCard,
              borderWidth: 1,
              borderColor: selected ? color.brand : color.borderSubtle,
            }}
          >
            <Text variant="smallBold" tone={selected ? 'inverse' : 'secondary'}>
              {category.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** The dish thumbnail in the menu list. See the note where it is used. */
const DISH_THUMB = 112;

/** The placeholder mark inside the sheet's 16:9 frame, when there is no photo. */
const SHEET_DISH = 132;

function MenuItemRow({
  item,
  disabled,
  onPress,
  onQuickAdd,
}: {
  item: MenuItem;
  disabled: boolean;
  onPress: () => void;
  /**
   * Add straight to the cart, skipping the sheet.
   *
   * Most dishes have no options at all — a salad, a bottle of water — and for
   * those the sheet opens, shows a price the row already showed, and closes.
   * The plus does the whole job in one tap.
   */
  onQuickAdd: () => void;
}) {
  const unavailable = disabled || !item.is_available;
  /*
   * The plus is only offered where it cannot produce a broken line.
   *
   * A dish with a required group has to go through the sheet; adding it
   * directly makes an order the kitchen cannot fill, which the server rejects
   * at the quote — after the customer has already filled a basket.
   */
  // With modifiers off there is nothing to choose, so every available dish
  // takes the one-tap path.
  const quickAddable = !unavailable && (!MODIFIERS_ENABLED || !item.requires_choice);

  /*
   * The card is a View, not a Pressable.
   *
   * The plus is its own control, and a button inside a button is invalid on
   * the web and ambiguous on a phone — whichever one wins the touch, the other
   * is unreachable. So the text area is the pressable that opens the dish, and
   * the plus sits beside it as a sibling.
   */
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
        opacity: unavailable ? 0.55 : 1,
      }}
    >
      <Pressable
        onPress={unavailable ? undefined : onPress}
        disabled={unavailable}
        accessibilityRole="button"
        accessibilityLabel={item.name_ar}
        accessibilityState={{ disabled: unavailable }}
        style={({ pressed }) => [{ flex: 1, gap: space[1] }, pressed ? { opacity: 0.7 } : null]}
      >
        <Row gap={space[2]}>
          <Text variant="bodyBold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {item.name_ar}
          </Text>
          {item.is_popular ? (
            <View
              style={{
                paddingHorizontal: space[2],
                paddingVertical: 1,
                borderRadius: radius.full,
                backgroundColor: color.warningSoft,
              }}
            >
              <Text variant="caption" style={{ color: palette.warning[700] }}>
                الأكثر طلباً
              </Text>
            </View>
          ) : null}
        </Row>

        {item.description_ar ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {item.description_ar}
          </Text>
        ) : null}

        <Row gap={space[2]}>
          <Text variant="smallBold" tone="brand">
            {formatIqdArabic(iqd(item.price_iqd))}
          </Text>
          {MODIFIERS_ENABLED && item.requires_choice && !unavailable ? (
            <Text variant="caption" tone="muted">
              · اختر الحجم
            </Text>
          ) : null}
        </Row>

        {!item.is_available ? (
          <Text variant="caption" tone="danger">
            غير متوفر حالياً
          </Text>
        ) : null}
      </Pressable>

      <View>
        <View
          style={{
            /*
             * 88 was too small to tell one dish from another at arm's length,
             * which is the only distance this list is ever read at. 112 is the
             * largest square that still leaves room for two lines of name, a
             * description and a price beside it on a 360dp screen.
             */
            width: DISH_THUMB,
            height: DISH_THUMB,
            borderRadius: radius.lg,
            overflow: 'hidden',
            backgroundColor: color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {item.image_asset_id ? (
            <Image
              source={{ uri: assetUrl(item.image_asset_id) }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            // Seeded by the item so a dish keeps its own plate between
            // renders, and a list of them does not read as one repeated mark.
            <DishPlaceholder size={DISH_THUMB} seed={item.id} />
          )}
        </View>

        {/*
         * The plus, over the corner of the picture.
         *
         * Its own Pressable rather than a control inside the row's: tapping
         * the row opens the dish, tapping the plus adds it, and nesting them
         * would make one swallow the other.
         */}
        {quickAddable ? (
          <Pressable
            onPress={onQuickAdd}
            accessibilityRole="button"
            accessibilityLabel={`إضافة ${item.name_ar} إلى السلة`}
            hitSlop={space[2]}
            style={({ pressed }) => [
              {
                position: 'absolute',
                bottom: -space[2],
                insetInlineStart: -space[2],
                width: 34,
                height: 34,
                borderRadius: radius.full,
                backgroundColor: color.brand,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: color.surfaceCard,
              },
              shadow.sm,
              pressed ? { opacity: 0.75 } : null,
            ]}
          >
            <MaterialCommunityIcons name="plus" size={20} color={palette.white} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The dish, opened.
 *
 * Options are fetched here rather than with the menu: most customers open two
 * or three dishes out of forty, and loading every modifier group for every
 * item would be most of the payload for none of the use.
 */
function ItemSheet({
  item,
  restaurant,
  onClose,
}: {
  item: MenuItem | null;
  restaurant: {
    id: string;
    branch_id: string;
    display_name: string;
    delivery_fee_iqd: number;
    minimum_order_iqd: number;
  };
  onClose: () => void;
}) {
  const { add } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});

  const groups = useQuery({
    queryKey: ['item-modifiers', item?.id],
    queryFn: () => api.itemModifiers(item?.id as string),
    // Not fetched at all when off: a request whose answer is discarded still
    // costs the customer a round trip on a phone connection.
    enabled: MODIFIERS_ENABLED && Boolean(item),
  });

  const groupList = groups.data ?? [];

  const unitPriceIqd = useMemo(() => {
    if (!item) return 0;
    const extras = groupList.flatMap((group) =>
      (chosen[group.id] ?? []).map(
        (id) => group.modifiers.find((modifier) => modifier.id === id)?.price_iqd ?? 0,
      ),
    );
    return item.price_iqd + extras.reduce((sum, price) => sum + price, 0);
  }, [item, groupList, chosen]);

  // A required group with nothing chosen is the one thing that must block the
  // button — the kitchen cannot guess which size was meant.
  const missing = groupList.filter(
    (group) => group.is_required && (chosen[group.id] ?? []).length < Math.max(1, group.min_select),
  );

  const reset = () => {
    setQuantity(1);
    setChosen({});
  };

  const toggle = (groupId: string, modifierId: string, maxSelect: number) => {
    setChosen((current) => {
      const picked = current[groupId] ?? [];
      if (picked.includes(modifierId)) {
        return { ...current, [groupId]: picked.filter((id) => id !== modifierId) };
      }
      // One choice replaces; many append up to the limit.
      if (maxSelect <= 1) return { ...current, [groupId]: [modifierId] };
      if (picked.length >= maxSelect) return current;
      return { ...current, [groupId]: [...picked, modifierId] };
    });
  };

  const submit = () => {
    if (!item || missing.length > 0) return;

    const optionNames = groupList
      .flatMap((group) =>
        (chosen[group.id] ?? []).map(
          (id) => group.modifiers.find((modifier) => modifier.id === id)?.name_ar ?? '',
        ),
      )
      .filter(Boolean);

    const result = add(
      {
        restaurantId: restaurant.id,
        branchId: restaurant.branch_id,
        restaurantName: restaurant.display_name,
        deliveryFeeIqd: restaurant.delivery_fee_iqd,
        minimumOrderIqd: restaurant.minimum_order_iqd,
      },
      {
        menuItemId: item.id,
        nameAr: item.name_ar,
        unitPriceIqd,
        quantity,
        imageAssetId: item.image_asset_id,
        notes: optionNames.length > 0 ? optionNames.join('، ') : null,
      },
    );

    if (result === 'replaced') {
      notify('تم تفريغ السلة', 'السلة تحتوي طلباً من مطعم آخر، وقد استبدلناها بهذا الطلب.');
    }

    reset();
    onClose();
  };

  return (
    <Sheet
      visible={Boolean(item)}
      onClose={() => {
        reset();
        onClose();
      }}
      title={item?.name_ar}
      footer={
        <Row justify="space-between" gap={space[3]}>
          <Stepper value={quantity} onChange={setQuantity} />
          <Button
            label={`إضافة — ${formatIqdArabic(iqd(unitPriceIqd * quantity))}`}
            onPress={submit}
            disabled={missing.length > 0}
            style={{ flex: 1 }}
          />
        </Row>
      }
    >
      {/*
       * The dish, at the size the decision is made at.
       *
       * This sheet is what opens when somebody taps a dish, and it showed the
       * name, the description and the price — everything except the thing being
       * bought. The customer had just tapped a 112px thumbnail to see it
       * larger and got a smaller view of it: no picture at all.
       *
       * 16:9 across the full width, so a plate shot fills it rather than
       * floating in a letterboxed box. The placeholder keeps the same frame,
       * seeded by the item, so a dish with no photograph is still a dish rather
       * than a gap.
       */}
      {item ? (
        <View
          style={{
            width: '100%',
            aspectRatio: 16 / 9,
            borderRadius: radius.lg,
            overflow: 'hidden',
            backgroundColor: color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {item.image_asset_id ? (
            <Image
              source={{ uri: assetUrl(item.image_asset_id) }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <DishPlaceholder size={SHEET_DISH} seed={item.id} />
          )}
        </View>
      ) : null}

      {item?.description_ar ? <Text tone="secondary">{item.description_ar}</Text> : null}

      {MODIFIERS_ENABLED && groups.isLoading ? <Skeleton height={64} /> : null}

      {groupList.map((group) => (
        <View key={group.id} style={{ gap: space[2] }}>
          <Row justify="space-between">
            <Text variant="bodyBold">{group.name_ar}</Text>
            <Text variant="caption" tone={group.is_required ? 'danger' : 'muted'}>
              {group.is_required
                ? 'مطلوب'
                : group.max_select > 1
                  ? `اختر حتى ${group.max_select}`
                  : 'اختياري'}
            </Text>
          </Row>

          {group.modifiers.map((modifier) => {
            const picked = (chosen[group.id] ?? []).includes(modifier.id);

            return (
              <Pressable
                key={modifier.id}
                onPress={() =>
                  modifier.is_available && toggle(group.id, modifier.id, group.max_select)
                }
                disabled={!modifier.is_available}
                accessibilityRole={group.max_select > 1 ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: picked, disabled: !modifier.is_available }}
                accessibilityLabel={modifier.name_ar}
                style={{
                  minHeight: TAP_TARGET,
                  paddingHorizontal: space[3],
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: picked ? color.brand : color.borderSubtle,
                  backgroundColor: picked ? color.brandSoft : color.surfaceCard,
                  justifyContent: 'center',
                  opacity: modifier.is_available ? 1 : 0.5,
                }}
              >
                <Row justify="space-between">
                  <Text variant={picked ? 'smallBold' : 'small'}>{modifier.name_ar}</Text>
                  <Text variant="caption" tone={picked ? 'brand' : 'muted'}>
                    {modifier.price_iqd > 0 ? `+ ${formatIqdArabic(iqd(modifier.price_iqd))}` : '—'}
                  </Text>
                </Row>
              </Pressable>
            );
          })}
        </View>
      ))}
    </Sheet>
  );
}
