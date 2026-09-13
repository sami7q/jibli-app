import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { color, palette } from '@/theme';

/**
 * The wordmark.
 *
 * Transcribed from the design comp's vector rather than approximated with a
 * bold font: the J's dot is a location pin, which is the whole idea of the
 * mark — «جيبلي», bring it to me — and a text approximation loses exactly
 * that.
 *
 * Drawn on a 340×160 canvas; `width` scales the whole thing.
 */
export function JibliWordmark({
  width = 220,
  tint = palette.white,
  pinTint = color.brand,
}: {
  width?: number;
  /** The letterforms. White on the brand ground, brand on white. */
  tint?: string;
  /** The dot inside the pin — it has to match whatever is behind the mark. */
  pinTint?: string;
}) {
  const height = (width * 160) / 340;

  return (
    <Svg width={width} height={height} viewBox="0 0 340 160" accessibilityLabel="Jibli">
      {/* J — the pin is its dot */}
      <G>
        <Path
          d="M 58 48 C 58 35.85 67.85 26 80 26 C 92.15 26 102 35.85 102 48 C 102 59.5 86 78 80 84 C 74 78 58 59.5 58 48 Z"
          fill={tint}
        />
        <Circle cx={80} cy={47} r={6.5} fill={pinTint} />
        <Path
          d="M 72 88 L 88 88 L 88 120 C 88 136 76 148 56 148 C 36 148 24 135 24 122 C 24 116.5 28.5 112 34 112 C 39.5 112 43 116 48 120 C 51 122.5 55 124 59 124 C 67 124 72 118 72 110 L 72 88 Z"
          fill={tint}
        />
      </G>

      {/* i */}
      <G>
        <Circle cx={118} cy={62} r={9} fill={tint} />
        <Rect x={109} y={80} width={18} height={65} rx={9} fill={tint} />
      </G>

      {/* b */}
      <G>
        <Rect x={144} y={30} width={18} height={115} rx={9} fill={tint} />
        <Path
          d="M 160 81 C 168 76 178 73 190 73 C 213 73 229 90 229 113 C 229 135 212 150 188 150 C 176 150 166 145 158 138 L 158 81 Z M 162 113 C 162 125 172 133 186 133 C 199 133 210 124 210 112 C 210 99 199 90 186 90 C 172 90 162 99 162 113 Z"
          fill={tint}
          fillRule="evenodd"
        />
      </G>

      {/* l */}
      <Rect x={245} y={30} width={18} height={115} rx={9} fill={tint} />

      {/* i */}
      <G>
        <Circle cx={288} cy={62} r={9} fill={tint} />
        <Rect x={279} y={80} width={18} height={65} rx={9} fill={tint} />
      </G>
    </Svg>
  );
}

/**
 * The pin on its own — for a header, a tab bar, an empty state.
 */
export function JibliPin({ size = 24, tint = palette.white, pinTint = color.brand }) {
  return (
    <Svg width={size} height={size} viewBox="50 18 60 74">
      <Path
        d="M 58 48 C 58 35.85 67.85 26 80 26 C 92.15 26 102 35.85 102 48 C 102 59.5 86 78 80 84 C 74 78 58 59.5 58 48 Z"
        fill={tint}
      />
      <Circle cx={80} cy={47} r={6.5} fill={pinTint} />
    </Svg>
  );
}
