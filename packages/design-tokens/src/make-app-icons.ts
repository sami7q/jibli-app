import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { color, palette } from './index.js';

/**
 * Generate the app icon, adaptive icon and splash as real PNGs.
 *
 * `app.config.ts` has referenced `./assets/splash.png` and
 * `./assets/adaptive-icon.png` since the project was created and the directory
 * has always been empty, so `expo run:android` and `expo run:ios` both fail
 * before they compile anything. An app that cannot build is not a foundation.
 *
 * These are placeholders with a real job: the brand orange, the mark drawn from
 * geometry, at the exact sizes each platform wants. When the designer's
 * artwork arrives it replaces the files and nothing else changes.
 *
 * Written by hand rather than with a library because a PNG of flat shapes is
 * about sixty lines — a chunk header, a CRC, and zlib, all of which Node
 * already has — and adding an image dependency to a token package to draw a
 * square would be the larger cost.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', '..', 'apps', 'mobile', 'assets');

// ── PNG encoding ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** RGBA pixels → a PNG file. */
function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // Each scanline is prefixed with its filter byte; 0 means "none", which
  // compresses perfectly well for flat colour.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(pixels.buffer, y * width * 4, width * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Drawing ─────────────────────────────────────────────────────────────────

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

class Canvas {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height * 4);
  }

  fill(rgb: Rgb): void {
    for (let i = 0; i < this.width * this.height; i += 1) {
      this.pixels[i * 4] = rgb.r;
      this.pixels[i * 4 + 1] = rgb.g;
      this.pixels[i * 4 + 2] = rgb.b;
      this.pixels[i * 4 + 3] = 255;
    }
  }

  /**
   * Blend one pixel. `alpha` is coverage, which is how the shapes below get
   * smooth edges: a pixel on the boundary of a circle is drawn at partial
   * coverage rather than snapped on or off.
   */
  blend(x: number, y: number, rgb: Rgb, alpha: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || alpha <= 0) return;
    const i = (y * this.width + x) * 4;
    const a = Math.min(1, alpha);
    this.pixels[i] = Math.round(this.pixels[i]! * (1 - a) + rgb.r * a);
    this.pixels[i + 1] = Math.round(this.pixels[i + 1]! * (1 - a) + rgb.g * a);
    this.pixels[i + 2] = Math.round(this.pixels[i + 2]! * (1 - a) + rgb.b * a);
    this.pixels[i + 3] = 255;
  }

  /** An antialiased disc, by sampling coverage at the boundary. */
  disc(cx: number, cy: number, r: number, rgb: Rgb): void {
    const from = Math.max(0, Math.floor(cx - r - 1));
    const to = Math.min(this.width, Math.ceil(cx + r + 1));
    const top = Math.max(0, Math.floor(cy - r - 1));
    const bottom = Math.min(this.height, Math.ceil(cy + r + 1));

    for (let y = top; y < bottom; y += 1) {
      for (let x = from; x < to; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        // One pixel of feathering at the edge.
        this.blend(x, y, rgb, Math.min(1, Math.max(0, r + 0.5 - d)));
      }
    }
  }

  /** A rounded rectangle, drawn as a rect plus four corner discs. */
  roundedRect(x0: number, y0: number, w: number, h: number, r: number, rgb: Rgb): void {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y += 1) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x += 1) {
        const dx = Math.max(x0 + r - x - 0.5, 0, x + 0.5 - (x0 + w - r));
        const dy = Math.max(y0 + r - y - 0.5, 0, y + 0.5 - (y0 + h - r));
        const d = Math.hypot(dx, dy);
        this.blend(x, y, rgb, d <= r ? 1 : Math.max(0, r + 0.5 - d));
      }
    }
  }

  png(): Buffer {
    return encodePng(this.width, this.height, this.pixels);
  }
}

/**
 * The mark: a location pin over a plate.
 *
 * Geometry, not a font — rasterising Arabic type here would need a font engine,
 * and a glyph drawn wrong is worse than a shape drawn deliberately. It reads as
 * "food, delivered to a place", which is what the product is.
 */
function drawMark(canvas: Canvas, cx: number, cy: number, size: number, on: Rgb): void {
  const plate = size * 0.5;
  // The plate: a ring, so the pin reads as sitting on it rather than in it.
  canvas.disc(cx, cy + size * 0.06, plate, on);
  canvas.disc(cx, cy + size * 0.06, plate * 0.78, hexToRgb(color.brand));

  // The pin: a disc with a tapered tail, drawn as narrowing rows.
  const pinR = size * 0.26;
  const pinY = cy - size * 0.1;
  canvas.disc(cx, pinY, pinR, on);

  const tailTo = pinY + size * 0.46;
  for (let y = pinY; y < tailTo; y += 1) {
    const t = (y - pinY) / (tailTo - pinY);
    const halfWidth = pinR * (1 - t) * 0.92;
    for (let x = cx - halfWidth; x <= cx + halfWidth; x += 1) {
      canvas.blend(Math.round(x), Math.round(y), on, 1);
    }
  }

  // The hole, so the pin is a pin and not a balloon.
  canvas.disc(cx, pinY, pinR * 0.42, hexToRgb(color.brand));
}

function iconCanvas(size: number, withBackground: boolean): Canvas {
  const canvas = new Canvas(size, size);
  const brand = hexToRgb(color.brand);
  const white = hexToRgb(palette.white);

  if (withBackground) {
    canvas.fill(brand);
  } else {
    /*
     * Android's adaptive icon crops the outer third to whatever mask the
     * launcher uses, so the artwork lives in the safe centre and the corners
     * are the background colour declared in app.config.ts.
     */
    canvas.fill(brand);
  }

  drawMark(canvas, size / 2, size / 2, size * 0.42, white);
  return canvas;
}

function write(name: string, buffer: Buffer): void {
  const path = join(ASSETS, name);
  writeFileSync(path, buffer);
  console.log(`  ${name}  ${(buffer.length / 1024).toFixed(1)} KB`);
}

if (process.argv[1] && process.argv[1].endsWith('make-app-icons.ts')) {
  mkdirSync(ASSETS, { recursive: true });
  console.log('Writing app assets:');

  // 1024 is what both stores want, and what Expo downsamples from.
  write('icon.png', iconCanvas(1024, true).png());

  // Android draws its own mask over this, from a 108dp canvas at 432px.
  write('adaptive-icon.png', iconCanvas(432, false).png());

  // The splash is centred artwork on the brand colour, sized for the largest
  // phone and letterboxed by `resizeMode: contain`.
  const splash = new Canvas(1284, 2778);
  splash.fill(hexToRgb(color.brand));
  drawMark(splash, 1284 / 2, 2778 / 2, 420, hexToRgb(palette.white));
  write('splash.png', splash.png());

  // The web favicon, for Expo's web target.
  write('favicon.png', iconCanvas(48, true).png());

  console.log('\nPlaceholders in the brand colour. Replace with final artwork;');
  console.log('the filenames and sizes are what app.config.ts already expects.');
}
