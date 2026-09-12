'use client';

import { useId, useRef, useState } from 'react';

/**
 * Restaurant logo picker.
 *
 * Shared by both portals: Admin sets a logo while creating a restaurant, and
 * the restaurant sets its own from Settings. Same control, same limits, same
 * words — a restaurant told "PNG, JPG or WebP, up to 512 KB" by one screen and
 * something else by the other has been given two rules to remember.
 *
 * The file is read in the browser and posted as base64. That keeps the API on
 * plain JSON, and it is what lets the preview appear the instant a file is
 * chosen rather than after a round trip.
 */

const ACCEPT = 'image/png,image/jpeg,image/webp';

/**
 * What the *file* may be. Matches UPLOAD_MAX_BYTES on the server, and is
 * generous on purpose: a photo straight from a phone is several megabytes, and
 * telling someone to go and shrink it themselves is asking them to do work the
 * browser can do in a few milliseconds.
 */
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

/**
 * What gets uploaded. A logo is displayed at 88px in this control and at about
 * 120px in the app, so anything past 512 on the long edge is bytes nobody sees.
 * Downscaling here means a 4 MB photo arrives as a few tens of kilobytes, the
 * page loads faster for every customer afterwards, and the size limit is
 * something a client has to go out of its way to hit.
 */
const MAX_EDGE_PX = 512;

/**
 * Shrink to fit, re-encode, and keep whichever is smaller.
 *
 * WebP where the browser has it, PNG otherwise — transparency matters for a
 * logo, so JPEG is not an option. If the re-encode somehow comes out larger
 * than the original (already-optimised small PNGs can), the original wins.
 */
async function downscale(file: File): Promise<string> {
  const originalDataUrl = await readAsDataUrl(file);

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('DECODE_FAILED'));
    element.src = originalDataUrl;
  });

  const longest = Math.max(image.width, image.height);
  if (longest <= MAX_EDGE_PX && file.size <= 256 * 1024) return originalDataUrl;

  const scale = Math.min(1, MAX_EDGE_PX / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext('2d');
  if (!context) return originalDataUrl;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const webp = canvas.toDataURL('image/webp', 0.9);
  const encoded = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');

  return encoded.length < originalDataUrl.length ? encoded : originalDataUrl;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.readAsDataURL(file);
  });
}

export interface LogoUploadProps {
  /** Current logo, if the restaurant already has one. */
  readonly value?: string | null;
  /** Called with the new asset id once the upload succeeds, or null on clear. */
  readonly onChange: (assetId: string | null, previewUrl: string | null) => void;
  /** Posts the base64 payload and resolves to the stored asset id. */
  readonly upload: (dataUrl: string) => Promise<{ asset_id: string; url: string }>;
  readonly label?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}

export function LogoUpload({
  value = null,
  onChange,
  upload,
  label = 'شعار المطعم',
  hint = 'PNG أو JPG أو WebP، حتى ٥ ميغابايت. تُصغَّر تلقائياً قبل الرفع.',
  disabled = false,
}: LogoUploadProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (): void => inputRef.current?.click();

  const handle = async (file: File): Promise<void> => {
    setError(null);

    /*
     * Checked before reading, not after: a 40 MB photo read into a data URL is
     * a 53 MB string in memory for a file that was never going to be accepted.
     */
    if (file.size > MAX_SOURCE_BYTES) {
      setError('حجم الصورة أكبر من ٥ ميغابايت. اختر صورة أصغر.');
      return;
    }
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('الصيغة غير مدعومة. استخدم PNG أو JPG أو WebP.');
      return;
    }

    setBusy(true);
    try {
      const dataUrl = await downscale(file);

      // Shown immediately; the server call decides whether it stays.
      setPreview(dataUrl);
      const stored = await upload(dataUrl);
      setPreview(stored.url);
      onChange(stored.asset_id, stored.url);
    } catch {
      setPreview(value);
      setError('تعذّر رفع الصورة. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const clear = (): void => {
    setPreview(null);
    setError(null);
    onChange(null, null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="logo-upload">
      <span className="logo-upload__label" id={`${inputId}-label`}>
        {label}
      </span>

      <div className="logo-upload__row">
        <button
          type="button"
          className={`logo-upload__well${preview ? ' logo-upload__well--filled' : ''}`}
          onClick={pick}
          disabled={disabled || busy}
          aria-describedby={`${inputId}-hint`}
          aria-labelledby={`${inputId}-label`}
        >
          {preview ? (
            <img src={preview} alt="" className="logo-upload__image" />
          ) : (
            <span className="logo-upload__placeholder" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
                <path
                  d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )}
          {busy ? <span className="logo-upload__busy">جارٍ الرفع…</span> : null}
        </button>

        <div className="logo-upload__side">
          <div className="logo-upload__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={pick}
              disabled={disabled || busy}
            >
              {preview ? 'تغيير الصورة' : 'اختيار صورة'}
            </button>
            {preview ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm logo-upload__remove"
                onClick={clear}
                disabled={disabled || busy}
              >
                إزالة
              </button>
            ) : null}
          </div>
          <p className="logo-upload__hint" id={`${inputId}-hint`}>
            {hint}
          </p>
          {error ? (
            <p className="logo-upload__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handle(file);
        }}
      />
    </div>
  );
}
