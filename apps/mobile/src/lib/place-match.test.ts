import { describe, expect, it } from 'vitest';
import { lookupArea, metresBetween, normalisePlaceName, type GeographyBranch } from './place-match';

/**
 * Reading the city off the pin.
 *
 * The scenario these pin down is the one that was reported from a real phone:
 * standing in حديثة, in الأنبار, with بغداد on the profile — the form showed
 * Baghdad, and saving it would have produced an order Baghdad accepts and a
 * courier sent two hundred kilometres up the Euphrates.
 *
 * The pilot's geography, as `GET /geography/tree?capability=ordering` returns
 * it. Two governorates, three cities, and the codes that make the match
 * language-independent.
 */
const TREE: readonly GeographyBranch[] = [
  {
    id: 'gov-baghdad',
    code: 'IQ-BG',
    name_ar: 'بغداد',
    cities: [{ id: 'city-baghdad', code: 'IQ-BG-BAGHDAD', name_ar: 'بغداد' }],
  },
  {
    id: 'gov-anbar',
    code: 'IQ-AN',
    name_ar: 'الأنبار',
    cities: [
      { id: 'city-ramadi', code: 'IQ-AN-RAMADI', name_ar: 'الرمادي' },
      { id: 'city-haditha', code: 'IQ-AN-HADITHA', name_ar: 'حديثة' },
    ],
  },
];

describe('normalising a place name', () => {
  it('reads the same place through either script', () => {
    expect(normalisePlaceName('حديثة')).toBe(normalisePlaceName('حديثه'));
    expect(normalisePlaceName('الأنبار')).toBe(normalisePlaceName('الانبار'));
  });

  it('drops the article, in both scripts', () => {
    // «الرمادي» and "Ramadi" are one city; "Al Anbar" and "Anbar" are one
    // governorate. A geocoder picks whichever it likes.
    expect(normalisePlaceName('الرمادي')).toBe(normalisePlaceName('رمادي'));
    expect(normalisePlaceName('Al Anbar')).toBe(normalisePlaceName('Anbar'));
  });

  it('ignores punctuation and case', () => {
    expect(normalisePlaceName('Al-Qaim')).toBe(normalisePlaceName('al qaim'));
  });

  it('is empty for nothing', () => {
    expect(normalisePlaceName('   ')).toBe('');
  });
});

describe('matching a geocoded place to a city', () => {
  it('finds حديثة from an Arabic phone', () => {
    expect(lookupArea({ city: 'حديثة', region: 'الأنبار' }, TREE)).toEqual({
      status: 'matched',
      area: {
        governorateId: 'gov-anbar',
        governorateNameAr: 'الأنبار',
        cityId: 'city-haditha',
        cityNameAr: 'حديثة',
      },
    });
  });

  it('finds the same city from an English phone', () => {
    /*
     * The half that cannot be done by comparing names: the OS says "Haditha"
     * and the API only ever says «حديثة». The seed dataset carries both against
     * `IQ-AN-HADITHA`, so the two never have to be compared to each other.
     */
    const found = lookupArea({ city: 'Haditha', region: 'Al Anbar' }, TREE);
    expect(found).toMatchObject({ status: 'matched' });
    expect(found.status === 'matched' && found.area.cityId).toBe('city-haditha');
  });

  it('sees through the administrative wrapper a real phone returns', () => {
    /*
     * The reported bug, from a phone standing in حديثة. The geocoder does not
     * answer «حديثة» — it answers «قضاء حديثة», or "Haditha District", or
     * "Al Anbar Governorate" — and an exact comparison missed all of them. The
     * screen then told somebody in an open city that Jibli does not deliver
     * there.
     */
    for (const spelling of ['قضاء حديثة', 'ناحية حديثة', 'مركز قضاء حديثة', 'Haditha District']) {
      const found = lookupArea({ city: spelling }, TREE);
      expect(found.status === 'matched' && found.area.cityId, spelling).toBe('city-haditha');
    }

    const viaRegion = lookupArea({ city: 'Al Anbar Governorate' }, TREE);
    expect(viaRegion.status).toBe('governorate');
  });

  it('looks in every field the platforms use for a town', () => {
    for (const place of [
      { subregion: 'Haditha' },
      { district: 'حديثة' },
      { name: 'Haditha' },
    ]) {
      const found = lookupArea(place, TREE);
      expect(found.status === 'matched' && found.area.cityId).toBe('city-haditha');
    }
  });

  it('prefers the city over the region when they disagree', () => {
    // The specific fact wins: somebody in Haditha is in Anbar whatever the
    // `region` field claims.
    const found = lookupArea({ city: 'حديثة', region: 'بغداد' }, TREE);
    expect(found.status === 'matched' && found.area.cityId).toBe('city-haditha');
  });

  it('falls back to a governorate that offers only one city', () => {
    // A Baghdad fix usually names the neighbourhood — «المنصور» is not a city
    // in the dataset — but Baghdad governorate lists exactly one city, so there
    // is nothing to guess between.
    const found = lookupArea({ district: 'المنصور', region: 'بغداد' }, TREE);
    expect(found.status === 'matched' && found.area.cityId).toBe('city-baghdad');
  });

  it('reports the governorate rather than guessing between its cities', () => {
    /*
     * Anbar offers Ramadi and Haditha, and «الأنبار» does not say which. Not a
     * failure: the caller compares it with the city already selected, and a
     * selected city inside this governorate agrees with the pin.
     */
    expect(lookupArea({ region: 'الأنبار' }, TREE)).toEqual({
      status: 'governorate',
      governorateId: 'gov-anbar',
      governorateNameAr: 'الأنبار',
    });
  });

  it('says «outside» only for a place Iraq has and Jibli does not serve', () => {
    // Basra is a real governorate that this pilot does not deliver to. That is
    // a fact about coverage, and the screen may say so.
    expect(lookupArea({ city: 'البصرة', region: 'البصرة' }, TREE)).toEqual({
      status: 'outside',
      placeNameAr: 'البصرة',
    });

    // Fallujah is in the seed data and not in this tree: the answer comes from
    // what the API offers, not from what Iraq contains.
    expect(lookupArea({ city: 'الفلوجة', region: 'الأنبار' }, TREE)).toMatchObject({
      status: 'outside',
      placeNameAr: 'الفلوجة',
    });
  });

  it('says «unknown» when it simply does not recognise the place', () => {
    /*
     * The distinction the bug turned on. Not recognising a name says nothing
     * about whether delivery reaches there, so it must never be reported as a
     * refusal.
     */
    expect(lookupArea({ city: 'Paris', region: 'Île-de-France' }, TREE).status).toBe('unknown');
    expect(lookupArea({}, TREE).status).toBe('unknown');
    expect(lookupArea({ city: '', region: null }, TREE).status).toBe('unknown');
  });
});

describe('how far the pin has moved', () => {
  it('is zero for the same point', () => {
    expect(metresBetween({ latitude: 33.31, longitude: 44.36 }, { latitude: 33.31, longitude: 44.36 })).toBe(0);
  });

  it('measures a nudge down the street in metres', () => {
    // A ten-thousandth of a degree of latitude is about 11 m.
    const nudge = metresBetween(
      { latitude: 33.3152, longitude: 44.332 },
      { latitude: 33.3153, longitude: 44.332 },
    );
    expect(nudge).toBeGreaterThan(9);
    expect(nudge).toBeLessThan(13);
  });

  it('measures Baghdad to Haditha in hundreds of kilometres', () => {
    // The distance that matters: far enough that the city must be re-read.
    const far = metresBetween(
      { latitude: 33.3128, longitude: 44.3615 },
      { latitude: 34.1374, longitude: 42.3785 },
    );
    expect(far).toBeGreaterThan(180_000);
    expect(far).toBeLessThan(220_000);
  });
});
