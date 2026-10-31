import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MaterialCommunityIcons from '@/ui/icon';
import { LinearGradient } from 'expo-linear-gradient';
import { DishPlaceholder } from '@/ui/dish-placeholder';
import { arabicCuisineTags } from '@/lib/cuisine-tags';
import { formatIqdArabic, iqd } from '@jibli/money';
import { useServiceFee } from '@/lib/use-service-fee';
import { customerDeliveryFee } from '@/lib/delivery-fee';
import { api, ApiError, assetUrl, type MenuItem } from '@/lib/api';
import { countAr, MINUTES } from '@/lib/arabic-count';
import { MODIFIERS_ENABLED } from '@/lib/menu-options';
import { useCart, type Cart, type CartLine } from '@/lib/cart';
import {
  continueAfterSignIn,
  rememberFavoriteIntent,
  takeFavoriteIntent,
} from '@/lib/after-sign-in';
import { useIsGuest, useMe } from '@/lib/session';
import { useVertical } from '@/lib/vertical';
import { confirmAsync } from '@/lib/dialog';
import { ROW, TAP_TARGET, accent, color, palette, radius, shadow, space } from '@/theme';
import { missingImageGlyph } from '@/ui/section-glyph';
import { Button, ErrorState, HScroll, RemoteImage, Row, Screen, Skeleton, Text } from '@/ui';
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
export default function RestaurantScreen() {
  const { id, item: itemToOpen } = useLocalSearchParams<{ id: string; item?: string }>();
  const router = useRouter();
  /*
   * The page draws in whichever section the customer is browsing, and a
   * market or a cosmetics shop is a shop with products — not a restaurant
   * with a menu. The nouns follow the section.
   */
  const { vertical } = useVertical();
  const isShop = vertical === 'MARKET' || vertical === 'COSMETICS';
  const place = isShop ? 'المتجر' : 'المطعم';
  const menuNoun = isShop ? 'المنتجات' : 'المنيو';
  const { cart, itemCount, subtotalIqd } = useCart();
  const serviceFee = useServiceFee();

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  /** The main section showing, when the menu has them («الأطعمة»…). */
  const [activeSection, setActiveSection] = useState<string | null>(null);
  /** Where the tabs begin in the scroll, so a section change can return to them. */
  const menuTop = useRef<number | null>(null);
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
   * Add a line, asking first when it would empty another shop's cart.
   *
   * The cart holds one shop at a time, and adding from a second used to wipe the
   * first with only an after-the-fact «تم تفريغ السلة» — no way to keep it
   * (CUST-8). Now the customer is asked before anything is lost, with the two
   * shop names and the section's own noun.
   */
  const addToCart = async (meta: Omit<Cart, 'lines'>, line: Omit<CartLine, 'key'>) => {
    if (cart && cart.restaurantId !== meta.restaurantId) {
      const yes = await confirmAsync({
        title: 'بدء سلة جديدة؟',
        message: `سلتك فيها طلب من «${cart.restaurantName}». إذا أضفت من «${meta.restaurantName}» سنفرّغها.`,
        confirmLabel: 'تفريغ وإضافة',
        cancelLabel: 'إبقاء سلتي',
      });
      if (!yes) return;
    }
    add(meta, line);
  };

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

    void addToCart(
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
  };

  const categories = restaurant.data?.categories ?? [];
  const shownCategories = useMemo(
    () => categories.filter((category) => category.items.length > 0),
    [categories],
  );

  /*
   * The menu's main sections, in the order their first category appears.
   *
   * A shop that has named sections gets two levels: a bar of a few big tabs
   * — «الأطعمة / المشروبات / الحلويات» — and, under the one chosen, the
   * categories in it. Twenty small chips in one strip was the alternative,
   * and nobody could read it. A category the shop left without a section
   * goes under «أخرى» rather than disappearing. A menu with no sections at all
   * is flat, exactly as before.
   */
  const sections = useMemo(() => {
    if (!shownCategories.some((category) => category.section_ar)) return [];
    const names: string[] = [];
    for (const category of shownCategories) {
      const name = category.section_ar || OTHER_SECTION;
      if (!names.includes(name)) names.push(name);
    }
    return names;
  }, [shownCategories]);

  const currentSection =
    activeSection && sections.includes(activeSection) ? activeSection : (sections[0] ?? null);
  const visibleCategories = currentSection
    ? shownCategories.filter(
        (category) => (category.section_ar || OTHER_SECTION) === currentSection,
      )
    : shownCategories;

  const chooseSection = (name: string) => {
    if (name === currentSection) return;
    setActiveSection(name);
    setActiveCategory(null);
    // The categories below are about to be a different list; positions
    // measured for the old one would send a tap to the wrong place.
    sectionTops.current = {};
    if (menuTop.current !== null) {
      scroller.current?.scrollTo({ y: Math.max(0, menuTop.current - space[2]), animated: true });
    }
  };

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
            restaurant.error instanceof ApiError
              ? restaurant.error.messageAr
              : `تعذّر تحميل ${place}`
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
          description={detail.description_ar}
          tags={arabicCuisineTags(detail.cuisine_tags).join('، ') || detail.city_name_ar}
          logoUrl={detail.logo_asset_id ? assetUrl(detail.logo_asset_id) : null}
          rating={detail.rating}
          ratingCount={detail.rating_count}
          etaMinutes={detail.estimated_preparation_minutes}
          deliveryFeeIqd={customerDeliveryFee(detail.delivery_fee_iqd, serviceFee)}
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
                ? `${place} لا يستقبل طلبات حالياً. يمكنك تصفّح ${menuNoun}.`
                : `${place} مغلق الآن. يمكنك تصفّح ${menuNoun} والعودة لاحقاً.`}
            </Text>
          </View>
        ) : null}

        {shownCategories.length === 0 ? (
          <View style={{ padding: space[6], alignItems: 'center' }}>
            <Text tone="muted" align="center">
              لم تُضف {menuNoun} بعد.
            </Text>
          </View>
        ) : (
          <>
            <View
              onLayout={(event) => {
                menuTop.current = event.nativeEvent.layout.y;
              }}
            >
              {sections.length > 0 && currentSection ? (
                <SectionTabs
                  sections={sections}
                  active={currentSection}
                  onSelect={chooseSection}
                />
              ) : null}
              <CategoryTabs
                categories={visibleCategories.map((category) => ({
                  id: category.id,
                  name: category.name_ar,
                }))}
                active={
                  activeCategory && visibleCategories.some((c) => c.id === activeCategory)
                    ? activeCategory
                    : (visibleCategories[0]?.id ?? null)
                }
                onSelect={jumpTo}
              />
            </View>

            {visibleCategories.map((category) => (
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

      <ItemSheet
        item={openItem}
        restaurant={detail}
        onClose={() => setOpenItem(null)}
        /*
         * Adding is handled on the screen, not in the sheet: a cross-shop
         * confirm is a dialog, and iOS will not present one over the sheet's own
         * Modal. The sheet closes itself first and hands the line up, so the
         * confirm (when needed) draws on the screen underneath (CUST-8).
         */
        onAdd={(meta, line) => void addToCart(meta, line)}
      />
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
        <RemoteImage uri={coverUrl} style={{ width: '100%', height: '100%' }} priority="high" />
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
          // Equal insets, so physical sides are unambiguous in either mode.
          left: space[4],
          right: space[4],
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
    queryKey: ['favorites', useMe()?.user_id ?? null],
    queryFn: () => api.favorites(),
    enabled: !isGuest,
    staleTime: 60_000,
  });

  const isFavorite = (favorites.data ?? []).some((entry) => entry.id === restaurantId);

  const toggle = useMutation({
    mutationFn: () => (isFavorite ? api.unfavorite(restaurantId) : api.favorite(restaurantId)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['favorites'] }),
  });

  const favorite = useMutation({
    mutationFn: () => api.favorite(restaurantId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['favorites'] }),
  });

  /*
   * Finish the favourite the guest asked for before signing in (CUST-10): the
   * heart sent them to sign in and `continueAfterSignIn` brought them back to
   * this shop, so once they are signed in the remembered intent is honoured.
   */
  useEffect(() => {
    if (!isGuest && takeFavoriteIntent(restaurantId) && !isFavorite) favorite.mutate();
  }, [isGuest, restaurantId, isFavorite, favorite]);

  return (
    <CircleButton
      label={isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
      icon={isFavorite ? 'heart' : 'heart-outline'}
      tint={isFavorite ? palette.danger[500] : palette.white}
      onPress={() => {
        if (isGuest) {
          // Remember the shop and come back to it signed in, rather than landing
          // on the home screen with nothing favourited (CUST-10).
          rememberFavoriteIntent(restaurantId);
          continueAfterSignIn(`/restaurant/${restaurantId}`);
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
  description,
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
  description: string | null;
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
            <RemoteImage uri={logoUrl} style={{ width: '100%', height: '100%' }} />
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
       * The shop's own line, under the name — both the portal and the app's
       * owner mode promise the customer reads it, and nothing used to show it
       * (MERCH-19).
       */}
      {description ? (
        <Text variant="small" tone="secondary">
          {description}
        </Text>
      ) : null}

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
        <Fact icon="clock-outline" label="التحضير" value={countAr(etaMinutes, MINUTES)} />
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

/** The heading for categories a sectioned menu left without a section. */
const OTHER_SECTION = 'أخرى';

/**
 * The menu's main sections: a few large tabs, one per section.
 *
 * Laid out across the full width when they fit — three or four words, each
 * a clear target — and scrolling only past that. The selected one is filled;
 * the rest are outlined, so which half of the menu is showing is never in
 * doubt.
 */
function SectionTabs({
  sections,
  active,
  onSelect,
}: {
  sections: string[];
  active: string;
  onSelect: (name: string) => void;
}) {
  const tabs = sections.map((name) => {
    const selected = name === active;
    return (
      <Pressable
        key={name}
        onPress={() => onSelect(name)}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={name}
        style={{
          flexGrow: 1,
          minHeight: TAP_TARGET + 4,
          paddingHorizontal: space[5],
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.xl,
          backgroundColor: selected ? color.brand : color.surfaceCard,
          borderWidth: 1.5,
          borderColor: selected ? color.brand : color.borderSubtle,
        }}
      >
        <Text variant="h3" align="center" tone={selected ? 'inverse' : 'primary'}>
          {name}
        </Text>
      </Pressable>
    );
  });

  if (sections.length <= 4) {
    return (
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: ROW,
          gap: space[2],
          paddingHorizontal: space[4],
          paddingTop: space[5],
        }}
      >
        {tabs}
      </View>
    );
  }

  return (
    <HScroll contentContainerStyle={{ paddingHorizontal: space[4], paddingTop: space[5], gap: space[2] }}>
      {tabs}
    </HScroll>
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
    <HScroll
      contentContainerStyle={{
        paddingHorizontal: space[4],
        paddingTop: space[3],
        paddingBottom: space[1],
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
              minHeight: TAP_TARGET,
              paddingHorizontal: space[5],
              justifyContent: 'center',
              borderRadius: radius.full,
              backgroundColor: selected ? color.brand : color.surfaceCard,
              borderWidth: 1,
              borderColor: selected ? color.brand : color.borderSubtle,
            }}
          >
            <Text variant="bodyBold" tone={selected ? 'inverse' : 'primary'}>
              {category.name}
            </Text>
          </Pressable>
        );
      })}
    </HScroll>
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
   * A required-choice dish with modifiers off is a dead end.
   *
   * There is no way to pick the size or bread the kitchen needs, so adding it
   * made a line the quote refuses (MODIFIER_SELECTION_INVALID) — discovered at
   * checkout, over a whole basket. Until the sheet can collect the choice, the
   * dish is shown as «يتوفر قريباً»: inert, and never one tap from a broken
   * order (CUST-2).
   */
  const choiceBlocked = item.requires_choice && !MODIFIERS_ENABLED;
  const inert = unavailable || choiceBlocked;
  /*
   * The plus is only offered where it cannot produce a broken line. A
   * required-choice dish always goes through the sheet (never the plus), and
   * while modifiers are off it has no path at all.
   */
  const quickAddable = !inert && !item.requires_choice;

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
        flexDirection: ROW,
        gap: space[3],
        padding: space[3],
        backgroundColor: color.surfaceCard,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.borderSubtle,
        opacity: inert ? 0.55 : 1,
      }}
    >
      <Pressable
        onPress={inert ? undefined : onPress}
        disabled={inert}
        accessibilityRole="button"
        accessibilityLabel={item.name_ar}
        accessibilityState={{ disabled: inert }}
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
        ) : choiceBlocked ? (
          <Text variant="caption" tone="muted">
            يتوفر قريباً
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
            <RemoteImage
              uri={assetUrl(item.image_asset_id)}
              style={{ width: '100%', height: '100%' }}
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
                right: -space[2],
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
  onAdd,
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
  /** The screen adds the line (and runs any cross-shop confirm) once closed. */
  onAdd: (meta: Omit<Cart, 'lines'>, line: Omit<CartLine, 'key'>) => void;
}) {
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

    const meta = {
      restaurantId: restaurant.id,
      branchId: restaurant.branch_id,
      restaurantName: restaurant.display_name,
      deliveryFeeIqd: restaurant.delivery_fee_iqd,
      minimumOrderIqd: restaurant.minimum_order_iqd,
    };
    const line = {
      menuItemId: item.id,
      nameAr: item.name_ar,
      unitPriceIqd,
      quantity,
      imageAssetId: item.image_asset_id,
      notes: optionNames.length > 0 ? optionNames.join('، ') : null,
    };

    reset();
    // Closed first, then handed up: a cross-shop confirm cannot draw over this
    // sheet's own Modal, so the screen adds the line once the sheet is gone.
    onClose();
    onAdd(meta, line);
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
            style={{ flex: 1, alignSelf: 'center' }}
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
            <RemoteImage
              uri={assetUrl(item.image_asset_id)}
              style={{ width: '100%', height: '100%' }}
              priority="high"
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
