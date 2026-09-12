import { eq } from 'drizzle-orm';
import { AppError, ERROR_CODES } from '@jibli/contracts';
import { assetBytes, assets, uuidv7 } from '@jibli/db';
import type { AppContext } from '../lib/context.js';

/**
 * Image uploads.
 *
 * The platform had an `assets` table, foreign keys pointing at it from
 * restaurants and menu items, and no way to put an image anywhere — so every
 * logo was a blank square. This is the smallest thing that changes that
 * honestly: validate, store, serve.
 *
 * Bytes go to Postgres rather than an object store. There is no bucket
 * provisioned and no credentials set, a logo is a few tens of kilobytes, and
 * `bytea` above ~2 KB is stored out of line and compressed. When there is a
 * reason to run object storage, `assets.storage_key` and `assets.bucket`
 * already describe the object that replaces the row.
 */

/**
 * What the platform accepts. Deliberately short: these three cover every logo
 * a restaurant will hand over, and each has a signature that can be checked.
 * SVG is absent on purpose — it is a script container, and an uploaded SVG
 * served from our own origin is stored XSS.
 */
const ACCEPTED = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // "RIFF", with "WEBP" at offset 8
} as const;

export type AcceptedContentType = keyof typeof ACCEPTED;

/** 512 KB. A logo that needs more than this needs resizing, not more storage. */
export const MAX_ASSET_BYTES = 512 * 1024;

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

/**
 * Read the format out of the bytes.
 *
 * The declared content type is a claim by the uploader, and believing it is how
 * an HTML file arrives as `image/png` and is later served back from our origin.
 * The signature is the fact.
 */
export function detectImageType(buffer: Buffer): AcceptedContentType | null {
  for (const [type, signatures] of Object.entries(ACCEPTED)) {
    if (!signatures.some((signature) => startsWith(buffer, signature))) continue;
    if (type === 'image/webp') {
      // RIFF is a container; only the WEBP form is an image.
      const form = buffer.subarray(8, 12).toString('ascii');
      if (form !== 'WEBP') continue;
    }
    return type as AcceptedContentType;
  }
  return null;
}

export interface StoreAssetParams {
  readonly base64: string;
  readonly ownerUserId: string;
  readonly restaurantId?: string | null;
  readonly purpose: 'RESTAURANT_LOGO' | 'RESTAURANT_COVER';
}

export interface StoredAsset {
  readonly id: string;
  readonly contentType: AcceptedContentType;
  readonly byteSize: number;
}

export async function storeAsset(
  ctx: AppContext,
  params: StoreAssetParams,
): Promise<StoredAsset> {
  /*
   * Decoded before anything else is trusted. `Buffer.from(..., 'base64')` never
   * throws — it silently skips characters it does not recognise — so the size
   * and the signature of the *decoded* bytes are what decide, not the length or
   * shape of the string that arrived.
   */
  const raw = params.base64.includes(',')
    ? params.base64.slice(params.base64.indexOf(',') + 1)
    : params.base64;
  const buffer = Buffer.from(raw, 'base64');

  if (buffer.byteLength === 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { reason: 'EMPTY_FILE' },
      messageAr: 'الملف فارغ أو تالف',
    });
  }

  if (buffer.byteLength > MAX_ASSET_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { reason: 'FILE_TOO_LARGE', max_bytes: MAX_ASSET_BYTES },
      messageAr: 'حجم الصورة أكبر من 512 كيلوبايت',
    });
  }

  const contentType = detectImageType(buffer);
  if (!contentType) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { reason: 'UNSUPPORTED_IMAGE' },
      messageAr: 'الصيغة غير مدعومة. استخدم PNG أو JPG أو WebP',
    });
  }

  const id = uuidv7();
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.slice('image/'.length);

  await ctx.db.transaction(async (tx) => {
    await tx.insert(assets).values({
      id,
      /*
       * Generated, never the uploader's filename: a name chosen by someone else
       * has no business in a path, and the original is of no use to us.
       */
      storageKey: `${params.purpose.toLowerCase()}/${id}.${extension}`,
      bucket: 'db',
      visibility: 'PUBLIC',
      contentType,
      byteSize: buffer.byteLength,
      ownerUserId: params.ownerUserId,
      restaurantId: params.restaurantId ?? null,
      // Nothing scans these yet; saying CLEAN would be a claim we cannot make.
      scanStatus: 'PENDING',
    });

    await tx.insert(assetBytes).values({ assetId: id, data: buffer });
  });

  ctx.logger.info(
    { event: 'asset.stored', assetId: id, contentType, byteSize: buffer.byteLength },
    'Asset stored',
  );

  return { id, contentType, byteSize: buffer.byteLength };
}

export interface AssetPayload {
  readonly data: Buffer;
  readonly contentType: string;
  readonly byteSize: number;
}

export async function readAsset(ctx: AppContext, assetId: string): Promise<AssetPayload | null> {
  const [row] = await ctx.db
    .select({
      data: assetBytes.data,
      contentType: assets.contentType,
      byteSize: assets.byteSize,
      deletedAt: assets.deletedAt,
    })
    .from(assetBytes)
    .innerJoin(assets, eq(assets.id, assetBytes.assetId))
    .where(eq(assetBytes.assetId, assetId))
    .limit(1);

  if (!row || row.deletedAt) return null;
  return { data: row.data, contentType: row.contentType, byteSize: row.byteSize };
}
