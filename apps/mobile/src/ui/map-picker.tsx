import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { MAP_PICKER_HTML, type MapPickerMessage } from './map-picker-html';
import { Text } from '@/ui';
import { color, radius, space } from '@/theme';

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
  /**
   * Whether the document failed to load at all.
   *
   * There was no error path here. `onLoadEnd` fires whether the load succeeded
   * or not, so an unreachable CDN or tile server cleared the spinner and left a
   * grey rectangle with no explanation — and the customer, who is mid-checkout
   * and has been asked to place a pin, has no way to know the map is broken
   * rather than slow. They wait, then give up on the order.
   */
  const [failed, setFailed] = useState(false);
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
        /*
         * `about:blank` and nothing else.
         *
         * A document loaded from `source={{ html }}` has no origin, so the old
         * `['*']` was not "allow the map's own host" — it was "this WebView may
         * navigate anywhere". The document pulls Leaflet from a CDN and tiles
         * from a third-party vendor, so a redirect from either, or a crafted
         * tile response, could steer it somewhere else entirely — inside the
         * app's own WebView, in front of a customer who is mid-checkout.
         *
         * Subresource integrity already guarantees the *script* is the one we
         * expect. This is the other half: nothing gets to replace the page.
         */
        originWhitelist={['about:blank']}
        /*
         * The map picks a point. It never navigates, so any attempt to is a
         * redirect nobody asked for.
         *
         * Returning false does not break the map: tiles, CSS and the Leaflet
         * bundle are subresource loads, which this does not see. It only
         * governs top-level navigation.
         */
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        /*
         * Android's WebView honours `window.open` by default and hands the new
         * window to the system browser. Nothing here opens one, so the only
         * caller would be something that should not be running.
         */
        setSupportMultipleWindows={false}
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
        /*
         * Both, because they are different failures.
         *
         * `onError` is the transport giving up — no DNS, no route, TLS refused,
         * which on an Iraqi mobile connection is the common one. `onHttpError`
         * is a server answering with a status: a tile vendor rejecting the key,
         * or a CDN returning 403. Neither reached the customer before.
         */
        onError={() => setFailed(true)}
        onHttpError={() => setFailed(true)}
        style={{ flex: 1, backgroundColor: 'transparent' }}
      />

      {failed ? (
        <View
          style={{
            ...StyleSheetAbsoluteFill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color.warningSoft,
            paddingHorizontal: space[4],
            gap: space[2],
          }}
          // Same treatment as the offline banner: it is news that arrived on
          // its own, so it is announced rather than waiting to be focused.
          accessibilityLiveRegion="polite"
        >
          <Text variant="caption" align="center" style={{ color: color.warningStrong }}>
            تعذّر تحميل الخريطة
          </Text>
          <Text variant="caption" align="center" style={{ color: color.warningStrong }}>
            اكتب العنوان يدوياً — سيصل المندوب باستخدام الوصف والمَعلَم.
          </Text>
        </View>
      ) : !ready ? (
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
