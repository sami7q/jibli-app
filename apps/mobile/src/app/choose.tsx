import { useEffect, useState } from 'react';
import { Image as RNImage, Pressable, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { MerchantType } from '@jibli/contracts';
import { api, assetUrl } from '@/lib/api';
import { useVertical } from '@/lib/vertical';
import { ROW, color, palette, space, text } from '@/theme';
import { RemoteImage, Screen, Text } from '@/ui';
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

/**
 * How much of the top belongs to the mark and the question.
 *
 * A number rather than a flex share. The panels below want every point they
 * can get, and a header that grows with the screen would hand a tall phone's
 * extra height to the emptiest part of the page.
 */
const HEADER_HEIGHT = 188;

/**
 * The least air the pictures may leave, per gap.
 *
 * `space-evenly` shares out whatever is actually spare, so on a tall phone the
 * three gaps are far wider than this. It matters at the other end: on a short
 * one it is what stops the artwork from growing until the two pictures are
 * touching each other and the question above them.
 */
const GAP = 20;

/** After the last letter has landed: five at 70ms apart, plus the rise. */
const LETTERS_SETTLE = 4 * 70 + 160;

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

  /*
   * How tall each banner actually is, asked of the file rather than assumed.
   *
   * The first version hard-coded 16:9 because that is what the home screen
   * asks for, and it made this screen permanently 52% banner and 48% empty:
   * two landscape pictures cannot fill a portrait phone, and a layout built
   * around a constant cannot notice when a better-shaped file arrives.
   *
   * Measured, the panel grows to whatever it is given. Drop a squarer export
   * in for this slot and the two halves fill the screen; leave the 16:9 one
   * and nothing changes. `getSize` reads the header of an image the screen is
   * about to display anyway, so it costs a cache hit.
   *
   * React Native's own `Image` rather than `expo-image`, which draws every
   * picture in the app but has no equivalent static reader. Aliased so that it
   * is visibly not a render path — nothing on this screen paints through it.
   */
  const [ratios, setRatios] = useState<Partial<Record<MerchantType, number>>>({});

  const foodArt = artwork('RESTAURANT').url;
  const marketArt = artwork('MARKET').url;

  useEffect(() => {
    for (const [type, url] of [
      ['RESTAURANT', foodArt],
      ['MARKET', marketArt],
    ] as const) {
      if (!url) continue;
      RNImage.getSize(
        url,
        (w, h) => h > 0 && setRatios((current) => ({ ...current, [type]: w / h })),
        // A banner whose header will not parse still gets a panel; it just
        // gets the one 16:9 would have given it.
        () => undefined,
      );
    }
  }, [foodArt, marketArt]);

  const enter = (type: MerchantType) => {
    choose(type);
    router.replace('/(tabs)');
  };

  /*
   * The wordmark scales with the phone rather than being one number.
   *
   * At 176 it is right on a 430pt screen and 55% of the width of a 320pt one.
   * Tying it to the width keeps the proportion instead of the measurement.
   */
  const markWidth = Math.min(176, width * 0.44);

  /*
   * The panel is the picture. What the picture does not use is air.
   *
   * Two 16:9 banners are 484pt of a 932pt phone, and the 250pt left over was
   * briefly filled with the section's colour and its glyph across it. That was
   * worse than the hole it replaced: two large blocks of flat colour sitting
   * between the artwork, competing with the thing they were there to support.
   *
   * Air instead — between the pictures and around them, the page showing
   * through. They end up the only marked thing on the screen, which is what
   * makes a screen with two of them easy to read.
   *
   * Bounded by the shorter of the two because past a picture's natural height
   * it is being cropped, and neither half should be cropped for the other's
   * sake; and by the space itself, so a squarer export grows into the air
   * rather than pushing its other half off the bottom.
   */
  const naturalHeight = (type: MerchantType) => width / (ratios[type] ?? 16 / 9);
  const artHeight = Math.min(
    Math.max((height - HEADER_HEIGHT - GAP * 3) / 2, 120),
    naturalHeight('RESTAURANT'),
    naturalHeight('MARKET'),
  );

  return (
    <Screen edges={['top', 'bottom']} padded={false}>
      <View style={{ flex: 1, backgroundColor: color.surfaceCard }}>
        {/*
          The header is a fixed height at the top, not a flexible block that
          swallows the slack.

          Letting it flex put the mark a quarter of the way down the screen and
          the pictures below the middle, which is the wrong half of the page for
          both. Measured instead, everything sits where the eye starts and the
          leftover goes where leftover belongs: into the panels, as more of the
          section's own colour.

          The line under the question is gone. «اختر القسم» is what the
          question already asked, and the promise that it can be changed later
          is answered by the control on the next screen that changes it.
        */}
        <View
          style={{
            height: HEADER_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: space[5],
            gap: space[3],
          }}
        >
          <JibliWordmark animate width={markWidth} tint={color.brand} pinTint={palette.white} />
          <Enter delay={LETTERS_SETTLE}>
            <Text variant="h1">شنو تريد اليوم؟</Text>
          </Enter>
        </View>

        {/*
          The pair, with the same air above, between and below.

          `space-evenly` rather than a margin on each picture: the three gaps
          are then one decision instead of three, and on a screen that has more
          room than the pictures need, all three grow together rather than the
          leftover pooling at whichever end the layout happens to favour.
        */}
        <View style={{ flex: 1, justifyContent: 'space-evenly' }}>
          {HALVES.map((half, index) => {
            const art = artwork(half.type);

            return (
              <Enter key={half.type} delay={90 + index * 90}>
                <Pressable
                  onPress={() => enter(half.type)}
                  accessibilityRole="button"
                  accessibilityLabel={`${half.label} — ${half.caption}`}
                  style={({ pressed }) => [
                    { height: artHeight },
                    pressed ? { opacity: 0.94 } : null,
                  ]}
                >
                  <LinearGradient
                    colors={[...half.gradient]}
                    // Diagonal: a vertical fade reads as a flat panel that
                    // happens to be two colours.
                    start={{ x: 1, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={{ flex: 1, alignItems: 'center', overflow: 'hidden' }}
                  >
                    {art.url ? (
                      <RemoteImage
                        uri={art.url}
                        style={{ width: '100%', height: artHeight }}
                        priority="high"
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
                      <View
                        style={{
                          width: '100%',
                          height: artHeight,
                          justifyContent: 'center',
                          gap: space[2],
                          paddingHorizontal: space[5],
                        }}
                      >
                        <View
                          style={{
                            flexDirection: ROW,
                            alignItems: 'center',
                            gap: space[3],
                          }}
                        >
                          <MaterialCommunityIcons
                            name={half.icon}
                            size={28}
                            color={palette.white}
                          />
                          <Text style={{ ...text.display, color: palette.white }}>
                            {half.label}
                          </Text>
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
      </View>
    </Screen>
  );
}
