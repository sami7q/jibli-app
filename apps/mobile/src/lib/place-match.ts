import { CITIES, GOVERNORATES } from '@jibli/geography';

/**
 * Which of Jibli's cities a set of coordinates is in.
 *
 * The bug this exists to kill: the address form took the governorate and city
 * from the customer's *profile* while taking the pin from their *phone*. Stand
 * in حديثة with بغداد on your profile and you get an address whose city says
 * Baghdad and whose point is two hundred kilometres up the Euphrates — an
 * order the API happily accepts, because Baghdad is open, and a courier sent
 * to a city nobody delivers to. A pin and a city that disagree is worse than
 * either being missing.
 *
 * So the city is read off the pin. The phone's own geocoder names the place,
 * and this matches that name against the geography the platform actually has.
 *
 * **Matched through `code`, never through a name.** The OS answers in whatever
 * language the device is set to — «حديثة» on an Arabic phone, "Haditha" on an
 * English one — and the API returns Arabic only. The seed dataset holds both
 * spellings against a stable code (`IQ-AN-HADITHA`), so a name from either
 * language becomes a code, and the code finds the row. Nothing compares an
 * Arabic string to an English one, and no spelling in the API has to match a
 * spelling in the operating system.
 *
 * No coordinates are involved in the match itself: the platform stores none
 * for its cities, and inventing centroids to pick a nearest one would be
 * making up data to answer a question the OS already answers properly.
 */

/** The administrative names a reverse geocode comes back with. */
export interface PlaceNames {
  readonly city?: string | null;
  readonly district?: string | null;
  readonly subregion?: string | null;
  readonly region?: string | null;
  readonly name?: string | null;
}

/** A governorate and one of its cities, as the app's own geography knows them. */
export interface AreaMatch {
  readonly governorateId: string;
  readonly governorateNameAr: string;
  readonly cityId: string;
  readonly cityNameAr: string;
}

/** The shape `GET /geography/tree` returns, narrowed to what matching needs. */
export interface GeographyBranch {
  readonly id: string;
  readonly code: string;
  readonly name_ar: string;
  readonly cities: readonly { readonly id: string; readonly code: string; readonly name_ar: string }[];
}

/**
 * One comparable form for one name.
 *
 * Arabic arrives spelled several defensible ways: «الأنبار» and «الانبار»
 * differ by a hamza, «حديثه» and «حديثة» by a tooth, and a geocoder is under no
 * obligation to pick the same one the seed data did. Latin arrives with and
 * without the article — "Al Anbar", "Anbar", "Al-Qaim" — and with punctuation
 * nobody agrees on.
 *
 * Both collapse to letters only, with the article dropped, so the comparison is
 * between places rather than between orthographies.
 */
export function normalisePlaceName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const arabic = trimmed
    // Harakat and tatweel carry no identity.
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');

  const latin = arabic
    .normalize('NFD')
    // Latin combining marks; the Arabic ones are already gone.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  const letters = latin.replace(/[^\p{L}\p{N}]/gu, '');

  // The definite article, in both scripts. «الرمادي» and "Ramadi" are the same
  // city, and so are "Al Anbar" and "Anbar".
  if (letters.startsWith('ال') && letters.length > 4) return letters.slice(2);
  if (letters.startsWith('al') && letters.length > 4) return letters.slice(2);

  return letters;
}

/** Every spelling the seed data knows for a place, normalised. */
function spellings(nameAr: string, nameEnInternal: string | null | undefined): string[] {
  return [normalisePlaceName(nameAr), nameEnInternal ? normalisePlaceName(nameEnInternal) : '']
    .filter((value) => value.length > 0);
}

/** The seed code for a place named like this, in either language. */
function cityCodeFor(name: string): string | null {
  const wanted = normalisePlaceName(name);
  if (!wanted) return null;
  return CITIES.find((city) => spellings(city.nameAr, city.nameEnInternal).includes(wanted))?.code
    ?? null;
}

function governorateCodeFor(name: string): string | null {
  const wanted = normalisePlaceName(name);
  if (!wanted) return null;
  return (
    GOVERNORATES.find((governorate) =>
      spellings(governorate.nameAr, governorate.nameEnInternal).includes(wanted),
    )?.code ?? null
  );
}

/**
 * The area a geocoded place belongs to, or `null` when the platform has no
 * city there.
 *
 * `null` is a real answer and the screen must say so rather than quietly
 * keeping whatever area was there before — «we do not deliver where you are
 * standing» is information, and the silent alternative is the two-hundred
 * kilometre delivery this module exists to prevent.
 */
export function matchArea(place: PlaceNames, tree: readonly GeographyBranch[]): AreaMatch | null {
  /*
   * City first, and the governorate taken from whichever branch holds it.
   *
   * A city identifies an area completely, while `region` alone cannot — and
   * where the two disagree, the city is the more specific fact. Every field the
   * geocoder might have put the town in is tried, because the platforms do not
   * agree on which one it is: iOS puts Haditha in `city`, Android frequently in
   * `subregion`, and a rural fix sometimes only fills `name`.
   */
  const candidates = [place.city, place.subregion, place.district, place.name];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const code = cityCodeFor(candidate);
    if (!code) continue;

    for (const branch of tree) {
      const city = branch.cities.find((entry) => entry.code === code);
      if (city) {
        return {
          governorateId: branch.id,
          governorateNameAr: branch.name_ar,
          cityId: city.id,
          cityNameAr: city.name_ar,
        };
      }
    }
  }

  /*
   * Failing that, a governorate with exactly one city open.
   *
   * Baghdad is the case that matters: the governorate and its only listed city
   * share a name, and a geocode inside it often names the neighbourhood rather
   * than the city. Where a governorate offers a choice, guessing which of its
   * towns somebody is standing in would be inventing an answer.
   */
  const governorateCode = [place.region, place.subregion]
    .map((name) => (name ? governorateCodeFor(name) : null))
    .find((code) => code !== null);

  if (governorateCode) {
    const branch = tree.find((entry) => entry.code === governorateCode);
    const only = branch?.cities.length === 1 ? branch.cities[0] : undefined;
    if (branch && only) {
      return {
        governorateId: branch.id,
        governorateNameAr: branch.name_ar,
        cityId: only.id,
        cityNameAr: only.name_ar,
      };
    }
  }

  return null;
}

/**
 * Roughly how far apart two points are, in metres.
 *
 * Equirectangular rather than haversine: over the few kilometres this is ever
 * asked about the difference is centimetres, and the question it answers —
 * «has the pin moved far enough to be in another city?» — does not have a
 * metre riding on it.
 */
export function metresBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const EARTH_RADIUS_M = 6_371_000;
  const toRadians = Math.PI / 180;
  const meanLatitude = ((a.latitude + b.latitude) / 2) * toRadians;
  const dx = (b.longitude - a.longitude) * toRadians * Math.cos(meanLatitude);
  const dy = (b.latitude - a.latitude) * toRadians;
  return Math.sqrt(dx * dx + dy * dy) * EARTH_RADIUS_M;
}
