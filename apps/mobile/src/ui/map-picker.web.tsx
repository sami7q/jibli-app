import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { MAP_PICKER_HTML, type MapPickerMessage } from './map-picker-html';
import { color, radius } from '@/theme';
import type { MapPickerProps } from './map-picker';

/**
 * The same map, in a browser.
 *
 * `react-native-webview` has no web implementation, and Metro resolves this
 * file instead on that platform — so the preview gets a real iframe holding the
 * identical document rather than a grey box where a reviewer cannot judge the
 * one screen this feature is about.
 *
 * `srcdoc` rather than a blob or a data URL: the document is inline, it never
 * touches the network to load itself, and the iframe stays same-origin-ish
 * enough for `postMessage` to reach back with an origin this page can check.
 */
export function MapPicker({ latitude, longitude, onPick, height = 260 }: MapPickerProps) {
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);

  const html = useMemo(
    () => MAP_PICKER_HTML(latitude ?? null, longitude ?? null),
    [latitude, longitude],
  );

  /*
   * The picked point arrives as a window message.
   *
   * Filtered by source rather than by origin: a `srcdoc` iframe reports its
   * origin as "null", so the check that means something here is «did this come
   * from the frame I created», which is exactly what `event.source` answers.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (frame.current && event.source !== frame.current.contentWindow) return;
      try {
        const payload = JSON.parse(String(event.data)) as MapPickerMessage;
        if (payload.type === 'pick') {
          onPick({ latitude: payload.latitude, longitude: payload.longitude });
        }
      } catch {
        /* Not ours. The page carries other messages. */
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onPick]);

  return (
    <View
      style={{
        height,
        borderRadius: radius.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: color.borderSubtle,
        backgroundColor: color.surfaceSunken,
      }}
    >
      <iframe
        ref={frame}
        title="اختيار الموقع على الخريطة"
        srcDoc={html}
        onLoad={() => setReady(true)}
        style={{ border: 0, width: '100%', height: '100%', display: 'block' }}
        // The document is ours and inline; it needs scripts to be a map at all.
        sandbox="allow-scripts"
      />

      {!ready ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color.surfaceSunken,
          }}
        >
          <ActivityIndicator color={color.brand} />
        </View>
      ) : null}
    </View>
  );
}
