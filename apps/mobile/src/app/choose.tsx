import { Image, Pressable, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { MerchantType } from '@jibli/contracts';
import { api, assetUrl } from '@/lib/api';
import { useVertical } from '@/lib/vertical';
import { color, palette, radius, shadow, space, text } from '@/theme';
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
 * Each panel is its own section's banner, and nothing else. It used to be a
 * title, a caption, a list of examples and a promo chip — four ways of saying
 * what a photograph of a burger and a photograph of a full basket say at a
 * glance. Once real artwork arrived that became unarguable: the art already
 * says «جيبلي ماركت» in its own typography, and the panel was repeating it
 * underneath in a different one. The words survive in the accessibility
 * label, where they are the whole content rather than a second headline.
 *
 * The banner shown is the top row of that half's own storefront, so this
 * screen needs no third place to manage: an operator who schedules a Ramadan
 * banner in Admin sees it advertised on the way in.
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
  const { height, width } = useWindowDimensions();

  /*
   * Both storefronts, for their banners.
   *
   * Two requests on the first screen is worth it: they are small, cached for
   * the session, and they are the ones the home screen is about to make
   * anyway — so the half the customer picks is already loaded by the time it
   * renders, artwork included.
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

  /**
   * The section's first piece of artwork — the one its home screen opens on —
   * and whether we know yet that there isn't one.
   *
   * The two are separate answers. «no artwork» during the request and «no
   * artwork» after it look identical from a null, and treating them the same
   * puts the words on screen for as long as the fetch takes and then yanks
   * them away. A panel that says one thing and then says something else is
   * worse than a panel that waits.
   */
  const artwork = (type: MerchantType): { url: string | null; known: boolean } => {
    const query = type === 'MARKET' ? market : food;
    const first = (query.data?.banners ?? []).find((banner) => banner.image_asset_id);

    return {
      url: first?.image_asset_id ? assetUrl(first.image_asset_id) : null,
      known: query.isSuccess || query.isError,
    };
  };

  const enter = (type: MerchantType) => {
    choose(type);
    router.replace('/(tabs)');
  };

  /*
   * The art sets the panel's height. The panel does not set the art's.
   *
   * Splitting the screen evenly and centring a 16:9 banner in each half left
   * 70pt of flat colour above and below it — a third of every panel saying
   * nothing, which reads as a banner that failed to load rather than one that
   * is the wrong shape for the space. Covering the panel instead would crop
   * 37% off the banner's width, and these are composed left to right with the
   * products on one side and the headline on the other, so that 37% is where
   * half the design lives.
   *
   * So the panel is the banner plus an even frame. Nothing is cropped and
   * nothing is padding: every phone shows the identical picture, and the
   * section's colour is a border around it rather than a gap behind it.
   *
   * The second term only bites on a short screen, where two 16:9 banners at
   * full width would push the header off the top. There the pair shrinks
   * together and stays centred, which is the one thing this layout may never
   * do without: show both halves of a two-way choice.
   */
  /*
   * The wordmark scales with the phone rather than being one number.
   *
   * At 176 it is right on a 430pt screen and 55% of the width of a 320pt one,
   * where the header has 200pt to fit a mark, a question and a line under it
   * — and a status bar inset on top of that. Tying it to the width keeps the
   * proportion instead of the measurement.
   */
  const markWidth = Math.min(176, width * 0.42);

  const inset = space[4];
  const artWidth = Math.min(width - inset * 2, (((height - 200) / 2 - inset * 2) * 16) / 9);
  const artHeight = (artWidth * 9) / 16;

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={{ flex: 1, backgroundColor: color.surfaceCard }}>
        {/*
          The header takes whatever the two panels leave, and fills it rather
          than floating in it.
          
          A 16:9 banner on a portrait phone is 224pt tall, so two of them
          occupy a little over half the screen and no amount of layout will
          make them occupy more without cropping them. That leaves roughly
          300pt above, which is too much for a caption and exactly right for a
          title: the wordmark at brand size with the question under it reads as
          the top of a page, where the same block at caption size read as a
          label stranded in white.
        */}
        <Enter delay={0} style={{ flex: 1, justifyContent: 'center' }}>
          <View
            style={{
              alignItems: 'center',
              paddingHorizontal: space[5],
              gap: space[2],
            }}
          >
            <JibliWordmark width={markWidth} tint={color.brand} pinTint={palette.white} />
            <Text variant="h1" style={{ marginTop: space[4] }}>
              شنو تريد اليوم؟
            </Text>
            <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
              اختر القسم، وتقدر ترجع تبدّله بأي وقت
            </Text>
          </View>
        </Enter>

        {HALVES.map((half, index) => {
          const art = artwork(half.type);

          return (
            <Enter key={half.type} delay={90 + index * 90}>
              <Pressable
                onPress={() => enter(half.type)}
                accessibilityRole="button"
                accessibilityLabel={`${half.label} — ${half.caption}`}
                style={({ pressed }) => [
                  { height: artHeight + inset * 2 },
                  pressed ? { opacity: 0.94 } : null,
                ]}
              >
                <LinearGradient
                  colors={[...half.gradient]}
                  // Diagonal: a vertical fade reads as a flat panel that
                  // happens to be two colours.
                  start={{ x: 1, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {art.url ? (
                    /*
                      The shadow is on the wrapper and the corner is on both.
                      iOS draws no shadow for a view that clips its children,
                      so the two cannot share one element: the outer view casts
                      and the image rounds.
                    */
                    <View
                      style={{
                        width: artWidth,
                        height: artHeight,
                        borderRadius: radius['2xl'],
                        ...shadow.md,
                      }}
                    >
                      <Image
                        source={{ uri: art.url }}
                        style={{ width: '100%', height: '100%', borderRadius: radius['2xl'] }}
                        resizeMode="cover"
                      />
                    </View>
                  ) : art.known ? (
                    /*
                     * Words, for a section with no banner scheduled.
                     *
                     * Two coloured bands with nothing in them is not a choice
                     * anybody can make, so the panel falls back to saying what
                     * it is — the same trade the home screen's banner makes in
                     * the other direction.
                     */
                    <View
                      style={{
                        width: artWidth,
                        height: artHeight,
                        justifyContent: 'center',
                        gap: space[2],
                        paddingHorizontal: space[5],
                      }}
                    >
                      <View
                        style={{
                          flexDirection: 'row-reverse',
                          alignItems: 'center',
                          gap: space[3],
                        }}
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
                    </View>
                  ) : null}
                </LinearGradient>
              </Pressable>
            </Enter>
          );
        })}
      </View>
    </Screen>
  );
}
