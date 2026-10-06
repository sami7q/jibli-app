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
  readonly cities: readonly {
    readonly id: string;
    readonly code: string;
    readonly name_ar: string;
  }[];
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

  /*
   * The administrative noise a geocoder wraps a place in.
   *
   * This is what broke it on a real phone in حديثة: the OS does not answer
   * «حديثة», it answers «قضاء حديثة» or "Haditha District", and an exact
   * comparison against the seed name misses every time. The screen then said
   * «we do not deliver to your location» to somebody standing in a city that
   * is open for delivery.
   *
   * None of Iraq's city or governorate names contains one of these words, so
   * removing them cannot turn one place into another.
   */
  const stripped = ADMINISTRATIVE_WORDS.reduce(
    (value, word) => value.split(word).join(''),
    letters,
  );

  // The definite article, in both scripts. «الرمادي» and "Ramadi" are the same
  // city, and so are "Al Anbar" and "Anbar".
  if (stripped.startsWith('ال') && stripped.length > 4) return stripped.slice(2);
  if (stripped.startsWith('al') && stripped.length > 4) return stripped.slice(2);

  return stripped;
}

/**
 * Words that describe what kind of place something is, not which place it is.
 *
 * Normalised the same way the names are — «محافظة» has already become
 * «محافظه» by the time this runs — and matched as substrings, because
 * punctuation and spacing are gone by then.
 */
const ADMINISTRATIVE_WORDS: readonly string[] = [
  'governorate',
  'province',
  'subdistrict',
  'district',
  'municipality',
  'qadha',
  'qada',
  'nahiya',
  'محافظه',
  'قضاء',
  'ناحيه',
  'مركز',
  'مدينه',
];

/** Every spelling the seed data knows for a place, normalised. */
function spellings(nameAr: string, nameEnInternal: string | null | undefined): string[] {
  return [
    normalisePlaceName(nameAr),
    nameEnInternal ? normalisePlaceName(nameEnInternal) : '',
  ].filter((value) => value.length > 0);
}

/** The seed row for a place named like this, in either language. */
function citySeedFor(name: string): { code: string; nameAr: string } | null {
  const wanted = normalisePlaceName(name);
  if (!wanted) return null;
  const found = CITIES.find((city) => spellings(city.nameAr, city.nameEnInternal).includes(wanted));
  return found ? { code: found.code, nameAr: found.nameAr } : null;
}

function governorateSeedFor(name: string): { code: string; nameAr: string } | null {
  const wanted = normalisePlaceName(name);
  if (!wanted) return null;
  const found = GOVERNORATES.find((governorate) =>
    spellings(governorate.nameAr, governorate.nameEnInternal).includes(wanted),
  );
  return found ? { code: found.code, nameAr: found.nameAr } : null;
}

/**
 * What the geography knows about a geocoded place.
 *
 * Four answers, and keeping them apart is the whole point. Conflating the last
 * two is what told a customer standing in حديثة — an open city — that Jibli
 * does not deliver to their location: the geocoder had said «قضاء حديثة», the
 * match had failed, and a failure to recognise a name was reported as a
 * refusal to deliver. They are not the same fact and must not read the same.
 */
export type AreaLookup =
  /** This is the city, and the platform serves it. */
  | { readonly status: 'matched'; readonly area: AreaMatch }
  /**
   * The governorate is certain, the city is not — several of its cities are
   * open and a `region` alone does not say which. The caller decides: if the
   * city already selected sits in this governorate, the pin agrees with it.
   */
  | {
      readonly status: 'governorate';
      readonly governorateId: string;
      readonly governorateNameAr: string;
    }
  /** A place Iraq has and Jibli does not serve. Worth saying out loud. */
  | { readonly status: 'outside'; readonly placeNameAr: string }
  /** Nothing recognisable. Says nothing about where delivery goes. */
  | { readonly status: 'unknown' };

export function lookupArea(place: PlaceNames, tree: readonly GeographyBranch[]): AreaLookup {
  /*
   * City first, and the governorate taken from whichever branch holds it.
   *
   * A city identifies an area completely, while `region` alone cannot — and
   * where the two disagree, the city is the more specific fact. Every field the
   * geocoder might have put the town in is tried, because the platforms do not
   * agree on which one it is: iOS puts Haditha in `city`, Android frequently in
   * `subregion`, and a rural fix sometimes only fills `name`.
   */
  const townFields = [place.city, place.subregion, place.district, place.name];

  /** A city Iraq has under this pin, whether or not Jibli serves it. */
  let knownCity: { code: string; nameAr: string } | null = null;

  for (const candidate of townFields) {
    if (!candidate) continue;
    const seed = citySeedFor(candidate);
    if (!seed) continue;
    knownCity ??= seed;

    for (const branch of tree) {
      const city = branch.cities.find((entry) => entry.code === seed.code);
      if (city) {
        return {
          status: 'matched',
          area: {
            governorateId: branch.id,
            governorateNameAr: branch.name_ar,
            cityId: city.id,
            cityNameAr: city.name_ar,
          },
        };
      }
    }
  }

  /*
   * A city that was recognised and is not in the tree settles it.
   *
   * Before this ran below the governorate fallback, and a pin in الفلوجة —
   * Anbar, not served — came back as «the governorate is الأنبار», which would
   * have let a selected حديثة stand. That is the same bug in miniature: a
   * hundred kilometres instead of two hundred. Knowing the city beats knowing
   * the governorate whether the answer is yes or no.
   */
  if (knownCity) return { status: 'outside', placeNameAr: knownCity.nameAr };

  const governorateSeed = [place.region, place.subregion, place.city]
    .map((name) => (name ? governorateSeedFor(name) : null))
    .find((seed) => seed !== null);

  if (governorateSeed) {
    const branch = tree.find((entry) => entry.code === governorateSeed.code);

    if (branch) {
      /*
       * One open city means there is nothing to choose between — Baghdad, where
       * a geocode names the neighbourhood rather than the city. More than one,
       * and picking would be inventing the answer, so the governorate is
       * reported and the caller weighs it against what is already selected.
       */
      const only = branch.cities.length === 1 ? branch.cities[0] : undefined;
      return only
        ? {
            status: 'matched',
            area: {
              governorateId: branch.id,
              governorateNameAr: branch.name_ar,
              cityId: only.id,
              cityNameAr: only.name_ar,
            },
          }
        : {
            status: 'governorate',
            governorateId: branch.id,
            governorateNameAr: branch.name_ar,
          };
    }

    // Iraq has the governorate; Jibli does not serve it.
    return { status: 'outside', placeNameAr: governorateSeed.nameAr };
  }

  return { status: 'unknown' };
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
