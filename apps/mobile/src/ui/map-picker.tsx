import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { centerMapScript, MAP_PICKER_HTML, type MapPickerMessage } from './map-picker-html';
import { isSamePoint, type MapPickerProps } from './map-picker-shared';
import { Text } from '@/ui';
import { color, radius, space } from '@/theme';

/**
 * A real map to put a pin on, on a device.
 *
 * A vector map inside a WebView (`map-picker-html.ts`): no key, no billing
 * account, no SDK in the binary. The web preview renders the same document
 * (`map-picker.web.tsx`), so what a reviewer sees in a browser is the map the
 * phone draws.
 *
 * It picks a point and reports it back. It does not geocode, search, or route;
 * the driver's own maps app does the routing, and it is better at it.
 */

export { isSamePoint, type MapPickerProps } from './map-picker-shared';

export function MapPicker({
  latitude,
  longitude,
  onPick,
  height = 280,
  placeNoun = 'home',
}: MapPickerProps) {
  const [ready, setReady] = useState(false);
  /**
   * Whether the map failed to draw at all — an unreachable CDN or tile server,
   * or no WebGL. Without this the customer, mid-checkout, sees a grey rectangle
   * and cannot tell broken from slow.
   */
  const [failed, setFailed] = useState(false);
  const webview = useRef<WebView>(null);

  /*
   * The document is built once, on the position the picker opened with.
   *
   * It used to be rebuilt from `latitude`/`longitude` on every render — and
   * those change every time the map settles, because the sheet stores what
   * the map reports. So every drag reloaded the entire map from the network
   * at the spot the finger let go. Later positions are sent in instead.
   */
  const [html] = useState(() => MAP_PICKER_HTML(latitude ?? null, longitude ?? null, placeNoun));

  /** Where the map itself last said it was, so its own echo is not sent back. */
  const lastReported = useRef<{ latitude: number; longitude: number } | null>(
    latitude != null && longitude != null ? { latitude, longitude } : null,
  );

  /*
   * A position from outside — the GPS fix arriving, or «استخدم موقعي الحالي» —
   * moves the map in place. Only when the map is ready: a position that
   * arrives earlier is applied by the `ready` branch below.
   */
  useEffect(() => {
    if (!ready || latitude == null || longitude == null) return;
    const next = { latitude, longitude };
    if (isSamePoint(lastReported.current, next)) return;
    lastReported.current = next;
    webview.current?.injectJavaScript(centerMapScript(latitude, longitude));
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
      <WebView
        ref={webview}
        /*
         * `about:blank` and nothing else. A document loaded from
         * `source={{ html }}` has no origin, so a wildcard here would mean
         * "this WebView may navigate anywhere" — in front of a customer who is
         * mid-checkout.
         */
        originWhitelist={['about:blank']}
        /*
         * The map never navigates, so any attempt to is a redirect nobody
         * asked for. Tiles, fonts and scripts are subresource loads, which
         * this does not see.
         */
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        setSupportMultipleWindows={false}
        source={{ html }}
        onMessage={(event) => {
          let payload: MapPickerMessage;
          try {
            payload = JSON.parse(event.nativeEvent.data) as MapPickerMessage;
          } catch {
            return; // A message this component did not send.
          }
          if (payload.type === 'ready') setReady(true);
          else if (payload.type === 'failed') setFailed(true);
          else if (payload.type === 'pick') {
            const point = { latitude: payload.latitude, longitude: payload.longitude };
            lastReported.current = point;
            onPick(point);
          }
        }}
        // The map is the gesture surface; letting the sheet scroll under a
        // finger that is dragging the map is how a pin ends up in the wrong
        // street.
        scrollEnabled={false}
        nestedScrollEnabled
        bounces={false}
        overScrollMode="never"
        javaScriptEnabled
        domStorageEnabled={false}
        // Tiles and fonts are reused across openings of the sheet.
        cacheEnabled
        /*
         * Every tile policy worth reading asks an application to identify
         * itself, so an operator with a problem has somebody to contact before
         * they block a whole address range.
         */
        userAgent="Jibli/1.0 (+https://jibli.iq; delivery app; map picker)"
        /*
         * `onError` is the transport giving up — no DNS, no route, TLS refused.
         * `onHttpError` is a server answering with a status.
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
          // News that arrived on its own, so it is announced rather than
          // waiting to be focused.
          accessibilityLiveRegion="polite"
        >
          <Text variant="caption" align="center" style={{ color: color.warningStrong }}>
            تعذّر تحميل الخريطة
          </Text>
          <Text variant="caption" align="center" style={{ color: color.warningStrong }}>
            تحقق من الاتصال، أو اكتب وصف المكان — سيصل المندوب باستخدام الوصف والمَعلَم.
          </Text>
        </View>
      ) : !ready ? (
        <View
          pointerEvents="none"
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

/** Spelled out rather than imported: one object, used twice. */
const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};
