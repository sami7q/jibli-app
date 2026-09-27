/**
 * The map itself, as a self-contained document.
 *
 * One file for both platforms: the native picker loads it into a WebView, and
 * the web picker writes it into an iframe. Keeping it here rather than inline
 * in either means the map a reviewer sees in a browser and the map a customer
 * sees on a phone are the same map, down to the pin.
 *
 * **MapLibre and OpenFreeMap, and no key.** The picker used to be Leaflet over
 * a raster tile URL that had to come from a keyed vendor, because the OSMF
 * Tile Usage Policy forbids a distributed app from using
 * `tile.openstreetmap.org`. Nobody had set one, so every build drew «الخريطة
 * غير متاحة» where the map should be. OpenFreeMap serves the same OpenStreetMap
 * data as vector tiles with no key, no registration, no request limit and
 * commercial use permitted — so the default is now a working, licensed map,
 * and a keyed raster vendor is still one environment variable away.
 *
 * Vector tiles are also what make the labels Arabic: the style is rewritten to
 * prefer `name:ar`, where a raster tile arrives with whatever language its
 * server baked in.
 *
 * The MapLibre bundle and stylesheet carry a Subresource Integrity digest,
 * computed from the bytes unpkg served. This document runs inside the app's own
 * WebView, so a swapped CDN file would run there too; with the digest, a
 * changed byte means the script does not run at all.
 */

/** Page → app. */
export type MapPickerMessage =
  | { readonly type: 'pick'; readonly latitude: number; readonly longitude: number }
  | { readonly type: 'ready' }
  | { readonly type: 'failed' };

/** Baghdad, Tahrir Square. Somewhere real to open when there is nothing saved. */
const FALLBACK = { latitude: 33.3128, longitude: 44.3615 };

/** Close enough to tell one house from the next four. */
export const PIN_ZOOM = 17;
/** Wide enough to find your own neighbourhood in. */
const OVERVIEW_ZOOM = 12;

/**
 * A keyed raster vendor, if one is configured — MapTiler, Stadia, anything
 * with `{z}/{x}/{y}`. Read at build time (`EXPO_PUBLIC_`), so swapping vendors
 * is a rebuild rather than new code. Unset, which is the normal case, the map
 * uses OpenFreeMap.
 */
const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL ?? null;
const TILE_ATTRIBUTION = process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION ?? null;

const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const MAPLIBRE = {
  script: 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',
  scriptIntegrity: 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp',
  css: 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css',
  cssIntegrity: 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK',
  /*
   * Arabic shaping. Without it MapLibre draws Arabic letters unjoined and
   * left-to-right, which is unreadable. Loaded lazily by MapLibre itself, only
   * once a label with right-to-left text is on screen.
   */
  rtl: 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js',
};

/**
 * The script that moves the map from outside.
 *
 * The picker used to rebuild this whole document whenever the chosen point
 * changed — and the chosen point changes every time the map stops moving, so
 * every drag threw the map away and loaded it again. The document is now built
 * once, and a new position (the GPS fix arriving, say) is handed to it with
 * this instead.
 */
export function centerMapScript(latitude: number, longitude: number): string {
  // Numbers only: this string is executed inside the WebView.
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'true;';
  return `window.jibliCenter && window.jibliCenter(${lat}, ${lon}); true;`;
}

export function MAP_PICKER_HTML(latitude: number | null, longitude: number | null): string {
  /*
   * Whether there is a point to open on, and therefore whether the map may
   * report its opening position as a chosen one.
   *
   * With a pin, reporting it is what lets somebody editing an address — or
   * opening on their own GPS fix — simply save, without dragging the map a
   * centimetre and back to make the button light up.
   *
   * Without one, the document must stay silent. It once reported the Baghdad
   * fallback anyway; the form took Tahrir Square as the answer, saved it, and
   * the courier's navigation link drove confidently to the middle of the city.
   * A wrong point is worse than no point, because no point still falls back to
   * searching the address text and a wrong one does not.
   */
  const hasPin = typeof latitude === 'number' && typeof longitude === 'number';
  const lat = hasPin ? latitude : FALLBACK.latitude;
  const lon = hasPin ? longitude : FALLBACK.longitude;

  /*
   * Serialised rather than quoted by hand: an apostrophe in an attribution
   * («© OpenStreetMap's contributors») used to close the literal and silently
   * break the whole script.
   */
  const style = TILE_URL
    ? JSON.stringify({
        version: 8,
        sources: {
          raster: {
            type: 'raster',
            tiles: [TILE_URL],
            tileSize: 256,
            maxzoom: 19,
            attribution: TILE_ATTRIBUTION ?? '',
          },
        },
        layers: [{ id: 'raster', type: 'raster', source: 'raster' }],
      })
    : JSON.stringify(OPENFREEMAP_STYLE);

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="${MAPLIBRE.css}" integrity="${MAPLIBRE.cssIntegrity}" crossorigin="anonymous">
<style>
  html, body, #map { margin: 0; height: 100%; width: 100%; background: #eef0f3; overflow: hidden; }
  .maplibregl-ctrl-attrib { font: 10px system-ui, sans-serif; }
  /*
    A pin fixed to the centre of the map.

    The pin does not move — the map does. Dragging a tiny marker with a finger
    that covers it is the interaction everybody gets wrong; moving the ground
    under a fixed point is what every maps app settled on.

    While the map moves the pin lifts off the ground and its shadow stays
    behind, so it is obvious the point is not chosen until the map settles.
  */
  #pin {
    position: absolute; z-index: 5; left: 50%; top: 50%;
    width: 40px; height: 40px; margin: -40px 0 0 -20px;
    pointer-events: none; transition: transform .16s ease-out;
  }
  #pin svg { filter: drop-shadow(0 3px 3px rgba(0,0,0,.3)); display: block; }
  #shadow {
    position: absolute; z-index: 4; left: 50%; top: 50%;
    width: 10px; height: 4px; margin: -2px 0 0 -5px; border-radius: 50%;
    background: rgba(0,0,0,.35); pointer-events: none;
    transition: transform .16s ease-out, opacity .16s ease-out;
  }
  body.moving #pin { transform: translateY(-12px); }
  body.moving #shadow { transform: scale(1.6); opacity: .5; }
  #hint {
    position: absolute; z-index: 5; left: 8px; right: 8px; top: 8px;
    background: rgba(255,255,255,.95); border-radius: 10px; padding: 6px 10px;
    font: 12px system-ui, sans-serif; color: #374151; text-align: center;
    box-shadow: 0 1px 3px rgba(0,0,0,.12); transition: opacity .3s;
    pointer-events: none;
  }
  body.touched #hint { opacity: 0; }
</style>
</head>
<body>
<div id="map"></div>
<div id="shadow"></div>
<div id="pin">
  <svg viewBox="0 0 24 24" width="40" height="40" fill="#f2681a">
    <path d="M12 23s8-6.4 8-12.6A8 8 0 1 0 4 10.4C4 16.6 12 23 12 23z"/>
    <circle cx="12" cy="10" r="3.2" fill="#fff"/>
  </svg>
</div>
<div id="hint">${hasPin ? 'اسحب الخريطة لضبط الدبوس على باب منزلك' : 'حرّك الخريطة حتى يصبح الدبوس على منزلك'}</div>

<script src="${MAPLIBRE.script}" integrity="${MAPLIBRE.scriptIntegrity}" crossorigin="anonymous"></script>
<script>
  (function () {
    /*
     * One channel for both hosts. A WebView answers on
     * ReactNativeWebView.postMessage; an iframe on window.parent.postMessage.
     */
    function send(payload) {
      var body = JSON.stringify(payload);
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(body);
      else if (window.parent !== window) window.parent.postMessage(body, '*');
    }

    // The CDN was unreachable or the digest did not match: say so, once.
    if (typeof maplibregl === 'undefined') { send({ type: 'failed' }); return; }

    try { maplibregl.setRTLTextPlugin(${JSON.stringify(MAPLIBRE.rtl)}, true); } catch (e) {}

    var map;
    try {
      map = new maplibregl.Map({
        container: 'map',
        center: [${lon}, ${lat}],
        zoom: ${hasPin ? PIN_ZOOM : OVERVIEW_ZOOM},
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0
      });
    } catch (e) {
      // No WebGL on this device.
      send({ type: 'failed' });
      return;
    }
    // Two fingers zoom; they never rotate. A turned map is a lost customer.
    map.touchZoomRotate.disableRotation();

    /*
     * Arabic names first. The stock style prints "Latin\\nعربي" on every
     * label, which doubles the clutter and puts the script this audience
     * reads second.
     */
    function arabicLabels(previous, next) {
      next.layers.forEach(function (layer) {
        var field = layer.layout && layer.layout['text-field'];
        if (field && JSON.stringify(field).indexOf('name') !== -1) {
          layer.layout['text-field'] = ['coalesce', ['get', 'name:ar'], ['get', 'name'], ['get', 'name_en']];
        }
      });
      return next;
    }
    map.setStyle(${style}, { transformStyle: arabicLabels });

    var loaded = false;
    map.once('load', function () {
      loaded = true;
      /*
       * The credit starts folded into its ⓘ button. Expanded, it covers the
       * bottom fifth of a map this small; folded, it is still one tap away,
       * which is what the OpenStreetMap licence asks.
       */
      var credit = document.querySelector('.maplibregl-ctrl-attrib');
      if (credit) credit.classList.remove('maplibregl-compact-show');
      send({ type: 'ready' });
    });

    /*
     * A map that never draws is reported, not left as a grey box. Individual
     * tile errors are not — one missing tile on a weak connection is not a
     * broken map, and MapLibre retries it on the next move.
     */
    setTimeout(function () { if (!loaded) send({ type: 'failed' }); }, 20000);

    map.on('movestart', function (event) {
      document.body.classList.add('moving');
      // Only a finger hides the hint — not the GPS moving the map.
      if (event.originalEvent) document.body.classList.add('touched');
    });

    /*
     * Reported once the map settles, not on every frame: a drag across the
     * city sends one coordinate rather than sixty.
     */
    map.on('moveend', function () {
      document.body.classList.remove('moving');
      var c = map.getCenter();
      send({ type: 'pick', latitude: c.lat, longitude: c.lng });
    });

    /* The app moves the map with this — see centerMapScript(). */
    window.jibliCenter = function (lat, lon) {
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), ${PIN_ZOOM}), speed: 1.6 });
    };

    // The iframe host cannot call into a sandboxed frame; it posts instead.
    window.addEventListener('message', function (event) {
      try {
        var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && data.type === 'center') window.jibliCenter(Number(data.latitude), Number(data.longitude));
      } catch (e) {}
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
