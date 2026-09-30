import { useRef } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { applyLayoutDirection } from '@/theme';

/**
 * Measures which way the native layer lays out a row, and tells the theme.
 *
 * Rendered by the root for the life of the app, invisible and a point tall.
 * Two boxes in a `flexDirection: 'row'` — the one raw row in the app, and the
 * reason the rule against them exists — and the first box reports where it
 * landed: at zero the platform draws left-to-right; anywhere else it has
 * mirrored the row.
 *
 * Measured rather than read off `I18nManager.isRTL`, because the flag and the
 * layout have been seen to disagree — see the note above `ROW` in the theme.
 * The measurement is the layout itself, so it cannot.
 *
 * It stays mounted, and it reports every change, not only the first answer.
 * After a JavaScript reload — a code change in development, `reloadAsync`
 * from expo-updates in production — the new surface has been seen to lay its
 * first frame out left-to-right and mirror on the next, so a probe that
 * answered once and left would have pinned the whole app the wrong way round
 * on top of a layout that then flipped. The root treats a changed answer as a
 * reason to draw everything again.
 */
export function DirectionProbe({ onMeasured }: { onMeasured: (mirrored: boolean) => void }) {
  const last = useRef<boolean | null>(null);

  const report = (event: LayoutChangeEvent) => {
    const mirrored = event.nativeEvent.layout.x > 0;
    if (last.current === mirrored) return;
    last.current = mirrored;

    applyLayoutDirection(mirrored);
    onMeasured(mirrored);
  };

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        width: PROBE_WIDTH,
        height: 1,
        opacity: 0,
        flexDirection: 'row',
      }}
    >
      <View style={{ width: PROBE_WIDTH / 2, height: 1 }} onLayout={report} />
      <View style={{ width: PROBE_WIDTH / 2, height: 1 }} />
    </View>
  );
}

const PROBE_WIDTH = 100;
