import { Pressable, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { MerchantType } from '@jibli/contracts';
import { api } from '@/lib/api';
import { useVertical } from '@/lib/vertical';
import { color, palette, radius, space, text } from '@/theme';
import { Screen, Text } from '@/ui';
import { Enter } from '@/ui/enter';
import { JibliWordmark } from '@/ui/brand';

/**
 * Which half of Jibli, asked before anything else is shown.
 *
 * The switch that used to sit on the home screen could only swap the merchant
 * list. The banner above it and the category strip below it belonged to
 * neither half, because they were the same rows for both — and they cannot be:
 * «برجر» is not an aisle, and a paid placement is sold for one section rather
 * than for the app. With the content split, the question has to come first.
 *
 * Two panels filling the screen rather than two cards floating on it. A
 * chooser has exactly one job and no competing content, so the compression
 * that makes a card the right shape inside a scrolling page is simply absent
 * here — leaving margins around it would be decorating emptiness.
 *
 * Each panel carries its own section's live banner headline. That is what puts
 * merchandising on this screen without inventing a third place to manage it:
 * the strip is the top row of that half's own storefront, so an operator who
 * schedules a Ramadan banner sees it advertised on the way in, and a section
 * with nothing running simply shows nothing.
 */

const HALVES: readonly {
  readonly type: MerchantType;
  readonly label: string;
  readonly caption: string;
  readonly examples: string;
  readonly icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  /** Two stops, deep to bright, so the panel has a direction rather than a fill. */
  readonly gradient: readonly [string, string];
}[] = [
  {
    type: 'RESTAURANT',
    label: 'جيبلي أكل',
    caption: 'مطاعم ووجبات تصلك ساخنة',
    examples: 'مندي · برجر · بيتزا · شاورما · حلويات',
    icon: 'silverware-fork-knife',
    gradient: [palette.orange[400], palette.orange[700]],
  },
  {
    type: 'MARKET',
    label: 'جيبلي ماركت',
    caption: 'بقالة ومواد غذائية خلال دقائق',
    examples: 'خضار · ألبان · لحوم · مخبوزات · منظفات',
    icon: 'basket-outline',
    /*
     * The market's own ramp, not a green picked for this screen.
     *
     * The panel is a promise about what is behind it: tapping it paints the
     * whole app in `palette.green`, so the panel has to be that green. A
     * hand-picked one here would mean the chooser and the section it opens
     * disagree by a few degrees of hue, which is the kind of thing nobody can
     * name and everybody notices.
     */
    gradient: [palette.green[400], palette.green[800]],
  },
];

export default function ChooseScreen() {
  const router = useRouter();
  const { choose } = useVertical();
  const { height } = useWindowDimensions();

  /*
   * Both storefronts, for their headlines only.
   *
   * Two requests on the first screen is worth it: they are small, cached for
   * the session, and they are the ones the home screen is about to make
   * anyway — so the half the customer picks is already loaded by the time it
   * renders.
   */
  const food = useQuery({
    queryKey: ['storefront', 'RESTAURANT'],
    queryFn: () => api.storefront('RESTAURANT'),
    staleTime: 5 * 60_000,
  });
  const market = useQuery({
    queryKey: ['storefront', 'MARKET'],
    queryFn: () => api.storefront('MARKET'),
    staleTime: 5 * 60_000,
  });

  /*
   * The section's offer, not its first banner.
   *
   * Taking `banners[0]` put «أهلاً بك في جيبلي» on the food panel and «جيبلي
   * ماركت» on the market one — a welcome and a restatement of the title
   * directly beneath the title. Neither is merchandising; both are the kind of
   * filler that teaches people to stop reading a slot.
   *
   * A banner that links to a category is one somebody built to send traffic
   * somewhere, which is the definition of an offer here. A section running
   * only a welcome shows no chip at all, because an empty slot is more honest
   * than a full one saying nothing.
   */
  const headline = (type: MerchantType): string | null => {
    const banners = (type === 'MARKET' ? market.data : food.data)?.banners ?? [];
    const offer = banners.find((banner) => banner.link_type === 'CATEGORY');
    return offer?.title_ar ?? null;
  };

  const enter = (type: MerchantType) => {
    choose(type);
    router.replace('/(tabs)');
  };

  /*
   * The panels take what is left after the header, split evenly.
   *
   * Measured rather than given a fixed height: on a short phone a hard 300pt
   * would push the second panel off the screen, and the one thing this layout
   * cannot do is hide half of a two-way choice.
   */
  const panelHeight = Math.max((height - 190) / 2, 160);

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={{ flex: 1, backgroundColor: color.surfaceCard }}>
        <Enter delay={0}>
          <View
            style={{
              alignItems: 'center',
              paddingTop: space[6],
              paddingBottom: space[4],
              gap: space[1],
            }}
          >
            <JibliWordmark width={128} tint={color.brand} pinTint={palette.white} />
            <Text variant="h3" style={{ marginTop: space[2] }}>
              شنو تريد اليوم؟
            </Text>
            <Text variant="small" tone="muted">
              اختر القسم، وتقدر ترجع تبدّله بأي وقت
            </Text>
          </View>
        </Enter>

        {HALVES.map((half, index) => {
          const promo = headline(half.type);

          return (
            <Enter key={half.type} delay={90 + index * 90} style={{ flex: 1 }}>
              <Pressable
                onPress={() => enter(half.type)}
                accessibilityRole="button"
                accessibilityLabel={`${half.label} — ${half.caption}`}
                style={({ pressed }) => [
                  { flex: 1, minHeight: panelHeight },
                  pressed ? { opacity: 0.94 } : null,
                ]}
              >
                <LinearGradient
                  colors={[...half.gradient]}
                  // Diagonal: a vertical fade reads as a flat panel that
                  // happens to be two colours.
                  start={{ x: 1, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={{ flex: 1, justifyContent: 'center', paddingHorizontal: space[5] }}
                >
                  {/*
                    The glyph is the texture, not an icon beside a label. At
                    this size it reads as pattern and the panel still says one
                    thing; at label size it would compete with the words.
                  */}
                  <MaterialCommunityIcons
                    name={half.icon}
                    size={panelHeight * 0.92}
                    color="rgba(255,255,255,0.13)"
                    style={{
                      position: 'absolute',
                      insetInlineStart: -panelHeight * 0.18,
                      bottom: -panelHeight * 0.2,
                    }}
                  />

                  <View style={{ gap: space[2] }}>
                    <View
                      style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: space[3] }}
                    >
                      <MaterialCommunityIcons name={half.icon} size={28} color={palette.white} />
                      <Text style={{ ...text.display, color: palette.white }}>{half.label}</Text>
                    </View>

                    <Text style={{ ...text.body, color: palette.white, opacity: 0.95 }}>
                      {half.caption}
                    </Text>

                    <Text style={{ ...text.small, color: palette.white, opacity: 0.8 }}>
                      {half.examples}
                    </Text>

                    {/*
                      The section's own headline, when it has one.
                      Rendered as a chip rather than another line of copy: it
                      is the only part of this panel that changes week to week,
                      and it should look like it.
                    */}
                    {promo ? (
                      <View
                        style={{
                          flexDirection: 'row-reverse',
                          alignItems: 'center',
                          alignSelf: 'flex-start',
                          gap: space[2],
                          marginTop: space[2],
                          paddingVertical: space[2],
                          paddingHorizontal: space[3],
                          borderRadius: radius.full,
                          backgroundColor: 'rgba(255,255,255,0.22)',
                        }}
                      >
                        <MaterialCommunityIcons
                          name="tag-outline"
                          size={14}
                          color={palette.white}
                        />
                        <Text
                          style={{ ...text.captionBold, color: palette.white }}
                          numberOfLines={1}
                        >
                          {promo}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </LinearGradient>
              </Pressable>
            </Enter>
          );
        })}
      </View>
    </Screen>
  );
}
