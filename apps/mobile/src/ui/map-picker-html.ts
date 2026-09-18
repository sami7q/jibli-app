/**
 * The map itself, as a self-contained document.
 *
 * One file for both platforms: the native picker loads it into a WebView, and
 * the web picker writes it into an iframe. Keeping it here rather than inline
 * in either means the map a reviewer sees in a browser and the map a customer
 * sees on a phone are the same map, down to the marker.
 *
 * Leaflet from a CDN, and tiles from wherever `EXPO_PUBLIC_MAP_TILE_URL`
 * points. No key, no account, no SDK in the binary — and the attribution is
 * non-negotiable, which is why it is drawn from the same configuration rather
 * than left to a caller to remember.
 *
 * The default is OpenStreetMap's own tile server, and the default is for
 * development only. The OSMF Tile Usage Policy is explicit that
 * `tile.openstreetmap.org` is a donated resource, that applications must not
 * hardcode it, and that a distributed app needs its own tile source — the
 * limit is the policy rather than the traffic. A picking session is about
 * forty-five tiles, so a thousand customers saving two addresses each is under
 * a hundred thousand requests in total and fits inside every commercial free
 * tier there is; the point is to be on one, with a key, before launch.
 *
 * Both CDN files carry a Subresource Integrity digest, computed from the bytes
 * unpkg actually served rather than copied from a page. This document runs
 * with a customer's session inside the app's own WebView, so a compromised or
 * swapped CDN file would be running there too; with the digest, a changed byte
 * means the script does not run at all.
 */

export type MapPickerMessage = {
  readonly type: 'pick';
  readonly latitude: number;
  readonly longitude: number;
};

/** Baghdad, Tahrir Square. Somewhere real to open when there is nothing saved. */
const FALLBACK = { latitude: 33.3128, longitude: 44.3615 };

/**
 * Where the tiles come from, and who to credit for them.
 *
 * Both are `EXPO_PUBLIC_`, so they are read when the config is evaluated and
 * baked into the binary — which is what makes swapping MapTiler or Stadia in
 * a rebuild rather than a release of new code.
 */
const TILE_URL =
  process.env.EXPO_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const TILE_ATTRIBUTION =
  process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION ?? '&copy; OpenStreetMap';

export function MAP_PICKER_HTML(latitude: number | null, longitude: number | null): string {
  /*
   * Whether there is a point to open on, and therefore whether the map may
   * report its opening position as a chosen one.
   *
   * With a pin, reporting it is what lets somebody editing an address — or
   * opening on their own GPS fix — simply save, without dragging the map a
   * centimetre and back to make the button light up.
   *
   * Without one, the document used to report the Baghdad fallback anyway. The
   * address form took Tahrir Square as the answer, turned «تحديد موقعي» green
   * and saved it; `buildNavigationLinks` then had valid coordinates, so it
   * never fell back to searching the address text and drove the courier to the
   * middle of the city with confidence. A wrong point is worse than no point,
   * because no point still has a fallback and a wrong one does not.
   */
  const hasPin = typeof latitude === 'number' && typeof longitude === 'number';
  const lat = hasPin ? latitude : FALLBACK.latitude;
  const lon = hasPin ? longitude : FALLBACK.longitude;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H"
  crossorigin="anonymous">
<style>
  html, body, #map { margin: 0; height: 100%; width: 100%; background: #eef0f3; }
  .leaflet-container { font: 12px "Segoe UI", system-ui, sans-serif; }
  /*
    A crosshair fixed to the centre of the map.

    The pin does not move — the map does. Dragging a tiny marker with a finger
    that covers it is the interaction everybody gets wrong; moving the ground
    under a fixed point is what every maps app settled on, and it works at the
    zoom level where a house is one building among four.
  */
  #crosshair {
    position: absolute; z-index: 500; left: 50%; top: 50%;
    width: 34px; height: 34px; margin: -34px 0 0 -17px;
    pointer-events: none;
  }
  #crosshair svg { filter: drop-shadow(0 3px 4px rgba(0,0,0,.35)); }
  #hint {
    position: absolute; z-index: 500; inset-inline: 8px; bottom: 8px;
    background: rgba(255,255,255,.94); border-radius: 10px; padding: 6px 10px;
    font: 12px "Segoe UI", system-ui, sans-serif; color: #374151; text-align: center;
  }
</style>
</head>
<body>
<div id="map"></div>

<div id="crosshair">
  <svg viewBox="0 0 24 24" width="34" height="34" fill="#f2681a">
    <path d="M12 23s8-6.4 8-12.6A8 8 0 1 0 4 10.4C4 16.6 12 23 12 23z"/>
    <circle cx="12" cy="10" r="3.2" fill="#fff"/>
  </svg>
</div>

<div id="hint">حرّك الخريطة حتى تصبح العلامة على موقعك بالضبط</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH"
  crossorigin="anonymous"></script>
<script>
  (function () {
    var map = L.map('map', { zoomControl: true, attributionControl: true })
      .setView([${lat}, ${lon}], ${hasPin ? 17 : 13});

    /*
     * Both values serialised rather than quoted by hand.
     *
     * They come from build-time environment variables, so this was never a
     * script-injection route — but a single apostrophe in an attribution
     * string, which is ordinary ("© MapTiler, © OpenStreetMap's contributors"),
     * closed the literal and broke the whole script. The failure was silent and
     * total: no map, no error, just the grey panel forever. JSON.stringify
     * emits its own quotes and escapes what is inside them.
     */
    L.tileLayer(${JSON.stringify(TILE_URL)}, {
      maxZoom: 19,
      attribution: ${JSON.stringify(TILE_ATTRIBUTION)}
    }).addTo(map);

    /*
     * One channel for both hosts.
     *
     * A WebView answers on ReactNativeWebView.postMessage; an iframe answers on
     * window.parent.postMessage. Writing to whichever exists means this file
     * never has to know which one is holding it.
     */
    function send(payload) {
      var body = JSON.stringify(payload);
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(body);
      else if (window.parent !== window) window.parent.postMessage(body, '*');
    }

    /*
     * Reported on settle, not on every frame.
     *
     * 'moveend' fires once the map stops, so a drag across the city sends one
     * coordinate rather than sixty — and the field showing it does not flicker
     * through every street on the way.
     */
    map.on('moveend', function () {
      var c = map.getCenter();
      send({ type: 'pick', latitude: c.lat, longitude: c.lng });
    });

    /*
     * The opening position counts as a pick, but only when somebody chose it.
     * See the note on hasPin above for why the fallback must stay silent.
     */
    ${
      hasPin
        ? `send({ type: 'pick', latitude: ${lat}, longitude: ${lon} });`
        : '/* nothing chosen yet - wait for the map to be moved */'
    }
  })();
</script>
</body>
</html>`;
}
