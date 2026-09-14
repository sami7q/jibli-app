import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { MAP_PICKER_HTML, type MapPickerMessage } from './map-picker-html';
import { color, radius } from '@/theme';

/**
 * A real map to put a pin on, on a device.
 *
 * ADR-0005 said no in-app map, and the reasoning was sound at the time: a map
 * SDK means a Google or Mapbox key, a billing account and a geocoder, none of
 * which makes a delivery arrive faster in a city where addresses are
 * landmarks. What it did not weigh is that a landmark address plus *no* point
 * leaves a courier guessing, and «قرب صيدلية النور» is only unambiguous to
 * somebody who already knows the street.
 *
 * So: Leaflet and OpenStreetMap tiles inside a WebView. No key, no billing
 * account, no SDK in the binary — a hundred lines of HTML and a tile server
 * that has served the world's maps for twenty years. The web preview renders
 * the same document directly (`map-picker.web.tsx`), so what a reviewer sees
 * in a browser is the map the phone draws.
 *
 * It picks a point and reports it back. It does not geocode, search, or route;
 * the driver's own maps app does the routing, and it is better at it.
 */

export interface MapPickerProps {
  /** Where to open. Falls back to the centre of Baghdad. */
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly onPick: (coordinates: { latitude: number; longitude: number }) => void;
  readonly height?: number;
}

export function MapPicker({ latitude, longitude, onPick, height = 260 }: MapPickerProps) {
  const [ready, setReady] = useState(false);
  const webview = useRef<WebView>(null);

  const html = useMemo(
    () => MAP_PICKER_HTML(latitude ?? null, longitude ?? null),
    [latitude, longitude],
  );

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
      <WebView
        ref={webview}
        originWhitelist={['*']}
        source={{ html }}
        onLoadEnd={() => setReady(true)}
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data) as MapPickerMessage;
            if (payload.type === 'pick') {
              onPick({ latitude: payload.latitude, longitude: payload.longitude });
            }
          } catch {
            /* A message this component did not send. */
          }
        }}
        // The map is the gesture surface; letting the sheet scroll under a
        // finger that is dragging the map is how a pin ends up in the wrong
        // street.
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled={false}
        /*
         * Every tile policy worth reading asks an application to identify
         * itself, so that an operator with a problem has somebody to contact
         * before they block a whole address range. A WebView otherwise sends
         * the system browser's string and nothing says Jibli.
         */
        userAgent="Jibli/1.0 (+https://jibli.iq; delivery app; map picker)"
        style={{ flex: 1, backgroundColor: 'transparent' }}
      />

      {!ready ? (
        <View
          style={{
            ...StyleSheetAbsoluteFill,
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

/** Spelled out rather than imported: one object, used once. */
const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};
