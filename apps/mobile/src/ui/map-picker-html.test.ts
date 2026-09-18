import { describe, expect, it } from 'vitest';
import { MAP_PICKER_HTML } from './map-picker-html';

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

const BAGHDAD_CENTRE = { latitude: 33.3128, longitude: 44.3615 };

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
    expect(html).toContain(String(BAGHDAD_CENTRE.latitude));
    expect(html).toContain(String(BAGHDAD_CENTRE.longitude));
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
    expect(MAP_PICKER_HTML(33.2778, 44.3661)).toContain('], 17)');
    expect(MAP_PICKER_HTML(null, null)).toContain('], 13)');
  });
});
