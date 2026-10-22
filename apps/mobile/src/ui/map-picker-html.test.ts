import { describe, expect, it, vi } from 'vitest';

/*
 * A tile provider, set before the module is loaded.
 *
 * `map-picker-html.ts` reads `EXPO_PUBLIC_MAP_TILE_URL` at module scope,
 * because the value is baked in at build time — so the only way to exercise
 * the map document is to have one configured before the import. Without it the
 * module now returns the "الخريطة غير متاحة" document instead, which is the
 * point of the last test in this file.
 *
 * The dynamic import is the pattern `lib/api.test.ts` already uses for the
 * same reason: a module whose behaviour is decided at load.
 */
process.env.EXPO_PUBLIC_MAP_TILE_URL = 'https://tiles.example/{z}/{x}/{y}.png';
process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION = '&copy; Example';

const { MAP_PICKER_HTML } = await import('./map-picker-html');

/**
 * What the map reports, and when.
 *
 * The picker talks to the app through one channel — `send({type:'pick', …})` —
 * and everything downstream trusts it completely: the address sheet stores the
 * coordinate, `createAddress` saves it, the order snapshots it, and
 * `buildNavigationLinks` turns it into the Google Maps URL a courier actually
 * drives to.
 *
 * Which makes a wrong pick worse than no pick. Without coordinates the driver's
 * link falls back to searching the address text; with them, it does not fall
 * back at all — it confidently routes somewhere. So the one rule that matters
 * is that the map never reports a position nobody chose.
 */

const HADITHA_CENTRE = { latitude: 34.1397, longitude: 42.3778 };

/** The `send({type:'pick'…})` calls the generated document will make on load. */
function opensByReporting(html: string): boolean {
  // The listener-registering call inside `map.on('moveend', …)` is not a load
  // report; only a bare call at the end of the script body is.
  return /send\(\{\s*type:\s*'pick'[\s\S]*?\}\);\s*\}\)\(\);/.test(html);
}

describe('the map picker only reports a point somebody chose', () => {
  it('does not report anything when it has no coordinate to open on', () => {
    const html = MAP_PICKER_HTML(null, null);

    /*
     * The regression this pins.
     *
     * The document used to end with an unconditional
     * `send({type:'pick', latitude: ${lat}, longitude: ${lon}})`, and with no
     * coordinate `lat`/`lon` were the Baghdad fallback. So opening the address
     * form and saving without touching the map stored Tahrir Square, under a
     * green «تم تحديد الموقع», and sent the courier there.
     */
    expect(opensByReporting(html)).toBe(false);
  });

  it('still centres somewhere real when it has nothing', () => {
    const html = MAP_PICKER_HTML(null, null);
    expect(html).toContain(String(HADITHA_CENTRE.latitude));
    expect(html).toContain(String(HADITHA_CENTRE.longitude));
  });

  /*
   * The opposite case, and the reason the old line existed at all: somebody
   * editing an address that already has a pin, or opening on their own GPS fix,
   * is already in the right place and should be able to save without dragging
   * the map a centimetre and back.
   */
  it('reports the opening position when that position was chosen', () => {
    const html = MAP_PICKER_HTML(33.2778, 44.3661);
    expect(opensByReporting(html)).toBe(true);
    expect(html).toContain('33.2778');
    expect(html).toContain('44.3661');
  });

  it('opens close in on a real pin and wide when guessing', () => {
    expect(MAP_PICKER_HTML(33.2778, 44.3661)).toContain('zoom: 17');
    expect(MAP_PICKER_HTML(null, null)).toContain('zoom: 12');
  });
});

describe('where the tiles come from', () => {
  it('never points at the OpenStreetMap donated tile server', () => {
    // The OSMF Tile Usage Policy forbids a distributed app from using it.
    expect(MAP_PICKER_HTML(33.2778, 44.3661)).not.toContain('tile.openstreetmap.org');
    expect(MAP_PICKER_HTML(null, null)).not.toContain('tile.openstreetmap.org');
  });

  it('uses a configured raster vendor when there is one', () => {
    const html = MAP_PICKER_HTML(33.2778, 44.3661);
    expect(html).toContain('tiles.example');
    expect(html).not.toContain('tiles.openfreemap.org');
  });

  it('draws a real, keyless map when nothing is configured', async () => {
    /*
     * The regression this pins: with no vendor configured, which is every
     * build nobody had set up, the picker drew «الخريطة غير متاحة» instead of
     * a map. The default is now OpenFreeMap — no key, commercial use allowed.
     */
    delete process.env.EXPO_PUBLIC_MAP_TILE_URL;
    vi.resetModules();
    const fresh = await import('./map-picker-html');

    const html = fresh.MAP_PICKER_HTML(33.2778, 44.3661);
    expect(html).toContain('tiles.openfreemap.org/styles/liberty');
    expect(html).not.toContain('الخريطة غير متاحة');
    // Arabic labels need the shaping plugin, or they draw unjoined.
    expect(html).toContain('mapbox-gl-rtl-text');
  });
});

describe('moving the map from outside', () => {
  it('only ever injects numbers', async () => {
    const { centerMapScript } = await import('./map-picker-html');
    expect(centerMapScript(33.3, 44.4)).toContain('jibliCenter(33.3, 44.4)');
    expect(centerMapScript(Number.NaN, 44.4)).toBe('true;');
    expect(centerMapScript('1);alert(1' as unknown as number, 44.4)).toBe('true;');
  });
});
