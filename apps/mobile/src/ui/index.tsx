import { useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type ScrollViewProps,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Image as ExpoImage, type ImageStyle } from 'expo-image';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import {
  ALIGN_START,
  color,
  LAID_OUT_RTL,
  palette,
  radius,
  ROW,
  shadow,
  space,
  TAP_TARGET,
  TEXT_START,
  text,
} from '@/theme';

/**
 * The mobile UI kit.
 *
 * Four screens existed before this file and each hand-rolled its own button,
 * its own input, its own card — so "the primary button" was four slightly
 * different buttons, and a new design had nowhere to land except a search and
 * replace across every screen.
 *
 * Everything here reads from `@/theme`, which reads from `@jibli/design-tokens`,
 * which the web portals read too. A change to the brand moves all three.
 *
 * Two rules the whole kit follows:
 *
 *   **Direction is decided here, not by the device.** `I18nManager.forceRTL`
 *   does not take until the app restarts and never takes at all in Expo Go, so
 *   a kit that writes `flexDirection: 'row'` and trusts the flag renders one
 *   way in development and the other way in a store build. Everything
 *   directional reads a pinned token instead — `ROW`, `ALIGN_START`,
 *   `TEXT_START` — which means the same thing in both modes. The corollary is
 *   that positional styles must be *physical* (`left`/`right`): the logical
 *   ones follow the flag, so they would reopen the split these tokens close.
 *
 *   **Nothing smaller than the tap target.** Every pressable declares
 *   `minHeight: TAP_TARGET` (plan §134). A 32px icon button is a button most
 *   thumbs miss.
 */

// ── Text ────────────────────────────────────────────────────────────────────

/**
 * How far the app lets the system's text-size setting grow the type.
 *
 * Set here, once, because every string in the app renders through `Text` below
 * — which is also why the app had no ceiling at all until now: there was one
 * place to add it and nobody had.
 *
 * See the note on the prop for why this is a cap rather than a switch.
 */
export const TEXT_SCALE_CEILING = 1.4;

export type TextVariant = keyof typeof text;

export function Text({
  children,
  variant = 'body',
  tone = 'primary',
  align,
  style,
  numberOfLines,
  maxFontSizeMultiplier,
}: {
  children: ReactNode;
  variant?: TextVariant;
  tone?: 'primary' | 'secondary' | 'muted' | 'brand' | 'inverse' | 'danger' | 'success';
  /** `start` is the right edge — see `TEXT_START`. */
  align?: 'start' | 'center';
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /**
   * Let this one piece of text grow further than the app-wide ceiling.
   *
   * For a number or a heading that is the whole point of its screen and has
   * room to grow into. Defaults to `TEXT_SCALE_CEILING`.
   */
  maxFontSizeMultiplier?: number;
}) {
  const tones: Record<string, string> = {
    primary: color.textPrimary,
    secondary: color.textSecondary,
    muted: color.textMuted,
    brand: color.textBrand,
    inverse: color.textInverse,
    danger: color.dangerStrong,
    success: color.successStrong,
  };

  return (
    <RNText
      style={[
        text[variant],
        { color: tones[tone] },
        align ? { textAlign: align === 'start' ? TEXT_START : ('center' as const) } : null,
        style,
      ]}
      /*
       * Accessibility text scaling, capped rather than ignored or disabled.
       *
       * Nothing set this, so the app inherited the platform default of
       * unlimited: Android 14 allows 2.0× and, combined with Display Size,
       * more. This app is full of containers with deliberate fixed heights —
       * `TAP_TARGET` buttons, the tab bar, price rows, badges — so unbounded
       * growth did not reflow, it clipped. A customer who has turned text up
       * because they need it turned up was the one who could not read the
       * total.
       *
       * `allowFontScaling={false}` is the usual reflex and is the wrong fix:
       * it means someone who set larger text gets ignored, which is worse than
       * a cramped layout and is an accessibility failure in its own right.
       *
       * 1.4 is where this app's layouts hold. It honours most of the range
       * people actually use while keeping the extreme end from breaking the
       * screens — and a screen that genuinely has room can opt out per call.
       */
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? TEXT_SCALE_CEILING}
      {...(numberOfLines === undefined ? {} : { numberOfLines })}
    >
      {children}
    </RNText>
  );
}

/**
 * A run of Latin inside Arabic — an order number, a phone number, a price.
 *
 * Without isolation the bidi algorithm reorders `#JB1234` next to Arabic and
 * the digits come out backwards. `writingDirection: 'ltr'` is the React Native
 * equivalent of the web's `unicode-bidi: isolate`.
 */
export function Ltr({
  children,
  variant = 'body',
  tone = 'primary',
  style,
}: {
  children: ReactNode;
  variant?: TextVariant;
  tone?: 'primary' | 'secondary' | 'muted' | 'brand' | 'inverse';
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text variant={variant} tone={tone} style={[{ writingDirection: 'ltr' }, style]}>
      {children}
    </Text>
  );
}

// ── Images ──────────────────────────────────────────────────────────────────

/**
 * Every photograph the app loads over the network.
 *
 * One component rather than ten call sites, for the same reason the buttons
 * are one component: the policy below is a decision about the product, and it
 * was previously nowhere — ten `<Image>` tags each carrying `resizeMode` and
 * nothing else.
 *
 * What the policy is, and why each part of it:
 *
 *   **Decoded at the size it is drawn.** React Native's `Image` decodes a
 *   bitmap at the source's own resolution, so the 1920×1080 banner the portal
 *   now uploads is about 8 MB of ARGB in memory for a strip 200 points tall.
 *   Three of those and a cheap Android phone starts evicting. `expo-image`
 *   samples down to the view's size at the screen's own pixel density, which
 *   is the same picture to the eye and a tenth of the memory. Nothing is lost
 *   from the stored file — that is still full resolution, and still what a
 *   larger view gets.
 *
 *   **Kept on disk.** Assets are served `immutable` for a year against a
 *   UUIDv7 that is minted per upload, so a cached copy can never be stale.
 *   The API is a single small instance with no CDN in front of it, which makes
 *   the second load of a menu the difference between instant and a round trip
 *   per dish.
 *
 *   **Faded in, not popped in.** 180ms. On the connection most customers have,
 *   images arrive one by one after the text, and a card that snaps between
 *   grey and photograph reads as the page reloading.
 *
 *   **`recyclingKey`.** A list reuses views as it scrolls; without this the
 *   recycled view keeps the previous dish's picture until the new one decodes,
 *   which is the wrong photograph next to the right name.
 */
export function RemoteImage({
  uri,
  style,
  contentFit = 'cover',
  priority = 'normal',
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain';
  /** `high` for the one image a screen is about: a banner, a cover. */
  priority?: 'low' | 'normal' | 'high';
}) {
  return (
    <ExpoImage
      source={uri}
      style={style}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      priority={priority}
      transition={180}
      recyclingKey={uri}
    />
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

/**
 * The page frame.
 *
 * Takes the safe-area edges rather than assuming: a screen with its own sticky
 * footer handles the bottom inset itself, and a double inset leaves a visible
 * gap above the home indicator.
 */
export function Screen({
  children,
  scroll = false,
  edges = ['top', 'bottom'],
  padded = true,
  background = color.surfacePage,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  padded?: boolean;
  /** The page ground. Brand orange on the welcome screen; the page grey
   * everywhere else. Set here rather than in a screen's own style so the safe
   * areas are painted too — otherwise the notch stays grey above an orange
   * screen. */
  background?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const inner: StyleProp<ViewStyle> = [padded ? { padding: space[4] } : null, style];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[inner, { flexGrow: 1 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

// ── Button ──────────────────────────────────────────────────────────────────

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  block = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  block?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const isOff = disabled || loading;

  const surfaces: Record<string, ViewStyle> = {
    primary: { backgroundColor: color.brand },
    secondary: {
      backgroundColor: color.surfaceCard,
      borderWidth: 1,
      borderColor: color.borderStrong,
    },
    ghost: { backgroundColor: 'transparent' },
    danger: { backgroundColor: color.danger },
  };

  const labelTones: Record<string, string> = {
    primary: color.textInverse,
    secondary: color.textPrimary,
    ghost: color.textBrand,
    danger: color.textInverse,
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={isOff}
      accessibilityRole="button"
      accessibilityState={{ disabled: isOff, busy: loading }}
      // The label, not the icon: a screen reader announcing "button" and
      // nothing else is a button nobody can use.
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          minHeight: size === 'lg' ? TAP_TARGET + 8 : TAP_TARGET,
          paddingHorizontal: space[5],
          borderRadius: radius.md,
          // The icon sits before the label, which in Arabic is its right.
          flexDirection: ROW,
          alignItems: 'center',
          justifyContent: 'center',
          gap: space[2],
          /*
           * Not `flex-start`: an inline button under a right-aligned heading
           * belongs on the right, and `flex-start` is the left until the
           * native flag says otherwise.
           *
           * This is the column case, which is nearly every one. A button
           * placed inside a `Row` is on a vertical cross axis instead, where
           * this would read as "bottom" — those few pass `alignSelf: 'center'`
           * of their own and say so at the call site.
           */
          alignSelf: block ? 'stretch' : ALIGN_START,
        },
        surfaces[variant],
        variant === 'primary' || variant === 'danger' ? shadow.sm : null,
        // Opacity rather than a different colour: one rule for every variant,
        // and it never produces an unreadable pairing.
        pressed ? { opacity: 0.82 } : null,
        isOff ? { opacity: 0.45 } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={labelTones[variant]} />
      ) : (
        <>
          {icon}
          <RNText style={[text.bodyBold, { color: labelTones[variant] }]}>{label}</RNText>
        </>
      )}
    </Pressable>
  );
}

// ── Surfaces ────────────────────────────────────────────────────────────────

export function Card({
  children,
  onPress,
  padded = true,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const body: StyleProp<ViewStyle> = [
    {
      backgroundColor: color.surfaceCard,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.borderSubtle,
      ...(padded ? { padding: space[4] } : {}),
    },
    shadow.sm,
    style,
  ];

  if (!onPress) return <View style={body}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [body, pressed ? { opacity: 0.9 } : null]}
    >
      {children}
    </Pressable>
  );
}

/**
 * A row, reading right to left.
 *
 * The single most load-bearing component in the app: nearly every header, card
 * and summary line in twenty screens is one of these, and for most of them
 * this is the only thing that decides which way round they come out. It wrote
 * `flexDirection: 'row'` and therefore followed the native flag — which is how
 * an Arabic app ended up with its back arrows on the left and its restaurant
 * names on the wrong side of the price.
 *
 * A row whose *content* reads the other way — a phone prefix beside a number,
 * a verification code — is not one of these: it reaches for `ROW_LTR` and says
 * so at the point where the exception is being made.
 */
export function Row({
  children,
  gap = space[2],
  align = 'center',
  justify,
  style,
}: {
  children: ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        { flexDirection: ROW, alignItems: align, gap },
        justify ? { justifyContent: justify } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * A strip that scrolls sideways and begins on the right.
 *
 * Two things have to be true for that, and only one of them is a style. The
 * items are laid out with `ROW`, so the first category sits at the right-hand
 * end of the content; but a horizontal `ScrollView` still opens at offset zero,
 * which is the *left* end — so the strip would open showing the last item and
 * the customer would have to swipe backwards to find the first one.
 *
 * Nudged to the far end once, on the first layout, and only where the platform
 * has not already done it: a device laying out right-to-left natively — and a
 * browser under `dir="rtl"` — starts a horizontal scroller at the right on its
 * own, and a second nudge there would be a no-op at best.
 *
 * `flexGrow` is for the short case. Four categories do not fill the screen, and
 * without it the content box shrinks to its items and lands against the left
 * edge — a row of chips floating away from the side the page reads from.
 */
export function HScroll({
  children,
  contentContainerStyle,
  onContentSizeChange,
  ...props
}: Omit<ScrollViewProps, 'horizontal'> & { children: ReactNode }) {
  const view = useRef<ScrollView>(null);
  const settled = useRef(false);

  return (
    <ScrollView
      ref={view}
      horizontal
      showsHorizontalScrollIndicator={false}
      {...props}
      contentContainerStyle={[{ flexDirection: ROW, flexGrow: 1 }, contentContainerStyle]}
      onContentSizeChange={(width, height) => {
        if (!LAID_OUT_RTL && !settled.current && width > 0) {
          settled.current = true;
          view.current?.scrollToEnd({ animated: false });
        }
        onContentSizeChange?.(width, height);
      }}
    >
      {children}
    </ScrollView>
  );
}

// ── Badge ───────────────────────────────────────────────────────────────────

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
}) {
  const tones: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: color.surfaceSunken, fg: color.textSecondary },
    success: { bg: color.successSoft, fg: color.successStrong },
    warning: { bg: color.warningSoft, fg: color.warningStrong },
    danger: { bg: color.dangerSoft, fg: color.dangerStrong },
    brand: { bg: color.brandSoft, fg: color.brandDeep },
  };
  const palette_ = tones[tone] ?? tones.neutral!;

  return (
    <View
      style={{
        backgroundColor: palette_.bg,
        paddingHorizontal: space[2],
        paddingVertical: space[1],
        borderRadius: radius.full,
        // The top of whatever row it is in — `alignSelf` here is the cross
        // axis, which for a row is vertical and does not mirror.
        alignSelf: 'flex-start',
      }}
    >
      <RNText style={[text.caption, { color: palette_.fg }]}>{label}</RNText>
    </View>
  );
}

// ── Input ───────────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="smallBold" tone="secondary">
        {label}
      </Text>
      {children}
      {/* The error replaces the hint rather than stacking: two lines of small
          text under a field is where people stop reading either. */}
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Input({
  invalid = false,
  ltr = false,
  style,
  ...props
}: TextInputProps & { invalid?: boolean; ltr?: boolean }) {
  return (
    <TextInput
      placeholderTextColor={palette.ink[400]}
      style={[
        text.body,
        {
          minHeight: TAP_TARGET,
          paddingHorizontal: space[3],
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: invalid ? color.danger : color.borderStrong,
          backgroundColor: color.surfaceCard,
          color: color.textPrimary,
          // A phone number typed into an RTL field comes out reversed unless
          // the field itself is LTR. Everything else starts where Arabic
          // starts, stated rather than left to the bidi algorithm — an empty
          // field has no first strong character for it to read.
          ...(ltr
            ? { textAlign: 'left' as const, writingDirection: 'ltr' as const }
            : { textAlign: TEXT_START }),
        },
        style,
      ]}
      {...props}
    />
  );
}

// ── States ──────────────────────────────────────────────────────────────────

/** A loading placeholder shaped like the thing it is standing in for. */
export function Skeleton({
  height = 16,
  width,
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          height,
          width: width ?? '100%',
          borderRadius: radius.sm,
          backgroundColor: color.surfaceSunken,
        },
        style,
      ]}
    />
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[2],
        paddingVertical: space[8],
        paddingHorizontal: space[4],
        /*
         * Tall enough to sit in the middle of the screen rather than at the top
         * of it. A three-line message pinned under the header with an empty
         * half-page beneath reads as a page that failed to load; the same
         * message centred in that space reads as the answer.
         */
        minHeight: 340,
      }}
    >
      <Text variant="h3" align="center">
        {title}
      </Text>
      {body ? (
        <Text tone="muted" align="center">
          {body}
        </Text>
      ) : null}
      {action ? (
        /*
         * `alignSelf` is stated because Button sets its own to `flex-start`,
         * which wins over the parent's `alignItems: 'center'` — so the one
         * element this block exists for was landing hard against the left edge
         * under two centred lines of text.
         */
        <Button
          label={action.label}
          onPress={action.onPress}
          size="lg"
          style={{ marginTop: space[3], alignSelf: 'center', paddingHorizontal: space[8] }}
        />
      ) : null}
    </View>
  );
}

/**
 * A failure the user can act on.
 *
 * Takes the message rather than inventing one: the API already answered in
 * Arabic with a reason, and replacing it with "something went wrong" throws
 * away the only part that helps (plan §112).
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', gap: space[3], paddingVertical: space[8] }}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.full,
          backgroundColor: color.dangerSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <RNText style={[text.h2, { color: color.dangerStrong }]}>!</RNText>
      </View>
      <Text align="center" tone="secondary">
        {message}
      </Text>
      {onRetry ? <Button label="إعادة المحاولة" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}
