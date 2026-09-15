import { Image, Pressable, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { MerchantType } from '@jibli/contracts';
import { api, assetUrl } from '@/lib/api';
import { useVertical } from '@/lib/vertical';
import { color, palette, space, text } from '@/theme';
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
  const { height } = useWindowDimensions();

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
          const art = artwork(half.type);

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
                  /*
                   * The artwork is wider than the panel is tall, so it lands as
                   * a band across the middle with the section's colour above
                   * and below it. Filling the panel instead would crop about a
                   * third off the sides, and these are designed 16:9 pieces
                   * composed left to right — that third is where half the
                   * design lives.
                   */
                  style={{ flex: 1, justifyContent: 'center', overflow: 'hidden' }}
                >
                  {art.url ? (
                    <Image
                      source={{ uri: art.url }}
                      style={{ width: '100%', aspectRatio: 16 / 9 }}
                      resizeMode="cover"
                    />
                  ) : art.known ? (
                    /*
                     * Words, for a section with no banner scheduled.
                     *
                     * Two coloured bands with nothing in them is not a choice
                     * anybody can make, so the panel falls back to saying what
                     * it is — the same trade the home screen's banner makes in
                     * the other direction.
                     */
                    <View style={{ gap: space[2], paddingHorizontal: space[5] }}>
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
