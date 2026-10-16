import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { api } from './api';

/**
 * A photograph, from the phone to the server.
 *
 * Three steps that belong together because each one exists for the next:
 * pick (camera or library), shrink to the tier the picture will be drawn at,
 * and post the result as a data URL to `POST /uploads`. A 12-megapixel phone
 * photo posted raw is ~5 MB of base64 against a 5 MB ceiling — it would fail,
 * and slowly — so the shrink is not an optimisation, it is what makes the
 * upload possible on a shop's connection.
 *
 * The tiers are the web portal's (`packages/ui-web/src/logo-upload.tsx`), so a
 * product photographed in the aisle and one uploaded from the laptop arrive
 * at the same size. If they drift, the drift is invisible until a grocer's
 * photo looks worse than the same photo from a browser.
 */
export const IMAGE_TIERS = {
  /** A logo: never drawn above ~120pt, so 512 on the long edge is plenty. */
  icon: { maxEdgePx: 512, quality: 0.9 },
  /** A product photo: the card and the sheet, up to a phone's width at 3×. */
  photo: { maxEdgePx: 1280, quality: 0.92 },
} as const;

export type ImageTier = keyof typeof IMAGE_TIERS;
export type PickSource = 'camera' | 'library';

export type PickOutcome =
  | {
      readonly status: 'picked';
      readonly dataUrl: string;
      readonly width: number;
      readonly height: number;
    }
  | { readonly status: 'cancelled' }
  /** Refused by the system prompt; only the settings app can undo it. */
  | { readonly status: 'denied'; readonly source: PickSource }
  | { readonly status: 'failed'; readonly message: string };

/**
 * Let the owner take or choose a picture, and hand back something postable.
 *
 * Never throws: a refused permission or a cancelled sheet is an outcome the
 * screen says something about, not an error to be caught in four places.
 */
export async function pickImage(source: PickSource, tier: ImageTier): Promise<PickOutcome> {
  try {
    /*
     * Only the camera asks first.
     *
     * The library opens the system photo picker — PHPicker on iOS, the Android
     * photo picker (back-ported to old versions through Play services) — which
     * runs outside the app and needs no permission at all. Asking anyway was
     * worse than redundant: on Android 12 and below the request is for the
     * storage pair, which `blockedPermissions` strips from the manifest, so it
     * always came back «denied» and the owner was sent to a settings switch
     * that does not exist; on iOS it raised a full-library prompt for a picker
     * that never reads the library. The browser has its own file dialog.
     */
    if (Platform.OS !== 'web' && source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return { status: 'denied', source };
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      // Full quality here; the shrink below decides what is kept.
      quality: 1,
      allowsEditing: false,
      exif: false,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return { status: 'cancelled' };

    return { status: 'picked', ...(await shrink(asset.uri, asset.width, asset.height, tier)) };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

/** Resize to the tier's long edge, re-encode as JPEG, and return a data URL. */
async function shrink(
  uri: string,
  width: number,
  height: number,
  tier: ImageTier,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { maxEdgePx, quality } = IMAGE_TIERS[tier];

  /*
   * A picker on the web may not know the dimensions. Resizing by width to the
   * ceiling is then the safe guess: an image already smaller is scaled up a
   * little, which costs bytes but never a failed upload.
   */
  const known = width > 0 && height > 0;
  const longest = known ? Math.max(width, height) : Number.POSITIVE_INFINITY;
  const actions =
    longest > maxEdgePx
      ? [
          !known || width >= height
            ? { resize: { width: maxEdgePx } }
            : { resize: { height: maxEdgePx } },
        ]
      : [];

  const out = await manipulateAsync(uri, actions, {
    compress: quality,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64) throw new Error('image could not be encoded');

  return { dataUrl: `data:image/jpeg;base64,${out.base64}`, width: out.width, height: out.height };
}

/** Post a picked picture for a shop and get the asset id the catalog stores. */
export async function uploadShopImage(
  shopId: string,
  dataUrl: string,
  purpose: 'MENU_ITEM' | 'RESTAURANT_LOGO',
): Promise<string> {
  const stored = await api.ownerUploadImage(shopId, dataUrl, purpose);
  return stored.asset_id;
}

/** The sentence a refused permission deserves, by what was refused. */
export function describePickOutcome(
  outcome: Exclude<PickOutcome, { status: 'picked' }>,
): string | null {
  switch (outcome.status) {
    case 'cancelled':
      return null;
    case 'denied':
      return outcome.source === 'camera'
        ? 'لم يُسمح باستخدام الكاميرا. فعّلها من إعدادات الهاتف ثم حاول مرة أخرى.'
        : 'لم يُسمح بالوصول إلى الصور. فعّله من إعدادات الهاتف ثم حاول مرة أخرى.';
    case 'failed':
      return 'تعذّر تجهيز الصورة. جرّب صورة أخرى.';
  }
}
