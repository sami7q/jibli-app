import { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import MaterialCommunityIcons from '@/ui/icon';
import type { MerchantType } from '@jibli/contracts';
import { api, assetUrl } from '@/lib/api';
import { useArea } from '@/lib/area';
import { useIsGuest } from '@/lib/session';
import { useVertical } from '@/lib/vertical';
import { SECTIONS, SECTION_ORDER, type Section } from '@/lib/sections';
import { ALIGN_START, BRAND, ROW, TEXT_START, palette, radius, space } from '@/theme';
import { RemoteImage, Screen, Text } from '@/ui';
import { Enter } from '@/ui/enter';
import { JibliWordmark } from '@/ui/brand';
import { AreaPicker } from '@/ui/area-picker';
import { AddressSheet } from '@/ui/address-sheet';

/**
 * Which section of Jibli, asked before anything else is shown (Home v3).
 *
 * A dark ground with one card per section filling the rest of the screen —
 * the only colour on the page is the sections themselves, so the three read
 * as the choice at a glance. Each card is its section's own ramp: tapping it
 * paints the whole app in that ramp, so the card has to be that colour.
 *
 * The header carries the two things worth knowing before choosing: where the
 * order is going (tappable, the same picker the home screen opens) and the
 * question itself.
 *
 * The picture slot shows the top banner of that section's own storefront, so
 * an operator who schedules artwork in Admin sees it advertised on the way in;
 * a section with no artwork shows its glyph instead.
 */

/** The page ground: a warm near-black, so the three section colours carry it. */
const GROUND = '#1C1A18';
const MUTED = '#A9A298';
/** The «delivering» dot — live, not the market's brand green. */
const LIVE_DOT = '#7EE0A8';

const PANELS: readonly Section[] = SECTION_ORDER.map((type) => SECTIONS[type]);

/** The card colour: the section's ramp at the stop that carries white text. */
const cardColor = (section: Section) => section.ramp[600];

export default function ChooseScreen() {
  const router = useRouter();
  const { choose } = useVertical();
  const { width } = useWindowDimensions();
  const { area, isResolving } = useArea();
  const isGuest = useIsGuest();
  const [pickingArea, setPickingArea] = useState(false);

  /*
   * Every storefront, for its artwork. Small, cached for the session, and the
   * one the customer picks is exactly what the home screen asks for next.
   */
  const storefronts = useQueries({
    queries: SECTION_ORDER.map((type) => ({
      queryKey: ['storefront', type],
      queryFn: () => api.storefront(type),
      staleTime: 5 * 60_000,
    })),
  });

  const artworkFor = (type: MerchantType): string | null => {
    const query = storefronts[SECTION_ORDER.indexOf(type)];
    const first = (query?.data?.banners ?? []).find((banner) => banner.image_asset_id);
    return first?.image_asset_id ? assetUrl(first.image_asset_id) : null;
  };

  const enter = (type: MerchantType) => {
    choose(type);
    router.replace('/(tabs)');
  };

  // The picture keeps a third of a narrow phone's card for the words.
  const artWidth = Math.min(118, width * 0.3);

  return (
    <Screen edges={['top', 'bottom']} padded={false} background={GROUND}>
      <StatusBar style="light" />

      {/*
        The glow behind the header, in the brand orange. Drawn rather than
        blurred: React Native has no CSS filter, and a radial gradient is the
        same picture at no cost.
      */}
      <Svg
        width={380}
        height={380}
        style={{ position: 'absolute', top: -170, left: -160 }}
        pointerEvents="none"
      >
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={BRAND[500]} stopOpacity="0.38" />
            <Stop offset="1" stopColor={BRAND[500]} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx="190" cy="190" r="190" fill="url(#glow)" />
      </Svg>

      <View style={{ paddingHorizontal: 22, paddingTop: space[2] }}>
        <View
          style={{
            flexDirection: ROW,
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space[3],
          }}
        >
          <Pressable
            onPress={() => setPickingArea(true)}
            accessibilityRole="button"
            accessibilityLabel="تغيير منطقة التوصيل"
            accessibilityValue={area ? { text: area.cityNameAr } : undefined}
            style={({ pressed }) => [
              {
                flexDirection: ROW,
                alignItems: 'center',
                gap: 10,
                flexShrink: 1,
                paddingVertical: 7,
                paddingHorizontal: 14,
                borderRadius: radius.full,
                backgroundColor: 'rgba(255,255,255,0.08)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
              },
              pressed ? { backgroundColor: 'rgba(255,255,255,0.14)' } : null,
            ]}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LIVE_DOT }} />
            <View style={{ flexShrink: 1, alignItems: ALIGN_START }}>
              <Text variant="caption" style={{ color: MUTED, fontSize: 10.5 }}>
                التوصيل إلى
              </Text>
              <View style={{ flexDirection: ROW, alignItems: 'center', gap: 2 }}>
                <Text
                  variant="smallBold"
                  tone="inverse"
                  numberOfLines={1}
                  style={{ flexShrink: 1 }}
                >
                  {isResolving ? '…' : (area?.cityNameAr ?? 'اختر منطقتك')}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={16} color={palette.white} />
              </View>
            </View>
          </Pressable>

          <JibliWordmark animate width={78} tint={BRAND[500]} pinTint={GROUND} />
        </View>

        <Enter delay={120}>
          <View style={{ marginTop: 26, marginBottom: 20 }}>
            <Text
              variant="display"
              tone="inverse"
              style={{ fontSize: 34, lineHeight: 42, textAlign: TEXT_START }}
            >
              شنو تريد اليوم؟
            </Text>
          </View>
        </Enter>
      </View>

      <View style={{ flex: 1, gap: 10, paddingHorizontal: 14, paddingBottom: 14 }}>
        {PANELS.map((section, index) => (
          <Enter key={section.type} delay={180 + index * 90} style={{ flex: 1 }}>
            <SectionCard
              section={section}
              artwork={artworkFor(section.type)}
              artWidth={artWidth}
              onPress={() => enter(section.type)}
            />
          </Enter>
        ))}
      </View>

      {/*
        The same pickers the home screen opens: a signed-in customer chooses
        among their addresses, a guest chooses a city to browse.
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

function SectionCard({
  section,
  artwork,
  artWidth,
  onPress,
}: {
  section: Section;
  artwork: string | null;
  artWidth: number;
  onPress: () => void;
}) {
  const tint = cardColor(section);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${section.label} — ${section.tags}. التوصيل خلال ${section.eta}${
        section.isNew ? '. جديد' : ''
      }`}
      style={({ pressed }) => [
        {
          flex: 1,
          flexDirection: ROW,
          alignItems: 'stretch',
          gap: 14,
          padding: 20,
          borderRadius: 30,
          overflow: 'hidden',
          backgroundColor: tint,
        },
        pressed ? { transform: [{ scale: 0.98 }] } : null,
      ]}
    >
      <View style={{ flex: 1, minWidth: 0, justifyContent: 'space-between' }}>
        <View style={{ gap: 4, alignItems: ALIGN_START }}>
          <View style={{ flexDirection: ROW, alignItems: 'center', gap: space[2] }}>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>جيبلي</Text>
            {section.isNew ? (
              <View
                style={{
                  paddingVertical: 2,
                  paddingHorizontal: space[2],
                  borderRadius: radius.full,
                  backgroundColor: palette.white,
                }}
              >
                <Text style={{ fontSize: 10.5, fontWeight: '700', color: tint }}>جديد</Text>
              </View>
            ) : null}
          </View>

          <Text
            variant="display"
            tone="inverse"
            numberOfLines={1}
            style={{ fontSize: 30, lineHeight: 36, textAlign: TEXT_START }}
          >
            {section.shortName}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: 13, color: palette.white, opacity: 0.92, textAlign: TEXT_START }}
          >
            {section.tags}
          </Text>
        </View>

        <View style={{ flexDirection: ROW, alignItems: 'center', gap: space[2] }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: palette.white,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Forward, in a right-to-left app, points left. */}
            <MaterialCommunityIcons name="arrow-left" size={20} color={tint} />
          </View>
          <View
            style={{
              flexDirection: ROW,
              alignItems: 'center',
              gap: 4,
              paddingVertical: 5,
              paddingHorizontal: 11,
              borderRadius: radius.full,
              backgroundColor: 'rgba(0,0,0,0.18)',
            }}
          >
            <MaterialCommunityIcons name="clock-outline" size={13} color={palette.white} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: palette.white }}>
              {section.eta}
            </Text>
          </View>
        </View>
      </View>

      <View
        style={{
          width: artWidth,
          borderRadius: 22,
          overflow: 'hidden',
          backgroundColor: 'rgba(255,255,255,0.14)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {artwork ? (
          <RemoteImage
            uri={artwork}
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
            priority="high"
          />
        ) : (
          <MaterialCommunityIcons name={section.icon} size={44} color="rgba(255,255,255,0.9)" />
        )}
      </View>
    </Pressable>
  );
}
