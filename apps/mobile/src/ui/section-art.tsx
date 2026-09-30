import { StyleSheet } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Pattern,
  Rect,
  Stop,
} from 'react-native-svg';
import type { Section } from '@/lib/sections';
import { palette } from '@/theme';

/**
 * The chooser's pictures, drawn rather than uploaded.
 *
 * The chooser used to show each section's storefront banner in the picture
 * slot, so the page only looked finished once an operator had uploaded three
 * pieces of artwork — and the day one of them was missing, a lone glyph on a
 * tinted square sat beside two photographs. A drawing has no missing state:
 * it is the same three pictures on the first launch and the thousandth, it
 * costs no bytes in the bundle because `react-native-svg` is already here for
 * the wordmark, and it is in the section's own ramp, so a card and its picture
 * are one colour rather than a photograph fighting a coloured ground.
 *
 * Three scenes, one family. Each is the most recognisable still life of its
 * section — a set table, a bag of groceries, a dressing table — drawn front-on
 * on the same 100×120 canvas, lit from above, with the same white halo behind
 * the subject. The rules are the ones `DishPlaceholder` follows for a missing
 * item photograph; this is that idea at poster size.
 *
 * The canvas is taller than it is wide because the slot is. Drawn with
 * «slice», so the ground always fills the slot whatever the phone's height
 * makes of the card; anything that must stay visible sits inside x 9–91 and
 * y 9–111, which is what survives the tallest and the squarest crop.
 */
type Ramp = Section['ramp'];

const WHITE = palette.white;

export function SectionArt({ section }: { section: Section }) {
  const { ramp, type } = section;
  const skyId = `sky-${type}`;

  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 100 120"
      preserveAspectRatio="xMidYMid slice"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        {/* The ground: a step lighter than the card, so the slot reads as a lit window. */}
        <LinearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={ramp[400]} />
          <Stop offset="1" stopColor={ramp[600]} />
        </LinearGradient>
      </Defs>
      <Rect x="-20" y="-20" width="140" height="160" fill={`url(#${skyId})`} />

      {/* The halo behind the subject: two soft rings, the same on every card. */}
      <Circle cx="50" cy="72" r="52" fill={WHITE} opacity="0.05" />
      <Circle cx="50" cy="72" r="40" fill={WHITE} opacity="0.07" />

      {type === 'MARKET' ? (
        <GroceryBag ramp={ramp} />
      ) : type === 'COSMETICS' ? (
        <DressingTable ramp={ramp} />
      ) : (
        <SetTable ramp={ramp} />
      )}
    </Svg>
  );
}

/**
 * A plate of something hot between a fork and a knife.
 *
 * The plate carries a mound of rice with a piece on top — mandi, the local
 * default — rather than a burger or a pizza, which would each promise one kind
 * of restaurant. Three curls of steam say «hot» without saying what.
 */
function SetTable({ ramp }: { ramp: Ramp }) {
  return (
    <>
      {/* Steam: the middle curl rises highest, so the three read as one plume. */}
      {[40, 50, 60].map((x, index) => (
        <Path
          key={x}
          d={`M${x} 42 C${x - 4} 36 ${x + 4} 32 ${x} 26 C${x - 4} 20 ${x + 4} 17 ${x} ${
            index === 1 ? 11 : 15
          }`}
          fill="none"
          stroke={WHITE}
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity={index === 1 ? 0.85 : 0.6}
        />
      ))}

      {/* The plate: rim, a fine inner ring, and the well. */}
      <Circle cx="50" cy="74" r="28" fill={WHITE} />
      <Circle cx="50" cy="74" r="25" fill="none" stroke={ramp[200]} strokeWidth="1" />
      <Circle cx="50" cy="74" r="22" fill={ramp[100]} />

      {/* Rice, two pieces on top, and a scatter of herbs. */}
      <Ellipse cx="50" cy="76" rx="16" ry="10" fill={ramp[300]} />
      <Rect
        x="41"
        y="66"
        width="18"
        height="9"
        rx="4"
        fill={ramp[600]}
        transform="rotate(-12 50 70.5)"
      />
      <Rect
        x="51"
        y="72"
        width="12"
        height="7"
        rx="3.5"
        fill={ramp[700]}
        transform="rotate(8 57 75.5)"
      />
      <Circle cx="39" cy="79" r="1.6" fill={ramp[800]} />
      <Circle cx="46" cy="83" r="1.4" fill={ramp[800]} />
      <Circle cx="60" cy="83" r="1.6" fill={ramp[800]} />

      {/* The fork: three tines, a base, a handle. */}
      <G fill={WHITE} opacity="0.92">
        <Rect x="10" y="52" width="2.2" height="11" rx="1.1" />
        <Rect x="14.4" y="52" width="2.2" height="11" rx="1.1" />
        <Rect x="18.8" y="52" width="2.2" height="11" rx="1.1" />
        <Rect x="10" y="60" width="11" height="8" rx="3.5" />
        <Rect x="13.3" y="66" width="4.4" height="30" rx="2.2" />
      </G>

      {/* The knife: a curved blade and a handle. */}
      <G fill={WHITE} opacity="0.92">
        <Path d="M80 52 h4.4 c4 7 4 15 0 21 h-4.4 z" />
        <Rect x="80" y="71" width="4.4" height="25" rx="2.2" />
      </G>
    </>
  );
}

/**
 * A paper bag with the shopping standing up in it.
 *
 * Two leaves, a loaf and a round fruit — greens, bread and fruit are what a
 * grocery bag shows at the top, and in a green ramp the leaves are the
 * darkest thing in the picture, which is where the eye should land.
 */
function GroceryBag({ ramp }: { ramp: Ramp }) {
  return (
    <>
      {/* A leaf on the left, veined. */}
      <Path d="M38 62 C28 52 30 34 44 28 C50 40 48 54 38 62 Z" fill={ramp[800]} />
      <Path
        d="M39 60 C40 50 42 42 44 32"
        fill="none"
        stroke={ramp[500]}
        strokeWidth="1.4"
        strokeLinecap="round"
      />

      {/* A loaf behind, leaning right, scored three times. */}
      <G transform="rotate(12 52 44)">
        <Rect x="47" y="18" width="10" height="46" rx="5" fill={WHITE} opacity="0.92" />
        <Path
          d="M49 26 l6 3 M49 34 l6 3 M49 42 l6 3"
          fill="none"
          stroke={ramp[300]}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </G>

      {/* A leaf on the right. */}
      <Path d="M62 62 C74 54 74 38 62 30 C52 38 52 54 62 62 Z" fill={ramp[700]} />
      <Path
        d="M62 60 C63 50 63 40 62 33"
        fill="none"
        stroke={ramp[400]}
        strokeWidth="1.4"
        strokeLinecap="round"
      />

      {/* A round fruit in front, with a stem and a highlight. */}
      <Path
        d="M68 47 q2 -3 4 -3"
        fill="none"
        stroke={ramp[800]}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <Circle cx="68" cy="56" r="9" fill={ramp[300]} />
      <Circle cx="65" cy="53" r="2.5" fill={WHITE} opacity="0.8" />

      {/* The bag, in front of everything: body, crease, handle, and a leaf mark. */}
      <Path d="M24 60 H76 L72 102 Q72 106 68 106 H32 Q28 106 28 102 Z" fill={WHITE} />
      <Path d="M26 70 H74" fill="none" stroke={ramp[100]} strokeWidth="1.5" />
      <Path
        d="M40 66 V63 A10 10 0 0 1 60 63 V66"
        fill="none"
        stroke={ramp[600]}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <Circle cx="50" cy="86" r="7" fill={ramp[100]} />
      <Path d="M50 90 C45 86 46 80 50 79 C54 80 55 86 50 90 Z" fill={ramp[500]} />
    </>
  );
}

/**
 * A lipstick leaning against a flask of perfume, with a few sparkles.
 *
 * The two objects everyone recognises as «beauty» from across the room. The
 * sparkles are the cosmetics section's signature, as the fork is the
 * restaurant's — the same four-point star the card's texture is tiled with.
 */
function DressingTable({ ramp }: { ramp: Ramp }) {
  return (
    <>
      <Path d={sparkle(20, 26, 5)} fill={WHITE} opacity="0.9" />
      <Path d={sparkle(80, 20, 3.5)} fill={WHITE} opacity="0.7" />
      <Path d={sparkle(84, 92, 4)} fill={WHITE} opacity="0.6" />
      <Circle cx="30" cy="14" r="1.5" fill={WHITE} opacity="0.5" />
      <Circle cx="14" cy="100" r="1.2" fill={WHITE} opacity="0.5" />

      {/* The flask, behind: cap, neck, body, the perfume inside it, a label. */}
      <Rect x="61" y="34" width="16" height="14" rx="4" fill={ramp[800]} />
      <Rect x="65" y="47" width="8" height="7" fill={ramp[200]} />
      <Rect x="52" y="53" width="34" height="48" rx="9" fill={WHITE} opacity="0.95" />
      <Rect x="56" y="72" width="26" height="25" rx="6" fill={ramp[300]} />
      <Rect x="59" y="75" width="4" height="15" rx="2" fill={WHITE} opacity="0.6" />
      <Rect x="62" y="60" width="14" height="7" rx="2" fill={ramp[100]} />

      {/* The lipstick, in front and leaning: case, band, collar, bullet, shine. */}
      <G transform="rotate(-8 34 80)">
        <Rect x="25" y="70" width="18" height="36" rx="3" fill={ramp[800]} />
        <Rect x="25" y="84" width="18" height="3" fill={ramp[600]} />
        <Rect x="26.5" y="62" width="15" height="9" rx="1.5" fill={WHITE} />
        <Path d="M29 62 V44 L39 38 V62 Z" fill={ramp[400]} />
        <Rect x="31" y="45" width="2" height="13" rx="1" fill={WHITE} opacity="0.55" />
      </G>
    </>
  );
}

/**
 * A four-point star with curved sides, centred on (cx, cy) and r tall.
 *
 * Four quadratic curves through the centre: the concave sides are what make it
 * read as a glint rather than a compass rose.
 */
function sparkle(cx: number, cy: number, r: number): string {
  return [
    `M${cx} ${cy - r}`,
    `Q${cx} ${cy} ${cx + r} ${cy}`,
    `Q${cx} ${cy} ${cx} ${cy + r}`,
    `Q${cx} ${cy} ${cx - r} ${cy}`,
    `Q${cx} ${cy} ${cx} ${cy - r}`,
    'Z',
  ].join(' ');
}

/**
 * The texture laid over the whole card, one motif per section.
 *
 * Dots for food, a lattice for the market, sparkles for cosmetics — faint
 * enough to be felt rather than seen, so the card stops being a flat block of
 * colour without the text having to compete with anything. Tiled by the
 * renderer from one small motif, so it costs the same whatever the card's
 * size, and absolutely positioned so it never takes part in the layout.
 */
export function SectionTexture({ section }: { section: Section }) {
  const id = `tile-${section.type}`;
  const tile = TILES[section.type];

  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Pattern id={id} patternUnits="userSpaceOnUse" width={tile.size} height={tile.size}>
          {tile.motif}
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

const TILES: Readonly<Record<Section['type'], { size: number; motif: React.ReactNode }>> = {
  RESTAURANT: {
    size: 18,
    motif: (
      <>
        <Circle cx="3" cy="3" r="1.3" fill={WHITE} opacity="0.14" />
        <Circle cx="12" cy="12" r="1.3" fill={WHITE} opacity="0.14" />
      </>
    ),
  },
  MARKET: {
    size: 16,
    motif: (
      <Path d="M0 8 L8 0 L16 8 L8 16 Z" fill="none" stroke={WHITE} strokeWidth="1" opacity="0.11" />
    ),
  },
  COSMETICS: {
    size: 26,
    motif: (
      <>
        <Path d={sparkle(7, 7, 3)} fill={WHITE} opacity="0.16" />
        <Circle cx="20" cy="19" r="1" fill={WHITE} opacity="0.2" />
      </>
    ),
  },
};
