/**
 * Iraq geography master data (plan §8, §9).
 *
 * All 19 governorates — including Halabja, the 19th, separated from Sulaymaniyah
 * — and their canonical cities. Customers and restaurant owners never create
 * city strings; Admin only toggles capabilities on these rows.
 *
 * Codes follow ISO 3166-2:IQ for governorates where one exists, so the dataset
 * can be reconciled against an external administrative reference. City codes are
 * `<governorate>-<slug>` and are stable: they are the natural key the seed
 * importer matches on, so renaming a city's Arabic display name never orphans
 * historical orders (plan §9).
 *
 * `SOURCE_VERSION` must be bumped whenever rows are added or recoded. The seed
 * importer inserts new canonical units, updates safe descriptive fields, and
 * preserves stable IDs.
 */

export const SOURCE_VERSION = '2025.1';

export interface GovernorateSeed {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEnInternal: string;
  readonly sortOrder: number;
}

export interface CitySeed {
  readonly code: string;
  readonly governorateCode: string;
  readonly nameAr: string;
  readonly nameEnInternal: string;
}

/** Plan §8.1 — the canonical 19. */
export const GOVERNORATES: readonly GovernorateSeed[] = [
  { code: 'IQ-BG', nameAr: 'بغداد', nameEnInternal: 'Baghdad', sortOrder: 1 },
  { code: 'IQ-BA', nameAr: 'البصرة', nameEnInternal: 'Basra', sortOrder: 2 },
  { code: 'IQ-NI', nameAr: 'نينوى', nameEnInternal: 'Nineveh', sortOrder: 3 },
  { code: 'IQ-AR', nameAr: 'أربيل', nameEnInternal: 'Erbil', sortOrder: 4 },
  { code: 'IQ-SU', nameAr: 'السليمانية', nameEnInternal: 'Sulaymaniyah', sortOrder: 5 },
  { code: 'IQ-DA', nameAr: 'دهوك', nameEnInternal: 'Duhok', sortOrder: 6 },
  { code: 'IQ-KI', nameAr: 'كركوك', nameEnInternal: 'Kirkuk', sortOrder: 7 },
  { code: 'IQ-NA', nameAr: 'النجف', nameEnInternal: 'Najaf', sortOrder: 8 },
  { code: 'IQ-KA', nameAr: 'كربلاء', nameEnInternal: 'Karbala', sortOrder: 9 },
  { code: 'IQ-BB', nameAr: 'بابل', nameEnInternal: 'Babil', sortOrder: 10 },
  { code: 'IQ-AN', nameAr: 'الأنبار', nameEnInternal: 'Al Anbar', sortOrder: 11 },
  { code: 'IQ-DI', nameAr: 'ديالى', nameEnInternal: 'Diyala', sortOrder: 12 },
  { code: 'IQ-SD', nameAr: 'صلاح الدين', nameEnInternal: 'Salah al-Din', sortOrder: 13 },
  { code: 'IQ-DQ', nameAr: 'ذي قار', nameEnInternal: 'Dhi Qar', sortOrder: 14 },
  { code: 'IQ-QA', nameAr: 'القادسية', nameEnInternal: 'Al-Qadisiyyah', sortOrder: 15 },
  { code: 'IQ-MA', nameAr: 'ميسان', nameEnInternal: 'Maysan', sortOrder: 16 },
  { code: 'IQ-MU', nameAr: 'المثنى', nameEnInternal: 'Al Muthanna', sortOrder: 17 },
  { code: 'IQ-WA', nameAr: 'واسط', nameEnInternal: 'Wasit', sortOrder: 18 },
  { code: 'IQ-HA', nameAr: 'حلبجة', nameEnInternal: 'Halabja', sortOrder: 19 },
];

/**
 * Canonical cities and district centres. This is the launch dataset: every row
 * must exist before public launch, with all capabilities defaulting to false
 * until Operations activates a service area (plan §9).
 */
export const CITIES: readonly CitySeed[] = [
  // ── Baghdad ──────────────────────────────────────────────────────────────
  { code: 'IQ-BG-BAGHDAD', governorateCode: 'IQ-BG', nameAr: 'بغداد', nameEnInternal: 'Baghdad' },
  { code: 'IQ-BG-KARKH', governorateCode: 'IQ-BG', nameAr: 'الكرخ', nameEnInternal: 'Karkh' },
  { code: 'IQ-BG-RUSAFA', governorateCode: 'IQ-BG', nameAr: 'الرصافة', nameEnInternal: 'Rusafa' },
  {
    code: 'IQ-BG-ADHAMIYAH',
    governorateCode: 'IQ-BG',
    nameAr: 'الأعظمية',
    nameEnInternal: 'Adhamiyah',
  },
  {
    code: 'IQ-BG-KADHIMIYA',
    governorateCode: 'IQ-BG',
    nameAr: 'الكاظمية',
    nameEnInternal: 'Kadhimiya',
  },
  {
    code: 'IQ-BG-SADR-CITY',
    governorateCode: 'IQ-BG',
    nameAr: 'مدينة الصدر',
    nameEnInternal: 'Sadr City',
  },
  {
    code: 'IQ-BG-MAHMUDIYAH',
    governorateCode: 'IQ-BG',
    nameAr: 'المحمودية',
    nameEnInternal: 'Mahmudiyah',
  },
  {
    code: 'IQ-BG-TARMIYAH',
    governorateCode: 'IQ-BG',
    nameAr: 'الطارمية',
    nameEnInternal: 'Tarmiyah',
  },
  {
    code: 'IQ-BG-ABU-GHRAIB',
    governorateCode: 'IQ-BG',
    nameAr: 'أبو غريب',
    nameEnInternal: 'Abu Ghraib',
  },
  {
    code: 'IQ-BG-MADAIN',
    governorateCode: 'IQ-BG',
    nameAr: 'المدائن',
    nameEnInternal: 'Al-Madain',
  },
  { code: 'IQ-BG-TAJI', governorateCode: 'IQ-BG', nameAr: 'التاجي', nameEnInternal: 'Taji' },
  {
    code: 'IQ-BG-HUSSEINIYA',
    governorateCode: 'IQ-BG',
    nameAr: 'الحسينية',
    nameEnInternal: 'Husseiniya',
  },

  // ── Basra ────────────────────────────────────────────────────────────────
  { code: 'IQ-BA-BASRA', governorateCode: 'IQ-BA', nameAr: 'البصرة', nameEnInternal: 'Basra' },
  { code: 'IQ-BA-ZUBAYR', governorateCode: 'IQ-BA', nameAr: 'الزبير', nameEnInternal: 'Az Zubayr' },
  { code: 'IQ-BA-QURNA', governorateCode: 'IQ-BA', nameAr: 'القرنة', nameEnInternal: 'Al Qurna' },
  {
    code: 'IQ-BA-MADINA',
    governorateCode: 'IQ-BA',
    nameAr: 'المدينة',
    nameEnInternal: 'Al Madina',
  },
  {
    code: 'IQ-BA-SHATT-AL-ARAB',
    governorateCode: 'IQ-BA',
    nameAr: 'شط العرب',
    nameEnInternal: 'Shatt al-Arab',
  },
  {
    code: 'IQ-BA-ABU-AL-KHASIB',
    governorateCode: 'IQ-BA',
    nameAr: 'أبو الخصيب',
    nameEnInternal: 'Abu Al-Khaseeb',
  },
  { code: 'IQ-BA-FAW', governorateCode: 'IQ-BA', nameAr: 'الفاو', nameEnInternal: 'Al Faw' },
  { code: 'IQ-BA-SAFWAN', governorateCode: 'IQ-BA', nameAr: 'سفوان', nameEnInternal: 'Safwan' },

  // ── Nineveh ──────────────────────────────────────────────────────────────
  { code: 'IQ-NI-MOSUL', governorateCode: 'IQ-NI', nameAr: 'الموصل', nameEnInternal: 'Mosul' },
  { code: 'IQ-NI-TALAFAR', governorateCode: 'IQ-NI', nameAr: 'تلعفر', nameEnInternal: 'Tal Afar' },
  { code: 'IQ-NI-SINJAR', governorateCode: 'IQ-NI', nameAr: 'سنجار', nameEnInternal: 'Sinjar' },
  { code: 'IQ-NI-BAAJ', governorateCode: 'IQ-NI', nameAr: 'البعاج', nameEnInternal: 'Al-Baaj' },
  {
    code: 'IQ-NI-HAMDANIYA',
    governorateCode: 'IQ-NI',
    nameAr: 'الحمدانية',
    nameEnInternal: 'Al-Hamdaniya',
  },
  { code: 'IQ-NI-TALKAIF', governorateCode: 'IQ-NI', nameAr: 'تلكيف', nameEnInternal: 'Tel Keppe' },
  { code: 'IQ-NI-SHIKHAN', governorateCode: 'IQ-NI', nameAr: 'الشيخان', nameEnInternal: 'Shekhan' },
  { code: 'IQ-NI-HATRA', governorateCode: 'IQ-NI', nameAr: 'الحضر', nameEnInternal: 'Hatra' },
  { code: 'IQ-NI-MAKHMOUR', governorateCode: 'IQ-NI', nameAr: 'مخمور', nameEnInternal: 'Makhmour' },

  // ── Erbil ────────────────────────────────────────────────────────────────
  { code: 'IQ-AR-ERBIL', governorateCode: 'IQ-AR', nameAr: 'أربيل', nameEnInternal: 'Erbil' },
  {
    code: 'IQ-AR-SHAQLAWA',
    governorateCode: 'IQ-AR',
    nameAr: 'شقلاوة',
    nameEnInternal: 'Shaqlawa',
  },
  { code: 'IQ-AR-KOYA', governorateCode: 'IQ-AR', nameAr: 'كويسنجق', nameEnInternal: 'Koya' },
  { code: 'IQ-AR-SORAN', governorateCode: 'IQ-AR', nameAr: 'سوران', nameEnInternal: 'Soran' },
  { code: 'IQ-AR-CHOMAN', governorateCode: 'IQ-AR', nameAr: 'جومان', nameEnInternal: 'Choman' },
  {
    code: 'IQ-AR-MERGASUR',
    governorateCode: 'IQ-AR',
    nameAr: 'ميركة سور',
    nameEnInternal: 'Mergasur',
  },
  { code: 'IQ-AR-KHABAT', governorateCode: 'IQ-AR', nameAr: 'الخبات', nameEnInternal: 'Khabat' },
  {
    code: 'IQ-AR-RAWANDUZ',
    governorateCode: 'IQ-AR',
    nameAr: 'راوندوز',
    nameEnInternal: 'Rawanduz',
  },

  // ── Sulaymaniyah ─────────────────────────────────────────────────────────
  {
    code: 'IQ-SU-SULAYMANIYAH',
    governorateCode: 'IQ-SU',
    nameAr: 'السليمانية',
    nameEnInternal: 'Sulaymaniyah',
  },
  { code: 'IQ-SU-RANIYA', governorateCode: 'IQ-SU', nameAr: 'رانية', nameEnInternal: 'Raniya' },
  { code: 'IQ-SU-DOKAN', governorateCode: 'IQ-SU', nameAr: 'دوكان', nameEnInternal: 'Dokan' },
  {
    code: 'IQ-SU-CHAMCHAMAL',
    governorateCode: 'IQ-SU',
    nameAr: 'جمجمال',
    nameEnInternal: 'Chamchamal',
  },
  { code: 'IQ-SU-KALAR', governorateCode: 'IQ-SU', nameAr: 'كلار', nameEnInternal: 'Kalar' },
  { code: 'IQ-SU-PENJWIN', governorateCode: 'IQ-SU', nameAr: 'بنجوين', nameEnInternal: 'Penjwin' },
  {
    code: 'IQ-SU-DARBANDIKHAN',
    governorateCode: 'IQ-SU',
    nameAr: 'دربنديخان',
    nameEnInternal: 'Darbandikhan',
  },
  {
    code: 'IQ-SU-HALABJA-OLD',
    governorateCode: 'IQ-SU',
    nameAr: 'سيد صادق',
    nameEnInternal: 'Sayid Sadiq',
  },
  {
    code: 'IQ-SU-SHARBAZHER',
    governorateCode: 'IQ-SU',
    nameAr: 'شاربازير',
    nameEnInternal: 'Sharbazher',
  },

  // ── Duhok ────────────────────────────────────────────────────────────────
  { code: 'IQ-DA-DUHOK', governorateCode: 'IQ-DA', nameAr: 'دهوك', nameEnInternal: 'Duhok' },
  { code: 'IQ-DA-ZAKHO', governorateCode: 'IQ-DA', nameAr: 'زاخو', nameEnInternal: 'Zakho' },
  { code: 'IQ-DA-AMEDI', governorateCode: 'IQ-DA', nameAr: 'العمادية', nameEnInternal: 'Amedi' },
  { code: 'IQ-DA-SIMELE', governorateCode: 'IQ-DA', nameAr: 'سميل', nameEnInternal: 'Semel' },
  { code: 'IQ-DA-AKRE', governorateCode: 'IQ-DA', nameAr: 'عقرة', nameEnInternal: 'Akre' },
  {
    code: 'IQ-DA-BARDARASH',
    governorateCode: 'IQ-DA',
    nameAr: 'برديرش',
    nameEnInternal: 'Bardarash',
  },

  // ── Kirkuk ───────────────────────────────────────────────────────────────
  { code: 'IQ-KI-KIRKUK', governorateCode: 'IQ-KI', nameAr: 'كركوك', nameEnInternal: 'Kirkuk' },
  { code: 'IQ-KI-HAWIJA', governorateCode: 'IQ-KI', nameAr: 'الحويجة', nameEnInternal: 'Hawija' },
  { code: 'IQ-KI-DAQUQ', governorateCode: 'IQ-KI', nameAr: 'داقوق', nameEnInternal: 'Daquq' },
  { code: 'IQ-KI-DIBIS', governorateCode: 'IQ-KI', nameAr: 'دبس', nameEnInternal: 'Dibis' },

  // ── Najaf ────────────────────────────────────────────────────────────────
  { code: 'IQ-NA-NAJAF', governorateCode: 'IQ-NA', nameAr: 'النجف', nameEnInternal: 'Najaf' },
  { code: 'IQ-NA-KUFA', governorateCode: 'IQ-NA', nameAr: 'الكوفة', nameEnInternal: 'Kufa' },
  {
    code: 'IQ-NA-MANATHERA',
    governorateCode: 'IQ-NA',
    nameAr: 'المناذرة',
    nameEnInternal: 'Al-Manathera',
  },
  {
    code: 'IQ-NA-MISHKHAB',
    governorateCode: 'IQ-NA',
    nameAr: 'المشخاب',
    nameEnInternal: 'Al-Mishkhab',
  },

  // ── Karbala ──────────────────────────────────────────────────────────────
  { code: 'IQ-KA-KARBALA', governorateCode: 'IQ-KA', nameAr: 'كربلاء', nameEnInternal: 'Karbala' },
  {
    code: 'IQ-KA-HINDIYA',
    governorateCode: 'IQ-KA',
    nameAr: 'الهندية',
    nameEnInternal: 'Al-Hindiya',
  },
  {
    code: 'IQ-KA-AIN-TAMR',
    governorateCode: 'IQ-KA',
    nameAr: 'عين التمر',
    nameEnInternal: 'Ain al-Tamr',
  },

  // ── Babil ────────────────────────────────────────────────────────────────
  { code: 'IQ-BB-HILLA', governorateCode: 'IQ-BB', nameAr: 'الحلة', nameEnInternal: 'Hilla' },
  {
    code: 'IQ-BB-MAHAWEEL',
    governorateCode: 'IQ-BB',
    nameAr: 'المحاويل',
    nameEnInternal: 'Al-Mahaweel',
  },
  {
    code: 'IQ-BB-MUSAYYIB',
    governorateCode: 'IQ-BB',
    nameAr: 'المسيب',
    nameEnInternal: 'Al-Musayyib',
  },
  {
    code: 'IQ-BB-HASHIMIYA',
    governorateCode: 'IQ-BB',
    nameAr: 'الهاشمية',
    nameEnInternal: 'Al-Hashimiya',
  },

  // ── Al Anbar ─────────────────────────────────────────────────────────────
  { code: 'IQ-AN-RAMADI', governorateCode: 'IQ-AN', nameAr: 'الرمادي', nameEnInternal: 'Ramadi' },
  {
    code: 'IQ-AN-FALLUJA',
    governorateCode: 'IQ-AN',
    nameAr: 'الفلوجة',
    nameEnInternal: 'Fallujah',
  },
  { code: 'IQ-AN-HIT', governorateCode: 'IQ-AN', nameAr: 'هيت', nameEnInternal: 'Hit' },
  { code: 'IQ-AN-HADITHA', governorateCode: 'IQ-AN', nameAr: 'حديثة', nameEnInternal: 'Haditha' },
  { code: 'IQ-AN-ANAH', governorateCode: 'IQ-AN', nameAr: 'عنة', nameEnInternal: 'Anah' },
  { code: 'IQ-AN-QAIM', governorateCode: 'IQ-AN', nameAr: 'القائم', nameEnInternal: 'Al-Qaim' },
  { code: 'IQ-AN-RUTBA', governorateCode: 'IQ-AN', nameAr: 'الرطبة', nameEnInternal: 'Rutba' },

  // ── Diyala ───────────────────────────────────────────────────────────────
  { code: 'IQ-DI-BAQUBA', governorateCode: 'IQ-DI', nameAr: 'بعقوبة', nameEnInternal: 'Baquba' },
  {
    code: 'IQ-DI-MUQDADIYA',
    governorateCode: 'IQ-DI',
    nameAr: 'المقدادية',
    nameEnInternal: 'Al-Muqdadiya',
  },
  { code: 'IQ-DI-KHALIS', governorateCode: 'IQ-DI', nameAr: 'الخالص', nameEnInternal: 'Al-Khalis' },
  {
    code: 'IQ-DI-KHANAQIN',
    governorateCode: 'IQ-DI',
    nameAr: 'خانقين',
    nameEnInternal: 'Khanaqin',
  },
  {
    code: 'IQ-DI-BALADRUZ',
    governorateCode: 'IQ-DI',
    nameAr: 'بلدروز',
    nameEnInternal: 'Baladruz',
  },
  { code: 'IQ-DI-KIFRI', governorateCode: 'IQ-DI', nameAr: 'كفري', nameEnInternal: 'Kifri' },

  // ── Salah al-Din ─────────────────────────────────────────────────────────
  { code: 'IQ-SD-TIKRIT', governorateCode: 'IQ-SD', nameAr: 'تكريت', nameEnInternal: 'Tikrit' },
  { code: 'IQ-SD-SAMARRA', governorateCode: 'IQ-SD', nameAr: 'سامراء', nameEnInternal: 'Samarra' },
  { code: 'IQ-SD-BALAD', governorateCode: 'IQ-SD', nameAr: 'بلد', nameEnInternal: 'Balad' },
  { code: 'IQ-SD-DUJAIL', governorateCode: 'IQ-SD', nameAr: 'الدجيل', nameEnInternal: 'Dujail' },
  {
    code: 'IQ-SD-SHIRQAT',
    governorateCode: 'IQ-SD',
    nameAr: 'الشرقاط',
    nameEnInternal: 'Al-Shirqat',
  },
  { code: 'IQ-SD-BAIJI', governorateCode: 'IQ-SD', nameAr: 'بيجي', nameEnInternal: 'Baiji' },
  {
    code: 'IQ-SD-TOOZ',
    governorateCode: 'IQ-SD',
    nameAr: 'طوزخورماتو',
    nameEnInternal: 'Tooz Khurmatu',
  },

  // ── Dhi Qar ──────────────────────────────────────────────────────────────
  {
    code: 'IQ-DQ-NASIRIYAH',
    governorateCode: 'IQ-DQ',
    nameAr: 'الناصرية',
    nameEnInternal: 'Nasiriyah',
  },
  {
    code: 'IQ-DQ-SHATRA',
    governorateCode: 'IQ-DQ',
    nameAr: 'الشطرة',
    nameEnInternal: 'Al-Shatrah',
  },
  { code: 'IQ-DQ-RIFAI', governorateCode: 'IQ-DQ', nameAr: 'الرفاعي', nameEnInternal: 'Al-Rifai' },
  {
    code: 'IQ-DQ-SUQ-AL-SHUYUKH',
    governorateCode: 'IQ-DQ',
    nameAr: 'سوق الشيوخ',
    nameEnInternal: 'Suq Al-Shuyukh',
  },
  {
    code: 'IQ-DQ-CHIBAYISH',
    governorateCode: 'IQ-DQ',
    nameAr: 'الجبايش',
    nameEnInternal: 'Al-Chibayish',
  },

  // ── Al-Qadisiyyah ────────────────────────────────────────────────────────
  {
    code: 'IQ-QA-DIWANIYAH',
    governorateCode: 'IQ-QA',
    nameAr: 'الديوانية',
    nameEnInternal: 'Diwaniyah',
  },
  { code: 'IQ-QA-AFAK', governorateCode: 'IQ-QA', nameAr: 'عفك', nameEnInternal: 'Afak' },
  {
    code: 'IQ-QA-SHAMIYA',
    governorateCode: 'IQ-QA',
    nameAr: 'الشامية',
    nameEnInternal: 'Al-Shamiya',
  },
  { code: 'IQ-QA-HAMZA', governorateCode: 'IQ-QA', nameAr: 'الحمزة', nameEnInternal: 'Al-Hamza' },

  // ── Maysan ───────────────────────────────────────────────────────────────
  { code: 'IQ-MA-AMARAH', governorateCode: 'IQ-MA', nameAr: 'العمارة', nameEnInternal: 'Amarah' },
  {
    code: 'IQ-MA-MAJAR',
    governorateCode: 'IQ-MA',
    nameAr: 'المجر الكبير',
    nameEnInternal: 'Majar al-Kabir',
  },
  {
    code: 'IQ-MA-QALAT-SALIH',
    governorateCode: 'IQ-MA',
    nameAr: 'قلعة صالح',
    nameEnInternal: 'Qalat Salih',
  },
  {
    code: 'IQ-MA-ALI-GHARBI',
    governorateCode: 'IQ-MA',
    nameAr: 'علي الغربي',
    nameEnInternal: 'Ali al-Gharbi',
  },
  { code: 'IQ-MA-KAHLA', governorateCode: 'IQ-MA', nameAr: 'الكحلاء', nameEnInternal: 'Al-Kahla' },

  // ── Al Muthanna ──────────────────────────────────────────────────────────
  { code: 'IQ-MU-SAMAWAH', governorateCode: 'IQ-MU', nameAr: 'السماوة', nameEnInternal: 'Samawah' },
  {
    code: 'IQ-MU-RUMAITHA',
    governorateCode: 'IQ-MU',
    nameAr: 'الرميثة',
    nameEnInternal: 'Al-Rumaitha',
  },
  {
    code: 'IQ-MU-KHIDHIR',
    governorateCode: 'IQ-MU',
    nameAr: 'الخضر',
    nameEnInternal: 'Al-Khidhir',
  },
  {
    code: 'IQ-MU-SALMAN',
    governorateCode: 'IQ-MU',
    nameAr: 'السلمان',
    nameEnInternal: 'Al-Salman',
  },

  // ── Wasit ────────────────────────────────────────────────────────────────
  { code: 'IQ-WA-KUT', governorateCode: 'IQ-WA', nameAr: 'الكوت', nameEnInternal: 'Kut' },
  {
    code: 'IQ-WA-SUWAIRA',
    governorateCode: 'IQ-WA',
    nameAr: 'الصويرة',
    nameEnInternal: 'Al-Suwaira',
  },
  {
    code: 'IQ-WA-AZIZIYA',
    governorateCode: 'IQ-WA',
    nameAr: 'العزيزية',
    nameEnInternal: 'Al-Aziziya',
  },
  {
    code: 'IQ-WA-NUMANIYA',
    governorateCode: 'IQ-WA',
    nameAr: 'النعمانية',
    nameEnInternal: 'Al-Numaniya',
  },
  { code: 'IQ-WA-HAI', governorateCode: 'IQ-WA', nameAr: 'الحي', nameEnInternal: 'Al-Hai' },
  { code: 'IQ-WA-BADRA', governorateCode: 'IQ-WA', nameAr: 'بدرة', nameEnInternal: 'Badra' },

  // ── Halabja (19th governorate) ───────────────────────────────────────────
  { code: 'IQ-HA-HALABJA', governorateCode: 'IQ-HA', nameAr: 'حلبجة', nameEnInternal: 'Halabja' },
  { code: 'IQ-HA-KHURMAL', governorateCode: 'IQ-HA', nameAr: 'خورمال', nameEnInternal: 'Khurmal' },
  { code: 'IQ-HA-SIRWAN', governorateCode: 'IQ-HA', nameAr: 'سيروان', nameEnInternal: 'Sirwan' },
  { code: 'IQ-HA-BYARA', governorateCode: 'IQ-HA', nameAr: 'بياره', nameEnInternal: 'Byara' },
];

export const GOVERNORATE_COUNT = GOVERNORATES.length;
export const CITY_COUNT = CITIES.length;

/** Cities grouped by governorate code — used by the seed importer and tests. */
export function citiesByGovernorate(): Map<string, CitySeed[]> {
  const map = new Map<string, CitySeed[]>();
  for (const city of CITIES) {
    const list = map.get(city.governorateCode);
    if (list) list.push(city);
    else map.set(city.governorateCode, [city]);
  }
  return map;
}

/**
 * Validate the dataset's internal consistency. CI runs this before deployment
 * (plan §9) so a bad import can never reach production.
 */
export function validateDataset(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];

  const governorateCodes = new Set<string>();
  for (const governorate of GOVERNORATES) {
    if (governorateCodes.has(governorate.code)) {
      problems.push(`Duplicate governorate code: ${governorate.code}`);
    }
    governorateCodes.add(governorate.code);
  }

  const cityCodes = new Set<string>();
  for (const city of CITIES) {
    if (cityCodes.has(city.code)) problems.push(`Duplicate city code: ${city.code}`);
    cityCodes.add(city.code);
    if (!governorateCodes.has(city.governorateCode)) {
      problems.push(`City ${city.code} references unknown governorate ${city.governorateCode}`);
    }
    if (!city.code.startsWith(`${city.governorateCode}-`)) {
      problems.push(`City code ${city.code} does not follow the <governorate>-<slug> convention`);
    }
  }

  for (const governorate of GOVERNORATES) {
    const count = CITIES.filter((c) => c.governorateCode === governorate.code).length;
    if (count === 0) problems.push(`Governorate ${governorate.code} has no cities`);
  }

  return { ok: problems.length === 0, problems };
}
