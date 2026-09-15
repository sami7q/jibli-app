import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { color, palette, radius, shadow, space, TAP_TARGET, text } from '@/theme';

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
 *   **No hard-coded left or right.** RTL is forced (plan §2), so anything
 *   directional uses `start`/`end` and React Native mirrors it. A `marginLeft`
 *   in here is a bug that only shows up in Arabic.
 *
 *   **Nothing smaller than the tap target.** Every pressable declares
 *   `minHeight: TAP_TARGET` (plan §134). A 32px icon button is a button most
 *   thumbs miss.
 */

// ── Text ────────────────────────────────────────────────────────────────────

export type TextVariant = keyof typeof text;

export function Text({
  children,
  variant = 'body',
  tone = 'primary',
  align,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: TextVariant;
  tone?: 'primary' | 'secondary' | 'muted' | 'brand' | 'inverse' | 'danger' | 'success';
  /**
   * `start` follows the writing direction; there is no logical `end` in React
   * Native, and offering one that resolves to a physical side would be wrong
   * in exactly the language this app is written in.
   */
  align?: 'start' | 'center';
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
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
        // 'auto' follows the text's own direction — under forced RTL that is
        // the right edge, which is what "start" means here.
        align ? { textAlign: align === 'start' ? ('auto' as const) : ('center' as const) } : null,
        style,
      ]}
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
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space[2],
          alignSelf: block ? 'stretch' : 'flex-start',
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

export function Divider({ spacing = space[3] }: { spacing?: number }) {
  return (
    <View style={{ height: 1, backgroundColor: color.borderSubtle, marginVertical: spacing }} />
  );
}

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
        { flexDirection: 'row', alignItems: align, gap },
        justify ? { justifyContent: justify } : null,
        style,
      ]}
    >
      {children}
    </View>
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
          // the field itself is LTR.
          ...(ltr ? { textAlign: 'left' as const, writingDirection: 'ltr' as const } : {}),
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
