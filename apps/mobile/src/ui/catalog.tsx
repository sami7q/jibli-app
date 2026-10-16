import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@/ui/icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatIqdArabic, iqd } from '@jibli/money';
import { countAr, ITEMS, MINUTES } from '@/lib/arabic-count';
import {
  ALIGN_START,
  INPUT_TEXT_START,
  ROW,
  TAP_TARGET,
  TEXT_START,
  accent,
  color,
  palette,
  radius,
  shadow,
  space,
  text,
} from '@/theme';
import { missingImageGlyph } from '@/ui/section-glyph';
import { RemoteImage, Row, Text } from './index';

/**
 * The components the design comps need, beyond the primitives.
 *
 * Read off `jibli_1/` rather than invented: every size, radius and tint here
 * appears in at least one comp. Where the comps disagreed — seven oranges
 * between them — the reconciliation is in
 * `docs/design/mobile-design-system.md` §2, and these read the reconciled
 * token rather than any single comp's value.
 *
 * Same two rules as the primitives: direction comes from a pinned token
 * rather than from the device's flag — and where a position has to name a
 * side, it names a physical one — and nothing pressable is smaller than the
 * tap target.
 */

// ── IconTile ────────────────────────────────────────────────────────────────

/**
 * The rounded square behind an icon, a category picture, or an initial.
 *
 * Three sizes because the comps use three: 40 in the header, 56 in an account
 * row, 64 in the category strip. `active` is the solid-brand state the current
 * category uses.
 */
export function IconTile({
  children,
  size = 40,
  active = false,
  tone = 'brand',
  style,
}: {
  children: ReactNode;
  size?: 40 | 56 | 64;
  active?: boolean;
  tone?: 'brand' | 'neutral';
  style?: StyleProp<ViewStyle>;
}) {
  const surface = active ? color.brand : tone === 'brand' ? color.brandSoft : color.surfaceSunken;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.lg,
          backgroundColor: surface,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderWidth: active ? 0 : 1,
          borderColor: tone === 'brand' ? accent[100] : color.borderSubtle,
        },
        active ? shadow.sm : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Arabic that starts where Arabic starts.
 *
 * It says the edge outright rather than leaving it to the bidi algorithm,
 * which reads the first strong character and therefore sends a line opening
 * with a price or an order number to the left.
 *
 * A getter, not a literal: `TEXT_START` is set from the measured layout
 * direction after this module has loaded, and on Android the word that means
 * "the right edge" differs between a mirrored and an unmirrored layout. A
 * frozen `'right'` here put every account row's label on the left in the
 * builds where the native layer mirrors. Read at render, it follows the
 * theme.
 */
export const RTL_TEXT: TextStyle = {
  get textAlign() {
    return TEXT_START;
  },
  writingDirection: 'rtl',
};

// ── SearchBar ───────────────────────────────────────────────────────────────

export function SearchBar({
  onFilterPress,
  style,
  ...props
  // `Omit` because TextInputProps carries its own `style`, a TextStyle for the
  // field. The one here dresses the container around it, and an intersection of
  // the two is a type nothing can satisfy.
}: Omit<TextInputProps, 'style'> & { onFilterPress?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Row
      gap={space[2]}
      style={[
        {
          backgroundColor: color.surfaceCard,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: color.borderSubtle,
          paddingHorizontal: space[3],
          minHeight: TAP_TARGET + 4,
        },
        shadow.sm,
        style,
      ]}
    >
      <MaterialCommunityIcons name="magnify" size={20} color={color.textMuted} />
      <TextInput
        placeholderTextColor={palette.ink[400]}
        style={[
          text.small,
          {
            flex: 1,
            color: color.textPrimary,
            paddingVertical: space[2],
            // An input: physical on every platform, unlike a `Text`.
            textAlign: INPUT_TEXT_START,
          },
        ]}
        {...props}
      />
      {onFilterPress ? (
        <Pressable
          onPress={onFilterPress}
          accessibilityRole="button"
          accessibilityLabel="تصفية"
          hitSlop={space[2]}
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.md,
            backgroundColor: color.surfaceSunken,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="tune-variant" size={18} color={color.textSecondary} />
        </Pressable>
      ) : null}
    </Row>
  );
}

// ── RatingPill ──────────────────────────────────────────────────────────────

/** The amber star chip. Shows «جديد» rather than a fake zero when unrated. */
export function RatingPill({ rating, count }: { rating: number | null; count?: number }) {
  if (rating === null) {
    return (
      <View style={pill(color.surfaceSunken, color.borderSubtle)}>
        <Text variant="caption" tone="muted">
          جديد
        </Text>
      </View>
    );
  }

  return (
    <View style={[pill(palette.warning[50], palette.warning[500]), { flexDirection: ROW, gap: 3 }]}>
      <MaterialCommunityIcons name="star" size={13} color={palette.warning[500]} />
      <Text variant="caption" style={{ color: palette.warning[700] }}>
        {rating.toFixed(1)}
        {count === undefined ? '' : ` (${count})`}
      </Text>
    </View>
  );
}

function pill(background: string, border: string): ViewStyle {
  return {
    backgroundColor: background,
    borderWidth: 1,
    borderColor: border,
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radius.md,
    // Vertical, not horizontal: every pill sits inside a row, and a row's
    // cross axis does not mirror.
    alignSelf: 'flex-start',
    alignItems: 'center',
  };
}

// ── Stepper ─────────────────────────────────────────────────────────────────

/**
 * Quantity control.
 *
 * Each control is a full tap target even though the comp draws them smaller:
 * a 28px minus button next to a 28px plus button is how someone removes an
 * item they meant to add one of.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}) {
  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) onChange(next);
  };

  return (
    <Row
      gap={0}
      style={{
        backgroundColor: color.surfaceSunken,
        borderRadius: radius.md,
        overflow: 'hidden',
      }}
    >
      <StepperButton
        icon="minus"
        accessibilityLabel="إنقاص"
        disabled={value <= min}
        onPress={() => step(-1)}
      />
      <View style={{ minWidth: 36, alignItems: 'center' }}>
        <Text variant="bodyBold">{value}</Text>
      </View>
      <StepperButton
        icon="plus"
        accessibilityLabel="زيادة"
        disabled={value >= max}
        onPress={() => step(1)}
      />
    </Row>
  );
}

function StepperButton({
  icon,
  accessibilityLabel,
  onPress,
  disabled,
}: {
  icon: 'minus' | 'plus';
  accessibilityLabel: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        {
          width: TAP_TARGET,
          height: TAP_TARGET,
          alignItems: 'center',
          justifyContent: 'center',
        },
        pressed ? { opacity: 0.6 } : null,
        disabled ? { opacity: 0.3 } : null,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={20} color={color.brand} />
    </Pressable>
  );
}

// ── SummaryRow ──────────────────────────────────────────────────────────────

/** A label/value line in a cart or checkout summary. */
export function SummaryRow({
  label,
  value,
  emphasis = false,
  tone,
}: {
  label: string;
  value: string;
  /** The final line: heavier, and it gets the rule above it. */
  emphasis?: boolean;
  tone?: 'success' | 'muted';
}) {
  return (
    <Row
      justify="space-between"
      style={
        emphasis
          ? {
              borderTopWidth: 1,
              borderTopColor: color.borderSubtle,
              paddingTop: space[3],
              marginTop: space[1],
            }
          : undefined
      }
    >
      <Text variant={emphasis ? 'bodyBold' : 'small'} tone={emphasis ? 'primary' : 'muted'}>
        {label}
      </Text>
      <Text variant={emphasis ? 'h3' : 'smallBold'} tone={emphasis ? 'brand' : (tone ?? 'primary')}>
        {value}
      </Text>
    </Row>
  );
}

// ── ListRow ─────────────────────────────────────────────────────────────────

/**
 * The account screen's row: tile, label, chevron.
 *
 * It used to take an `rtl` flag, because for one release the account screen
 * was the only right-to-left screen in the app and turning the rest over was a
 * decision nobody had made yet. That decision has been made — the whole app
 * reads right-to-left now — so the flag is gone rather than left behind as a
 * prop every call site would have to remember to pass.
 */
export function ListRow({
  label,
  sublabel,
  icon,
  badge,
  onPress,
  destructive = false,
}: {
  label: string;
  sublabel?: string;
  icon?: ReactNode;
  badge?: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          flexDirection: ROW,
          alignItems: 'center',
          gap: space[3],
          minHeight: TAP_TARGET + 8,
          paddingHorizontal: space[3],
          // Air above and below the tile, so a two-line sublabel never
          // touches the rule between rows.
          paddingVertical: space[2],
          borderRadius: radius.md,
        },
        pressed ? { backgroundColor: color.surfaceSunken } : null,
      ]}
    >
      {icon ? (
        <IconTile size={40} tone={destructive ? 'neutral' : 'brand'}>
          {icon}
        </IconTile>
      ) : null}

      <View style={{ flex: 1 }}>
        <Text variant="bodyBold" tone={destructive ? 'danger' : 'primary'} style={RTL_TEXT}>
          {label}
        </Text>
        {sublabel ? (
          <Text variant="caption" tone="muted" style={RTL_TEXT}>
            {sublabel}
          </Text>
        ) : null}
      </View>

      {badge ? (
        <View
          style={{
            backgroundColor: color.brand,
            borderRadius: radius.full,
            paddingHorizontal: space[2],
            paddingVertical: 2,
          }}
        >
          <Text variant="caption" tone="inverse">
            {badge}
          </Text>
        </View>
      ) : null}

      {/*
       * `chevron-left` is correct under RTL: the row opens a screen that
       * slides in from the start edge, which is the left here.
       */}
      <MaterialCommunityIcons name="chevron-left" size={22} color={color.textMuted} />
    </Pressable>
  );
}

// ── StatusTimeline ──────────────────────────────────────────────────────────

export interface TimelineStep {
  readonly label: string;
  readonly at: string | null;
  readonly state: 'done' | 'current' | 'pending';
}

/**
 * The order's progress as a vertical rail.
 *
 * The rail is drawn per step rather than as one line behind them, so a step
 * that is still pending gets a grey segment and a completed one an orange
 * segment — which is what makes the progress readable at a glance instead of
 * needing the dots to be counted.
 */
export function StatusTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <View>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const on = step.state !== 'pending';

        return (
          <Row key={step.label} align="stretch" gap={space[3]}>
            <View style={{ alignItems: 'center', width: 20 }}>
              <View
                style={{
                  width: step.state === 'current' ? 14 : 10,
                  height: step.state === 'current' ? 14 : 10,
                  borderRadius: radius.full,
                  backgroundColor: on ? color.brand : color.borderStrong,
                  marginTop: 4,
                  ...(step.state === 'current'
                    ? { borderWidth: 3, borderColor: color.brandSoft }
                    : {}),
                }}
              />
              {!last ? (
                <View
                  style={{
                    flex: 1,
                    width: 2,
                    minHeight: space[6],
                    backgroundColor: step.state === 'done' ? color.brand : color.borderSubtle,
                  }}
                />
              ) : null}
            </View>

            <View style={{ flex: 1, paddingBottom: last ? 0 : space[4] }}>
              <Text
                variant={step.state === 'current' ? 'bodyBold' : 'body'}
                tone={on ? 'primary' : 'muted'}
              >
                {step.label}
              </Text>
              {step.at ? (
                <Text variant="caption" tone="muted">
                  {step.at}
                </Text>
              ) : null}
            </View>
          </Row>
        );
      })}
    </View>
  );
}

// ── DriverCard ──────────────────────────────────────────────────────────────

export function DriverCard({
  name,
  phone,
  onCall,
  etaMinutes,
}: {
  name: string;
  phone?: string | null;
  onCall?: () => void;
  etaMinutes?: number | null;
}) {
  return (
    <Row
      gap={space[3]}
      style={{
        backgroundColor: color.surfaceCard,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.borderSubtle,
        padding: space[3],
      }}
    >
      <IconTile size={56}>
        <Text variant="h2" tone="brand">
          {name.slice(0, 1)}
        </Text>
      </IconTile>

      <View style={{ flex: 1 }}>
        <Text variant="bodyBold">{name}</Text>
        <Text variant="caption" tone="muted">
          مندوب التوصيل
          {etaMinutes ? ` · الوصول خلال ${countAr(etaMinutes, MINUTES)}` : ''}
        </Text>
      </View>

      {onCall && phone ? (
        <Pressable
          onPress={onCall}
          accessibilityRole="button"
          accessibilityLabel={`اتصال بـ ${name}`}
          style={{
            width: TAP_TARGET,
            height: TAP_TARGET,
            borderRadius: radius.full,
            backgroundColor: color.successSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="phone" size={20} color={color.successStrong} />
        </Pressable>
      ) : null}
    </Row>
  );
}

// ── PromoBanner ─────────────────────────────────────────────────────────────

/**
 * One slide of the home carousel.
 *
 * Everything about it — the art, the words, the ordering, how long it holds
 * before the next — is set in Admin → شكل التطبيق and arrives from
 * `GET /storefront`. Nothing here is a constant in the app, because a release
 * takes a week to reach every phone through two review queues and a Ramadan
 * banner cannot wait for one.
 */
export function PromoBanner({
  title,
  subtitle,
  badge,
  ctaLabel,
  imageUrl,
  onPress,
  fullBleed = false,
}: {
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  ctaLabel?: string | null;
  imageUrl?: string | null;
  onPress?: () => void;
  /**
   * Edge to edge, with no corners.
   *
   * The home carousel uses this: a paid slot inset by the page gutter looks
   * smaller than the free content under it, and a rounded rectangle touching
   * both screen edges reads as a mistake rather than a decision. Taller too —
   * an advertisement needs room for a picture and a sentence.
   */
  fullBleed?: boolean;
}) {
  /*
   * A banner with artwork is the artwork, and nothing else.
   *
   * These are designed images: the one on the home screen already says «في
   * غضون ٢٠ دقيقة» in its own typography, over its own photograph, arranged by
   * whoever made it. Drawing the stored title on top of that produces two
   * headlines fighting for the same corner — and the stored title is usually
   * not a headline at all but a label the operator typed to find the row again
   * in Admin. It stays exactly where it is useful: naming the banner in the
   * portal, and read aloud as this control's accessibility label.
   *
   * Without artwork there is nothing else to look at, so the orange card with
   * its words is the whole design and is unchanged.
   */
  const artworkSpeaksForItself = Boolean(imageUrl);

  const body = (
    <View
      style={{
        /*
         * A ratio, not a height — for the full-bleed slot at least.
         *
         * It was 200px on every phone, so the same artwork was cropped
         * differently on each one: 1.88:1 on an SE, 2.15:1 on a Pro Max. A
         * designer exports one image and it lost a different slice of itself
         * per device, which is the kind of thing that only shows up once
         * somebody puts two phones side by side.
         *
         * Sixteen-to-nine because that is what the artwork is exported at.
         * It was briefly 3:2 to give the slot more height, which was the wrong
         * trade the moment real banners arrived: a ratio that does not match
         * the file crops somebody's design, and the fix for a slot that feels
         * small is a better image, not a different crop of it.
         *
         * The inset variant keeps its fixed height: it is a card in a column
         * of cards, and matching its neighbours matters more there than
         * matching itself across devices.
         */
        ...(fullBleed ? { aspectRatio: 16 / 9 } : { height: 164 }),
        /*
         * Inset and rounded, even full-bleed.
         *
         * It ran to both edges with square corners, which reads as a strip
         * pasted across the screen rather than as the one paid placement on
         * it. Drawing it as a card — deep corners, a real shadow — gives the
         * artwork a frame and gives the screen a top edge that is not a hard
         * line. 26 matches the header's own corner, so the two curves rhyme
         * down the page instead of arguing.
         */
        borderRadius: fullBleed ? 26 : radius['2xl'],
        overflow: 'hidden',
        backgroundColor: color.brand,
      }}
    >
      {imageUrl ? (
        <RemoteImage
          uri={imageUrl}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
          priority="high"
        />
      ) : null}

      {artworkSpeaksForItself ? null : (
        <>
          {/*
           * The scrim and the words are one thing, so they live or die
           * together. It exists to make text readable and for no other reason
           * — over artwork with nothing written on it, it is a stain on
           * somebody's design. Here it is the background itself rather than a
           * veil over one, and it runs from the start side outward because
           * that is where the words are: under RTL the start side is the
           * right, which is why the stops read `x: 1 → 0`.
           */}
          <LinearGradient
            colors={[accent[600], accent[500], accent[400]]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{ position: 'absolute', width: '100%', height: '100%' }}
          />

          <View
            style={{
              flex: 1,
              paddingHorizontal: fullBleed ? space[5] : space[4],
              paddingVertical: space[4],
              gap: space[1],
              justifyContent: 'center',
            }}
          >
            {badge ? (
              <View
                style={{
                  alignSelf: ALIGN_START,
                  backgroundColor: 'rgba(255,255,255,0.22)',
                  borderRadius: radius.full,
                  paddingHorizontal: space[2],
                  paddingVertical: 3,
                }}
              >
                <Text variant="caption" tone="inverse">
                  {badge}
                </Text>
              </View>
            ) : null}

            <Text variant="h2" tone="inverse" numberOfLines={2} style={{ maxWidth: '70%' }}>
              {title}
            </Text>

            {subtitle ? (
              <Text variant="small" tone="inverse" numberOfLines={2} style={{ maxWidth: '70%' }}>
                {subtitle}
              </Text>
            ) : null}

            {ctaLabel ? (
              <View
                style={{
                  alignSelf: ALIGN_START,
                  marginTop: space[2],
                  backgroundColor: color.surfaceCard,
                  borderRadius: radius.full,
                  paddingHorizontal: space[4],
                  paddingVertical: space[2],
                }}
              >
                <Text variant="smallBold" tone="brand">
                  {ctaLabel}
                </Text>
              </View>
            ) : null}
          </View>
        </>
      )}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => (pressed ? { opacity: 0.92 } : null)}
    >
      {body}
    </Pressable>
  );
}

/**
 * The floating cart bar.
 *
 * Lived inside the restaurant screen, which is why adding a dish from the home
 * search — the other place the app offers a «+» — produced no visible cart at
 * all: the item went in and the screen said nothing. Shared now, so the two
 * places that can add both show the same thing.
 *
 * `bottom` is the caller's, because what sits under it differs: a tab bar on
 * the home screen, nothing on a restaurant page.
 */
export function CartBar({
  count,
  totalIqd,
  onPress,
  bottom = space[6],
}: {
  count: number;
  totalIqd: number;
  onPress: () => void;
  bottom?: number;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        bottom,
        // Equal insets, so physical sides are unambiguous in either direction.
        left: space[4],
        right: space[4],
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`عرض السلة، ${countAr(count, ITEMS)}`}
        style={({ pressed }) => [
          {
            minHeight: TAP_TARGET + 8,
            borderRadius: radius.full,
            backgroundColor: color.brand,
            paddingHorizontal: space[4],
            flexDirection: ROW,
            alignItems: 'center',
            justifyContent: 'space-between',
          },
          shadow.lg,
          pressed ? { opacity: 0.9 } : null,
        ]}
      >
        <Row gap={space[2]}>
          <MaterialCommunityIcons name="cart-outline" size={20} color={palette.white} />
          <Text variant="smallBold" tone="inverse">
            {countAr(count, ITEMS)}
          </Text>
        </Row>
        <Text variant="bodyBold" tone="inverse">
          {formatIqdArabic(iqd(totalIqd))}
        </Text>
      </Pressable>
    </View>
  );
}

// ── Sheet ───────────────────────────────────────────────────────────────────

/**
 * The bottom sheet the menu-item modifiers open in.
 *
 * Deliberately a plain `Modal` rather than a gesture library: it needs to
 * appear, take a choice and close, and the two things that actually matter for
 * that — the hardware back button on Android and the home-indicator inset on
 * iOS — are handled here. A drag-to-dismiss gesture can be added when a screen
 * needs one; it is not what makes this usable.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Android's back button. Without this the sheet is dismissible only by
      // the button we drew, which is not how the platform works.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.45)' }}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="إغلاق"
          style={{ flex: 1 }}
        />

        <View
          style={{
            backgroundColor: color.surfaceCard,
            borderTopLeftRadius: radius['3xl'],
            borderTopRightRadius: radius['3xl'],
            paddingBottom: insets.bottom + space[4],
            maxHeight: '88%',
          }}
        >
          <View style={{ alignItems: 'center', paddingVertical: space[3] }}>
            <View
              style={{
                width: 44,
                height: 5,
                borderRadius: radius.full,
                backgroundColor: color.borderStrong,
              }}
            />
          </View>

          {title ? (
            <View
              style={{
                paddingHorizontal: space[4],
                paddingBottom: space[3],
                borderBottomWidth: 1,
                borderBottomColor: color.borderSubtle,
              }}
            >
              <Text variant="h3">{title}</Text>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={{ padding: space[4], gap: space[3] }}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>

          {footer ? (
            <View
              style={{
                paddingHorizontal: space[4],
                paddingTop: space[3],
                borderTopWidth: 1,
                borderTopColor: color.borderSubtle,
              }}
            >
              {footer}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// ── RestaurantCard ──────────────────────────────────────────────────────────

/**
 * The home screen's restaurant card.
 *
 * A 176px cover with the badges laid over it, exactly as the comp draws it —
 * and a scrim under them, because the overlays sit on whatever photograph the
 * restaurant uploaded and white text on a pale dish is unreadable.
 */
export function RestaurantCard({
  name,
  tags,
  coverUrl,
  rating,
  ratingCount,
  deliveryFee,
  etaMinutes,
  offer,
  closed = false,
  onPress,
}: {
  name: string;
  tags: string;
  coverUrl: string | null;
  rating: number | null;
  ratingCount: number;
  deliveryFee: string;
  etaMinutes: number;
  offer?: string | null;
  closed?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={({ pressed }) => [
        {
          backgroundColor: color.surfaceCard,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: color.borderSubtle,
          overflow: 'hidden',
        },
        shadow.md,
        pressed ? { opacity: 0.92 } : null,
      ]}
    >
      <View style={{ height: 176, backgroundColor: color.surfaceSunken }}>
        {coverUrl ? (
          <RemoteImage uri={coverUrl} style={{ width: '100%', height: '100%' }} />
        ) : (
          /*
           * A restaurant with no photograph yet.
           *
           * Left empty this is 176px of grey with a badge floating in it, which
           * reads as an image that failed to load rather than one that was
           * never uploaded — and most restaurants have no cover on the day they
           * are approved. A tinted ground with the brand mark says "no picture"
           * instead of "something is broken".
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
            <MaterialCommunityIcons name={missingImageGlyph()} size={44} color={accent[300]} />
          </View>
        )}

        {/*
         * The scrim the badges sit on. It is not decoration: the overlays are
         * white text on whatever photograph the restaurant uploaded, and a
         * pale dish makes them unreadable.
         */}
        {coverUrl ? (
          <LinearGradient
            colors={['rgba(17,24,39,0)', 'rgba(17,24,39,0.55)']}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 88,
            }}
          />
        ) : null}

        {offer ? (
          <View
            style={{
              position: 'absolute',
              top: space[3],
              // The start edge — physically the right, where the comp draws
              // both badges. Physical rather than `insetInlineStart`, which
              // follows the native flag and so lands on the left in a build
              // where `forceRTL` has not taken.
              right: space[3],
              backgroundColor: color.brand,
              paddingHorizontal: space[2],
              paddingVertical: 4,
              borderRadius: radius.md,
            }}
          >
            <Text variant="caption" tone="inverse">
              {offer}
            </Text>
          </View>
        ) : null}

        <View
          style={{
            position: 'absolute',
            bottom: space[3],
            right: space[3],
            backgroundColor: 'rgba(17,24,39,0.85)',
            paddingHorizontal: space[2],
            paddingVertical: 4,
            borderRadius: radius.md,
          }}
        >
          <Text variant="caption" tone="inverse">
            {countAr(etaMinutes, MINUTES)}
          </Text>
        </View>

        {closed ? (
          <View
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: 'rgba(255,255,255,0.72)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                backgroundColor: color.surfaceCard,
                paddingHorizontal: space[3],
                paddingVertical: space[2],
                borderRadius: radius.full,
              }}
            >
              <Text variant="smallBold" tone="secondary">
                مغلق الآن
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={{ padding: space[3], gap: space[1] }}>
        <Row justify="space-between" align="flex-start">
          <Text variant="bodyBold" numberOfLines={1} style={{ flex: 1 }}>
            {name}
          </Text>
          <RatingPill rating={rating} count={ratingCount > 0 ? ratingCount : undefined} />
        </Row>

        <Text variant="caption" tone="muted" numberOfLines={1}>
          {tags}
        </Text>

        <Text variant="caption" tone="secondary">
          {deliveryFee}
        </Text>
      </View>
    </Pressable>
  );
}
