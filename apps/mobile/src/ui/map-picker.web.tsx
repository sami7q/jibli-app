import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { MAP_PICKER_HTML, type MapPickerMessage } from './map-picker-html';
import { color, radius } from '@/theme';
import { isSamePoint, type MapPickerProps } from './map-picker-shared';

/**
 * The same map, in a browser.
 *
 * `react-native-webview` has no web implementation, and Metro resolves this
 * file instead on that platform — so the preview gets a real iframe holding the
 * identical document rather than a grey box where a reviewer cannot judge the
 * one screen this feature is about.
 *
 * `srcdoc` rather than a blob or a data URL: the document is inline and never
 * touches the network to load itself.
 */
export function MapPicker({ latitude, longitude, onPick, height = 280 }: MapPickerProps) {
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);

  // Built once; see the native picker for why a rebuild per position was wrong.
  const [html] = useState(() => MAP_PICKER_HTML(latitude ?? null, longitude ?? null));
  const lastReported = useRef<{ latitude: number; longitude: number } | null>(
    latitude != null && longitude != null ? { latitude, longitude } : null,
  );

  /*
   * Messages from the frame. Filtered by source rather than by origin: a
   * `srcdoc` iframe reports its origin as "null", so the check that means
   * something is «did this come from the frame I created».
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      try {
        const payload = JSON.parse(String(event.data)) as MapPickerMessage;
        if (payload.type === 'ready') setReady(true);
        else if (payload.type === 'pick') {
          const point = { latitude: payload.latitude, longitude: payload.longitude };
          lastReported.current = point;
          onPick(point);
        }
      } catch {
        /* Not ours. The page carries other messages. */
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onPick]);

  // A position from outside moves the map in place.
  useEffect(() => {
    if (!ready || latitude == null || longitude == null) return;
    const next = { latitude, longitude };
    if (isSamePoint(lastReported.current, next)) return;
    lastReported.current = next;
    frame.current?.contentWindow?.postMessage(JSON.stringify({ type: 'center', ...next }), '*');
  }, [ready, latitude, longitude]);

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
        style={{ border: 0, width: '100%', height: '100%', display: 'block' }}
        // The document is ours and inline; it needs scripts to be a map at all.
        sandbox="allow-scripts"
      />

      {!ready ? (
        <View
          pointerEvents="none"
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
