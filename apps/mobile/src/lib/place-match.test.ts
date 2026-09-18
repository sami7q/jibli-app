import { describe, expect, it } from 'vitest';
import { matchArea, metresBetween, normalisePlaceName, type GeographyBranch } from './place-match';

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
    expect(matchArea({ city: 'حديثة', region: 'الأنبار' }, TREE)).toEqual({
      governorateId: 'gov-anbar',
      governorateNameAr: 'الأنبار',
      cityId: 'city-haditha',
      cityNameAr: 'حديثة',
    });
  });

  it('finds the same city from an English phone', () => {
    /*
     * The half that cannot be done by comparing names: the OS says "Haditha"
     * and the API only ever says «حديثة». The seed dataset carries both against
     * `IQ-AN-HADITHA`, so the two never have to be compared to each other.
     */
    expect(matchArea({ city: 'Haditha', region: 'Al Anbar' }, TREE)?.cityId).toBe('city-haditha');
  });

  it('looks in every field the platforms use for a town', () => {
    expect(matchArea({ subregion: 'Haditha' }, TREE)?.cityId).toBe('city-haditha');
    expect(matchArea({ district: 'حديثة' }, TREE)?.cityId).toBe('city-haditha');
    expect(matchArea({ name: 'Haditha' }, TREE)?.cityId).toBe('city-haditha');
  });

  it('prefers the city over the region when they disagree', () => {
    // The specific fact wins: somebody in Haditha is in Anbar whatever the
    // `region` field claims.
    expect(matchArea({ city: 'حديثة', region: 'بغداد' }, TREE)?.cityId).toBe('city-haditha');
  });

  it('falls back to a governorate that offers only one city', () => {
    // A Baghdad fix usually names the neighbourhood — «المنصور» is not a city
    // in the dataset — but Baghdad governorate lists exactly one city, so there
    // is nothing to guess between.
    expect(matchArea({ district: 'المنصور', region: 'بغداد' }, TREE)?.cityId).toBe('city-baghdad');
  });

  it('refuses to guess between several cities in a governorate', () => {
    // Anbar offers Ramadi and Haditha. Knowing only «الأنبار» does not say
    // which, and picking one would be inventing the answer.
    expect(matchArea({ region: 'الأنبار' }, TREE)).toBeNull();
  });

  it('answers null where the platform has no city', () => {
    /*
     * Not a failure to be papered over. «We do not deliver where you are
     * standing» is the information, and the screen has to say it — keeping the
     * previous area silently is exactly the two-hundred kilometre delivery.
     */
    expect(matchArea({ city: 'البصرة', region: 'البصرة' }, TREE)).toBeNull();
    expect(matchArea({ city: 'Paris', region: 'Île-de-France' }, TREE)).toBeNull();
  });

  it('answers null when there is nothing to go on', () => {
    expect(matchArea({}, TREE)).toBeNull();
    expect(matchArea({ city: '', region: null }, TREE)).toBeNull();
  });

  it('ignores a city the platform does not serve, even though the dataset has it', () => {
    // Fallujah is in the seed data and not in this tree: the match must come
    // from what the API offers, not from what Iraq contains.
    expect(matchArea({ city: 'الفلوجة', region: 'الأنبار' }, TREE)).toBeNull();
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
