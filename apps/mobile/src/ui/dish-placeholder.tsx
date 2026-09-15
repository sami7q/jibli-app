import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { palette } from '@/theme';

/**
 * What a dish with no photograph looks like.
 *
 * Most restaurants are approved with a menu and no images — photographing
 * forty items is the last thing an owner does, and often never — so this is
 * not an edge case, it is most of the menu on most days. A single
 * fork-and-knife glyph on a tinted square was honest about that and made the
 * list read as broken: forty identical grey marks down the screen.
 *
 * Drawn rather than bundled. A photograph would be a lie about a dish nobody
 * has seen, a stock image would be a lie about this restaurant, and either
 * would be a binary in the repository that someone has to license. This is a
 * plate — the most neutral true thing about any dish — in the brand's own
 * colours, and it costs no bytes in the bundle because `react-native-svg` is
 * already here for the wordmark.
 *
 * The seed varies the arrangement. Identical placeholders in a vertical list
 * read as a rendering fault; a plate whose garnish sits differently reads as a
 * plate. Derived from the item's id, so a dish looks the same every time it is
 * opened rather than reshuffling on each render.
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

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="صورة الطبق">
      <Rect x="0" y="0" width="100" height="100" fill={palette.orange[50]} />

      {/* The plate: rim, then the well inside it. */}
      <G transform={`rotate(${tilt} 50 52)`}>
        <Circle cx="50" cy="52" r="30" fill={palette.orange[100]} />
        <Circle cx="50" cy="52" r="23" fill={palette.orange[200]} />

        {variant === 0 ? (
          <>
            {/* A bowl of something with two garnishes. */}
            <Ellipse cx="50" cy="52" rx="15" ry="13" fill={palette.orange[300]} />
            <Circle cx="44" cy="47" r="3.2" fill={palette.orange[100]} />
            <Circle cx="56" cy="55" r="2.4" fill={palette.orange[100]} />
          </>
        ) : variant === 1 ? (
          <>
            {/* Something stacked — a sandwich seen from above. */}
            <Rect x="35" y="43" width="30" height="18" rx="7" fill={palette.orange[300]} />
            <Rect x="39" y="48" width="22" height="3" rx="1.5" fill={palette.orange[100]} />
          </>
        ) : (
          <>
            {/* Grains with a piece on top — mandi, the local default. */}
            <Ellipse cx="50" cy="56" rx="17" ry="10" fill={palette.orange[300]} />
            <Ellipse cx="50" cy="47" rx="9" ry="6.5" fill={palette.orange[400]} />
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
        fill={palette.orange[200]}
      />
    </Svg>
  );
}
