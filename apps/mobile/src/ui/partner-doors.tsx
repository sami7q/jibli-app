import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import type { MerchantType } from '@jibli/contracts';
import MaterialCommunityIcons, { type IconName } from '@/ui/icon';
import { sectionOf } from '@/lib/sections';
import { BRAND, ROW, color, palette, radius, shadow, space, TAP_TARGET } from '@/theme';
import { Row, Text } from '@/ui';

/**
 * The two doors a seller can take, drawn the same wherever they appear.
 *
 * «صاحب متجر؟» on the welcome screen and «متجري» for a signed-in account both
 * offer the same two things — register a shop, or sign into one the team has
 * already issued — and they used to draw them differently: a primary button
 * and a ghost link that read as a footnote. That is how the owner of a real
 * username came to say the app "only asks me to register". A door is a card
 * with one job, and both doors are the same size.
 */

/** The five stops of a colour ramp a door draws itself in. */
type Tint = Readonly<Record<50 | 200 | 500 | 600, string>>;

export function Door({
  icon,
  tint = BRAND,
  title,
  body,
  cta,
  note,
  onPress,
  children,
}: {
  icon: IconName;
  tint?: Tint;
  title: string;
  body: string;
  /** The words on the bar at the bottom — what pressing the card does. */
  cta: string;
  /** One quiet line under the bar, for a condition worth knowing first. */
  note?: string;
  onPress: () => void;
  children?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${cta}`}
      style={({ pressed }) => [
        {
          padding: space[4],
          gap: space[3],
          borderRadius: radius.xl,
          backgroundColor: color.surfaceCard,
          borderWidth: 1.5,
          borderColor: pressed ? tint[500] : tint[200],
          opacity: pressed ? 0.92 : 1,
        },
        shadow.sm,
      ]}
    >
      <Row gap={space[3]} align="flex-start">
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tint[50],
          }}
        >
          <MaterialCommunityIcons name={icon} size={26} color={tint[600]} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="h3">{title}</Text>
          <Text variant="small" tone="secondary">
            {body}
          </Text>
        </View>
      </Row>

      {children}

      {/*
       * Drawn as a bar rather than being a `Button`: the whole card is the
       * control, and a second pressable inside it would be two targets that
       * do the same thing and answer to screen readers as two.
       */}
      <View
        style={{
          minHeight: TAP_TARGET,
          borderRadius: radius.md,
          backgroundColor: tint[500],
          flexDirection: ROW,
          alignItems: 'center',
          justifyContent: 'center',
          gap: space[2],
          paddingHorizontal: space[4],
        }}
      >
        <Text variant="bodyBold" tone="inverse">
          {cta}
        </Text>
        <MaterialCommunityIcons name="chevron-left" size={20} color={palette.white} />
      </View>

      {note ? (
        <Text variant="caption" tone="muted" align="center">
          {note}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A section's own colour and icon: what «ماركت» and «كوزمتك» look like everywhere else. */
export function KindBadge({ kind }: { kind: MerchantType }) {
  const section = sectionOf(kind);
  return (
    <Row
      gap={space[1]}
      style={{
        paddingVertical: space[1],
        paddingHorizontal: space[3],
        borderRadius: radius.full,
        backgroundColor: section.ramp[500],
      }}
    >
      <MaterialCommunityIcons name={section.shopIcon} size={16} color="#fff" />
      <Text variant="captionBold" tone="inverse">
        {section.shortName}
      </Text>
    </Row>
  );
}

/** One numbered line of what happens next. */
export function Step({ number, text }: { number: string; text: string }) {
  return (
    <Row gap={space[2]}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: BRAND[500],
        }}
      >
        <Text variant="captionBold" tone="inverse">
          {number}
        </Text>
      </View>
      <Text variant="small" style={{ flex: 1 }}>
        {text}
      </Text>
    </Row>
  );
}
