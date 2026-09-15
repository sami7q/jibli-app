import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { palette } from '@jibli/design-tokens';
import { Canvas, hexToRgb, mix, rotateHue, type Rgb } from '@jibli/design-tokens/png';
import { and, eq, like, notInArray } from 'drizzle-orm';
import type { Database } from '../client.js';
import { uuidv7 } from '../ids.js';
import { assetBytes, assets } from '../schema/index.js';

/**
 * Placeholder artwork for the demo marketplace.
 *
 * A restaurant with no cover photograph is the normal state on the day it is
 * approved, and the app handles it — a tinted ground with the mark. But a whole
 * marketplace of those looks unfinished, and it hides the thing the cover is
 * actually for: proving that the scrim keeps the white badges readable, that
 * the card's aspect ratio is right, that the banner carousel has something to
 * carry.
 *
 * So each demo restaurant gets art of its own: the brand orange turned around
 * the colour wheel by a fixed amount per cuisine, lit from one direction, with
 * soft light behind it. Generated rather than photographed because a stock
 * photograph in a repository is a licensing question nobody wants, and because
 * these are meant to be replaced — the day a restaurant uploads its own, this
 * disappears.
 *
 * Stored through the same pipeline an upload uses: a row in `assets`, the bytes
 * in `asset_bytes`, served by `GET /api/v1/assets/:id`. Nothing about the app
 * knows these are synthetic.
 */

const BRAND = hexToRgb('#ff5400');
const INK = hexToRgb('#111827');
const WHITE = hexToRgb(palette.white);

/** Every generated asset carries this, so the set can be found and replaced. */
export const GENERATED_STORAGE_PREFIX = 'demo/generated/';

export interface GeneratedImage {
  readonly storageKey: string;
  readonly png: Buffer;
  /**
   * Null when the bytes came from a file rather than the canvas.
   *
   * The column is nullable and nothing reads it, so the choice is between a
   * measured number, no number, or a number that sounds right. Parsing a JPEG
   * header to fill a field nobody queries is work for its own sake; writing
   * 1920x1080 because that is the recommended export would be a value that
   * looks measured and is not. Null says what is true.
   */
  readonly width: number | null;
  readonly height: number | null;
  /** Defaults to PNG, which is what everything drawn here produces. */
  readonly contentType?: string;
}

/**
 * Where a banner's bytes live — keyed by what those bytes are.
 *
 * `GET /api/v1/assets/:id` answers `Cache-Control: immutable, max-age=1 year`,
 * and that header is only true because an asset id is minted per upload and
 * the bytes behind it never change. Re-seeding the same key with a new file
 * would break exactly that: the phone would hold last week's banner for a year
 * and no amount of re-seeding would reach it.
 *
 * So the digest goes in the key. New artwork is a new key, a new row, a new
 * id, a new URL — which is a cache miss, which is the point. The same artwork
 * seeded twice lands on the same key and rewrites nothing.
 *
 * Twelve hex characters: a collision needs about 16 million banners, and the
 * cost of one would be a stale image rather than anything dangerous.
 */
const bannerStorageKey = (key: string, png: Buffer): string =>
  `seed/banner/${key}-${createHash('sha1').update(png).digest('hex').slice(0, 12)}.png`;

/** The prefix every banner asset shares, superseded ones included. */
export const BANNER_STORAGE_PREFIX = 'seed/banner/';

/**
 * How large a banner may be before the seed says something.
 *
 * Not enforced — a warning, because the alternative is a seed that refuses to
 * run over a file size, and the person who exported it is the one who should
 * decide. 600KB is about where a 1920×1080 JPEG at quality 80 lands; a 2MB one
 * is a full-quality export that nobody re-encoded, and the home screen is the
 * first request a customer on a phone network makes.
 */
const BANNER_SIZE_WARNING = 600 * 1024;

/**
 * Deterministic pseudo-randomness.
 *
 * The same seed must produce the same cover on every run, or re-seeding
 * reshuffles the marketplace's artwork for no reason and every screenshot
 * taken yesterday stops matching.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

function hashOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * A restaurant cover: 800×450, which is the card's 16:9 at twice the density
 * of a 400pt-wide phone.
 *
 * `hueShift` is what makes six restaurants look like six restaurants rather
 * than one repeated. It stays inside the same saturation and lightness as the
 * brand, so the set still reads as one product.
 */
export function restaurantCover(seedText: string, hueShift: number): GeneratedImage {
  const width = 800;
  const height = 450;
  const canvas = new Canvas(width, height);
  const random = rng(hashOf(seedText));

  const base = rotateHue(BRAND, hueShift);
  const deep = mix(base, INK, 0.58);
  const light = mix(base, WHITE, 0.12);

  // Lit from the top-right, which is where the eye starts in an RTL layout.
  canvas.gradient(light, deep, 125);

  // Soft light, largest first, so the smaller ones read as being in front.
  for (let i = 0; i < 7; i += 1) {
    const radius = height * (0.55 - i * 0.05) * (0.7 + random() * 0.6);
    canvas.glow(
      random() * width,
      random() * height,
      radius,
      i % 2 === 0 ? WHITE : mix(base, WHITE, 0.6),
      0.06 + random() * 0.07,
    );
  }

  // A few crisp discs for structure — plates, seen from above and out of focus.
  for (let i = 0; i < 3; i += 1) {
    const radius = height * (0.18 + random() * 0.14);
    const cx = random() * width;
    const cy = height * (0.2 + random() * 0.6);
    canvas.disc(cx, cy, radius, mix(base, WHITE, 0.55), 0.2);
    canvas.disc(cx, cy, radius * 0.66, mix(base, INK, 0.3), 0.16);
    canvas.disc(cx, cy, radius * 0.4, mix(base, WHITE, 0.4), 0.14);
  }

  /*
   * The scrim the badges sit on.
   *
   * The card draws its own gradient over the photograph too, but baking a
   * softer one in means the ETA chip is readable even on the frame before the
   * overlay paints.
   */
  canvas.bottomScrim(height * 0.42, INK, 0.34);

  return {
    storageKey: `${GENERATED_STORAGE_PREFIX}cover-${seedText}.png`,
    png: canvas.png(),
    width,
    height,
  };
}

/**
 * A restaurant logo: a rounded square with the first letter's counter-space
 * suggested by two discs.
 *
 * Not a letter — rasterising Arabic type needs a font engine, and a glyph drawn
 * wrong is worse than a shape drawn deliberately. The app already shows the
 * real first letter over a tint when there is no logo, so this exists for the
 * places that want an image: the portal header, the order card.
 */
export function restaurantLogo(seedText: string, hueShift: number): GeneratedImage {
  const size = 256;
  const canvas = new Canvas(size, size);
  const base = rotateHue(BRAND, hueShift);

  canvas.gradient(mix(base, WHITE, 0.1), mix(base, INK, 0.3), 135);
  canvas.glow(size * 0.3, size * 0.28, size * 0.5, WHITE, 0.18);

  // A plate and a pin's head: the brand mark, reduced to two circles.
  canvas.disc(size / 2, size * 0.56, size * 0.26, WHITE, 0.92);
  canvas.disc(size / 2, size * 0.56, size * 0.17, base, 1);
  canvas.disc(size / 2, size * 0.3, size * 0.1, WHITE, 0.92);

  return {
    storageKey: `${GENERATED_STORAGE_PREFIX}logo-${seedText}.png`,
    png: canvas.png(),
    width: size,
    height: size,
  };
}

/** What a dropped-in file is actually made of, so it is not served as a lie. */
const BANNER_MEDIA_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Finished artwork, when somebody has supplied it.
 *
 * `packages/db/seed-assets/banners/<key>.<ext>` replaces the generated
 * placeholder for that banner and nothing else changes — same row, same link,
 * same schedule, same asset id. A key with no file keeps its placeholder, so a
 * designer can deliver them one at a time without the seed caring, and a
 * checkout with an empty folder still comes up looking finished.
 */
function bannerFromFile(key: string): GeneratedImage | null {
  const directory = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'seed-assets',
    'banners',
  );

  for (const [extension, contentType] of Object.entries(BANNER_MEDIA_TYPES)) {
    const path = join(directory, `${key}.${extension}`);
    if (!existsSync(path)) continue;

    const png = readFileSync(path);

    if (png.byteLength > BANNER_SIZE_WARNING) {
      console.warn(
        `  ⚠ ${key}.${extension} is ${Math.round(png.byteLength / 1024)}KB. ` +
          'The home screen loads it first; re-export at 1920×1080, quality ~80.',
      );
    }

    return {
      storageKey: bannerStorageKey(key, png),
      png,
      width: null,
      height: null,
      contentType,
    };
  }

  return null;
}

/**
 * A promo banner, drawn only because nobody has supplied one.
 *
 * 16:9, because that is the slot: the app crops nothing, so a placeholder at
 * any other ratio would be shown to developers in a shape no real banner will
 * ever appear in. 1280×720 is enough — this is scaffolding for a demo
 * database, and the real ones arrive as files.
 *
 * No text is drawn over a banner that has artwork, and this counts as artwork,
 * so the art has the frame to itself and does not need to keep a quiet side
 * clear for a headline.
 */
export function promoBanner(seedText: string, from: string, to: string): GeneratedImage {
  // Real art wins over anything drawn here.
  const supplied = bannerFromFile(seedText);
  if (supplied) return supplied;

  const width = 1280;
  const height = 720;
  const canvas = new Canvas(width, height);
  const random = rng(hashOf(seedText));

  canvas.gradient(hexToRgb(from), hexToRgb(to), 155);

  // Interest on the left half, where no text goes.
  for (let i = 0; i < 5; i += 1) {
    canvas.glow(
      width * (0.05 + random() * 0.4),
      height * random(),
      height * (0.3 + random() * 0.45),
      WHITE,
      0.07 + random() * 0.06,
    );
  }

  canvas.disc(width * 0.22, height * 0.52, height * 0.3, WHITE, 0.12);
  canvas.disc(width * 0.22, height * 0.52, height * 0.19, WHITE, 0.14);

  /*
   * A corner weighted rather than a half veiled.
   *
   * There used to be an ink gradient over the right 55%, holding white type
   * against a bright ground. The app stopped drawing that type — a banner with
   * artwork is the artwork — so the veil became a shadow over nothing, and a
   * placeholder dimmed down one side teaches the wrong thing about what this
   * slot does to an image.
   */
  for (let y = 0; y < height; y += 1) {
    for (let x = Math.floor(width * 0.6); x < width; x += 1) {
      const t = (x - width * 0.6) / (width * 0.4);
      canvas.blend(x, y, INK, t * (y / height) * 0.14);
    }
  }

  const png = canvas.png();

  return {
    storageKey: bannerStorageKey(seedText, png),
    png,
    width,
    height,
  };
}

/**
 * Insert (or refresh) an image and return its asset id.
 *
 * Keyed on `storage_key`, which is unique — so a second seed run rewrites the
 * bytes of the same asset rather than orphaning the old one and minting a new
 * id. That matters more than it looks: the asset id is the URL, and the app
 * caches those for a year.
 */
export async function upsertImageAsset(
  db: Database,
  image: GeneratedImage,
  restaurantId: string | null,
): Promise<string> {
  const [existing] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.storageKey, image.storageKey))
    .limit(1);

  const assetId = existing?.id ?? uuidv7();

  if (existing) {
    await db
      .update(assets)
      .set({
        contentType: image.contentType ?? 'image/png',
        byteSize: image.png.byteLength,
        width: image.width,
        height: image.height,
        deletedAt: null,
      })
      .where(eq(assets.id, assetId));
    await db.update(assetBytes).set({ data: image.png }).where(eq(assetBytes.assetId, assetId));
  } else {
    await db.insert(assets).values({
      id: assetId,
      storageKey: image.storageKey,
      bucket: 'demo',
      visibility: 'PUBLIC',
      contentType: image.contentType ?? 'image/png',
      byteSize: image.png.byteLength,
      width: image.width,
      height: image.height,
      restaurantId,
      // Nothing was uploaded, so nothing is waiting to be scanned.
      scanStatus: 'CLEAN',
    });
    await db.insert(assetBytes).values({ assetId, data: image.png });
  }

  return assetId;
}

/**
 * Delete the banner assets nothing points at any more.
 *
 * A digest in the key means replacing artwork inserts rather than overwrites,
 * so every superseded banner would otherwise sit in `asset_bytes` forever — a
 * couple of megabytes per revision, in a table whose whole purpose is being
 * read by one route. `asset_bytes` cascades, so deleting the asset takes its
 * bytes with it.
 *
 * Scoped to this prefix on purpose: it must never be able to reach an asset a
 * restaurant uploaded.
 */
export async function pruneSupersededBanners(db: Database, keepIds: string[]): Promise<number> {
  const deleted = await db
    .delete(assets)
    .where(
      and(
        like(assets.storageKey, `${BANNER_STORAGE_PREFIX}%`),
        keepIds.length > 0 ? notInArray(assets.id, keepIds) : undefined,
      ),
    )
    .returning({ id: assets.id });

  return deleted.length;
}

/**
 * Hue offsets per demo restaurant.
 *
 * The brand orange sits at about 20° on the wheel, and food photography lives
 * in the warm band either side of it — red through orange to amber. The range
 * here is deliberately narrow, roughly 350° to 42°: the first attempt used ±45
 * and a shawarma restaurant came out yellow-green, which is the colour of
 * nothing anybody wants to eat.
 */
export const DEMO_HUE_SHIFTS: Readonly<Record<string, number>> = {
  'DEMO-1001': 0, // mandi — the brand orange itself
  'DEMO-1002': -16, // burger — red-orange
  'DEMO-1003': 14, // pizza — toward amber
  'DEMO-1004': 22, // shawarma — amber
  'DEMO-1005': -30, // sweets — crimson
  'DEMO-1006': -8, // grills — deep red-orange
};

/** The banners the home carousel shows, art and copy together. */
export const DEMO_BANNERS: readonly {
  key: string;
  titleAr: string;
  subtitleAr: string;
  from: string;
  to: string;
  linkType: 'NONE' | 'CATEGORY';
  linkValue: string | null;
  /**
   * Which storefront it runs in. Omitted means the food one, which is what
   * every banner written before markets existed meant.
   *
   * The market banners are drawn from `palette.green` and the food ones from
   * `palette.orange` — the same two ramps the app itself is tinted with, so a
   * placeholder matches the section it appears in rather than approximating
   * it. The two halves should not be distinguishable only by their text: a
   * customer who has switched sections should be able to tell from across the
   * room.
   */
  merchantType?: 'RESTAURANT' | 'MARKET';
}[] = [
  {
    key: 'market_welcome',
    titleAr: 'جيبلي ماركت',
    subtitleAr: 'بقالتك كاملة، تصل خلال دقائق',
    from: palette.green[400],
    to: palette.green[700],
    linkType: 'NONE',
    linkValue: null,
    merchantType: 'MARKET',
  },
  {
    key: 'market_produce',
    titleAr: 'خضار وفواكه طازجة',
    subtitleAr: 'من سوق الجملة كل صباح',
    from: palette.green[500],
    to: palette.green[800],
    linkType: 'CATEGORY',
    linkValue: 'mk_produce',
    merchantType: 'MARKET',
  },
  {
    key: 'market_household',
    titleAr: 'تسوّق الشهر',
    subtitleAr: 'كميات الجملة بتوصيل مجاني',
    from: palette.green[600],
    to: palette.green[900],
    linkType: 'CATEGORY',
    linkValue: 'mk_household',
    merchantType: 'MARKET',
  },
  {
    key: 'welcome',
    titleAr: 'أهلاً بك في جيبلي',
    subtitleAr: 'مطاعم بغداد تصلك أينما كنت',
    from: palette.orange[400],
    to: palette.orange[700],
    linkType: 'NONE',
    linkValue: null,
  },
  {
    key: 'grills',
    titleAr: 'مشاوي على الفحم',
    subtitleAr: 'كباب وتكة وقوزي من أفضل المطاعم',
    from: palette.orange[600],
    to: palette.orange[900],
    linkType: 'CATEGORY',
    linkValue: 'grills',
  },
  {
    key: 'sweets',
    titleAr: 'حلويات وقهوة',
    subtitleAr: 'بقلاوة وكنافة تُخبز كل صباح',
    from: palette.orange[700],
    to: palette.orange[900],
    linkType: 'CATEGORY',
    linkValue: 'desserts',
  },
];

// Referenced by the typed signature above; kept explicit so a reader sees the
// shape without opening the token package.
export type { Rgb };
