import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { accent, currentSection } from '@/theme';

/**
 * What an item with no photograph looks like.
 *
 * Most merchants are approved with a catalogue and no images — photographing
 * forty items is the last thing an owner does, and often never — so this is
 * not an edge case, it is most of the list on most days. A single glyph on a
 * tinted square was honest about that and made the list read as broken: forty
 * identical grey marks down the screen.
 *
 * Drawn rather than bundled. A photograph would be a lie about an item nobody
 * has seen, a stock image would be a lie about this merchant, and either would
 * be a binary in the repository that someone has to license. This is the most
 * neutral true thing about the item — a plate in a restaurant, a package in a
 * market — in whichever half's colours are current, and it costs no bytes in
 * the bundle because `react-native-svg` is already here for the wordmark.
 *
 * The seed varies the arrangement. Identical placeholders in a vertical list
 * read as a rendering fault; a plate whose garnish sits differently reads as a
 * plate. Derived from the item's id, so an item looks the same every time it
 * is opened rather than reshuffling on each render.
 */
export function DishPlaceholder({
  size = 88,
  seed = '',
}: {
  size?: number;
  /** Anything stable per item — its id. Same seed, same arrangement. */
  seed?: string;
}) {
  // A small deterministic hash: enough spread for three variants, and stable
  // across renders because the input is.
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 997;
  }

  const variant = hash % 3;
  const tilt = ((hash % 7) - 3) * 2;
  const market = currentSection() === 'MARKET';

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      accessibilityLabel={market ? 'صورة المنتج' : 'صورة الطبق'}
    >
      <Rect x="0" y="0" width="100" height="100" fill={accent[50]} />

      {market ? (
        <MarketGoods variant={variant} tilt={tilt} />
      ) : (
        <PlatedDish variant={variant} tilt={tilt} />
      )}
    </Svg>
  );
}

/** A plate seen from above, with something on it. */
function PlatedDish({ variant, tilt }: { variant: number; tilt: number }) {
  return (
    <>
      {/* The plate: rim, then the well inside it. */}
      <G transform={`rotate(${tilt} 50 52)`}>
        <Circle cx="50" cy="52" r="30" fill={accent[100]} />
        <Circle cx="50" cy="52" r="23" fill={accent[200]} />

        {variant === 0 ? (
          <>
            {/* A bowl of something with two garnishes. */}
            <Ellipse cx="50" cy="52" rx="15" ry="13" fill={accent[300]} />
            <Circle cx="44" cy="47" r="3.2" fill={accent[100]} />
            <Circle cx="56" cy="55" r="2.4" fill={accent[100]} />
          </>
        ) : variant === 1 ? (
          <>
            {/* Something stacked — a sandwich seen from above. */}
            <Rect x="35" y="43" width="30" height="18" rx="7" fill={accent[300]} />
            <Rect x="39" y="48" width="22" height="3" rx="1.5" fill={accent[100]} />
          </>
        ) : (
          <>
            {/* Grains with a piece on top — mandi, the local default. */}
            <Ellipse cx="50" cy="56" rx="17" ry="10" fill={accent[300]} />
            <Ellipse cx="50" cy="47" rx="9" ry="6.5" fill={accent[400]} />
          </>
        )}
      </G>

      {/*
       * A fork, low-contrast and to one side.
       *
       * It says "food" without competing with the plate. At 88px the tines are
       * a couple of pixels each, which is why they are one rounded path rather
       * than three strokes that would alias into a smudge.
       */}
      <Path
        d="M19 30 v14 a4 4 0 0 0 4 4 h1 v22 a2.5 2.5 0 0 0 5 0 V48 h1 a4 4 0 0 0 4-4 V30 h-2.5 v13 h-2 V30 h-2.5 v13 h-2 V30 h-2.5 v13 h-2 V30 z"
        fill={accent[200]}
      />
    </>
  );
}

/**
 * Something packaged, seen from the front.
 *
 * A market's items are not plated — a carton of milk, a tin, a bag of rice —
 * and the plate that reads as "a dish we have no photograph of" reads as a
 * mistake next to a bottle of detergent. Three shapes cover most of an aisle
 * without claiming to be any particular product.
 *
 * Front-on rather than from above, which is the other half of the difference:
 * food photography looks down at a plate and packaging photography looks
 * straight at a label.
 */
function MarketGoods({ variant, tilt }: { variant: number; tilt: number }) {
  return (
    <>
      {/* The shelf it stands on: a grounding line, not an object. */}
      <Rect x="32" y="76" width="36" height="3" rx="1.5" fill={accent[200]} />

      <G transform={`rotate(${tilt * 0.4} 50 54)`}>
        {variant === 0 ? (
          <>
            {/* A tin — tomato paste, beans, the back of every kitchen. */}
            <Rect x="37" y="36" width="26" height="38" rx="3" fill={accent[200]} />
            <Ellipse cx="50" cy="36" rx="13" ry="4" fill={accent[300]} />
            <Rect x="37" y="48" width="26" height="14" fill={accent[100]} />
          </>
        ) : variant === 1 ? (
          <>
            {/* A sack with a cinched top — rice, flour, sugar. */}
            <Path d="M34 46 q16 -7 32 0 v20 q0 8 -8 8 h-16 q-8 0 -8 -8 z" fill={accent[200]} />
            <Path d="M40 41 q10 -5 20 0 l-3 6 q-7 -3 -14 0 z" fill={accent[300]} />
            <Rect x="42" y="54" width="16" height="11" rx="2" fill={accent[100]} />
          </>
        ) : (
          <>
            {/* A bottle — oil, water, a cleaner. */}
            <Rect x="46" y="26" width="8" height="8" rx="2" fill={accent[300]} />
            <Path
              d="M44 34 h12 q7 6 7 14 v20 q0 6 -6 6 h-14 q-6 0 -6 -6 v-20 q0 -8 7 -14 z"
              fill={accent[200]}
            />
            <Rect x="42" y="50" width="16" height="12" rx="2" fill={accent[100]} />
          </>
        )}
      </G>

      {/*
       * A basket, low-contrast and to one side — the market's answer to the
       * fork, and held to the same rules: narrow enough to clear the goods in
       * the middle, and quiet enough that it never becomes the subject. One
       * arc for the handle rather than two strokes, which at 88px read as
       * horns rather than a handle.
       */}
      <Path
        d="M13 40 h20 l-2.5 20 a3.5 3.5 0 0 1 -3.5 3 h-8 a3.5 3.5 0 0 1 -3.5 -3 z"
        fill="none"
        stroke={accent[200]}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <Path
        d="M17.5 40 a5.5 5.5 0 0 1 11 0"
        fill="none"
        stroke={accent[200]}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </>
  );
}
