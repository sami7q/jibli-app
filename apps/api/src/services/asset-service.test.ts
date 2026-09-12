import { describe, expect, it } from 'vitest';
import { detectImageType, DEFAULT_MAX_ASSET_BYTES } from './asset-service.js';

/**
 * The upload path decides what a file is from its bytes, not from what the
 * uploader called it. These tests pin that, because the failure mode is not a
 * broken image — it is an HTML file accepted as `image/png` and later served
 * back from our own origin, which is stored XSS.
 */

const png = (extra = 0) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extra),
  ]);

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);

const webp = () =>
  Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.alloc(8),
  ]);

describe('detectImageType()', () => {
  it('recognises the three formats the platform accepts', () => {
    expect(detectImageType(png())).toBe('image/png');
    expect(detectImageType(jpeg())).toBe('image/jpeg');
    expect(detectImageType(webp())).toBe('image/webp');
  });

  it('refuses an SVG, however it is labelled', () => {
    /*
     * Not an oversight: SVG carries script, and one served from our own origin
     * runs with our origin's privileges. There is no safe way to accept it here
     * without sanitising, and sanitising SVG is its own long argument.
     */
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'utf8');
    expect(detectImageType(svg)).toBeNull();
  });

  it('refuses HTML wearing a PNG name', () => {
    const html = Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8');
    expect(detectImageType(html)).toBeNull();
  });

  it('refuses a RIFF container that is not WebP', () => {
    // RIFF is also WAV and AVI. Only the WEBP form is an image.
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'ascii'),
      Buffer.alloc(8),
    ]);
    expect(detectImageType(wav)).toBeNull();
  });

  it('refuses a buffer too short to carry a signature', () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  it('reads the signature, not the rest of the file', () => {
    // A valid header followed by anything at all is still a PNG to us; what we
    // refuse to do is guess from the extension or the declared type.
    expect(detectImageType(png(4096))).toBe('image/png');
  });
});

describe('DEFAULT_MAX_ASSET_BYTES', () => {
  it('matches the platform upload ceiling rather than a number of its own', () => {
    /*
     * `UPLOAD_MAX_BYTES` has been 5 MB in the environment schema all along, and
     * this module used to hard-code 512 KB — so the platform refused photos it
     * was configured to accept. The two must not drift again.
     */
    expect(DEFAULT_MAX_ASSET_BYTES).toBe(5 * 1024 * 1024);
  });
});
