import { deflateSync } from 'node:zlib';

/**
 * A minimal PNG writer, and a canvas of flat shapes to fill it with.
 *
 * Written by hand rather than with a library because a PNG of flat shapes is
 * about sixty lines — a chunk header, a CRC, and zlib, all of which Node
 * already has — and adding an image dependency to a token package to draw a
 * circle would be the larger cost.
 *
 * It lives here, beside the tokens, because everything it draws is drawn in the
 * brand's colours: the app icon and splash, and the placeholder artwork the
 * demo marketplace ships with. Two callers, one encoder.
 */

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
export function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
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

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** Mix two colours. `t` of 0 is `from`, 1 is `to`. */
export function mix(from: Rgb, to: Rgb, t: number): Rgb {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    r: Math.round(from.r + (to.r - from.r) * clamped),
    g: Math.round(from.g + (to.g - from.g) * clamped),
    b: Math.round(from.b + (to.b - from.b) * clamped),
  };
}

/**
 * A hue rotation, so one brand colour can yield a family of related ones.
 *
 * Used to give each restaurant a cover that is recognisably its own without
 * inventing a second palette: the same saturation and lightness, turned around
 * the wheel.
 */
export function rotateHue(rgb: Rgb, degrees: number): Rgb {
  const [h, s, l] = rgbToHsl(rgb);
  return hslToRgb((h + degrees / 360 + 1) % 1, s, l);
}

function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;

  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    const shifted = (t + 1) % 1;
    if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
    if (shifted < 1 / 2) return q;
    if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
    return p;
  };

  return {
    r: Math.round(channel(h + 1 / 3) * 255),
    g: Math.round(channel(h) * 255),
    b: Math.round(channel(h - 1 / 3) * 255),
  };
}

export class Canvas {
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
   * A linear gradient across the whole canvas.
   *
   * `angle` is in degrees, 0 pointing right and 90 pointing down, so a cover
   * can be lit from a consistent direction without the caller doing the
   * trigonometry.
   */
  gradient(from: Rgb, to: Rgb, angle = 45): void {
    const radians = (angle * Math.PI) / 180;
    const dx = Math.cos(radians);
    const dy = Math.sin(radians);
    // Project every corner to find the range the gradient must cover, so it
    // fills the canvas at any angle rather than clipping.
    const span = Math.abs(dx) * this.width + Math.abs(dy) * this.height;
    const originX = dx < 0 ? this.width : 0;
    const originY = dy < 0 ? this.height : 0;

    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const t = ((x - originX) * dx + (y - originY) * dy) / span;
        const rgb = mix(from, to, t);
        const i = (y * this.width + x) * 4;
        this.pixels[i] = rgb.r;
        this.pixels[i + 1] = rgb.g;
        this.pixels[i + 2] = rgb.b;
        this.pixels[i + 3] = 255;
      }
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
  disc(cx: number, cy: number, r: number, rgb: Rgb, alpha = 1): void {
    const from = Math.max(0, Math.floor(cx - r - 1));
    const to = Math.min(this.width, Math.ceil(cx + r + 1));
    const top = Math.max(0, Math.floor(cy - r - 1));
    const bottom = Math.min(this.height, Math.ceil(cy + r + 1));

    for (let y = top; y < bottom; y += 1) {
      for (let x = from; x < to; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        // One pixel of feathering at the edge.
        this.blend(x, y, rgb, Math.min(1, Math.max(0, r + 0.5 - d)) * alpha);
      }
    }
  }

  /**
   * A disc that fades from solid at the centre to nothing at the rim.
   *
   * What makes the covers look photographed rather than drawn: a hard-edged
   * circle on a gradient reads as a shape, a soft one reads as light.
   */
  glow(cx: number, cy: number, r: number, rgb: Rgb, alpha = 0.5): void {
    const from = Math.max(0, Math.floor(cx - r));
    const to = Math.min(this.width, Math.ceil(cx + r));
    const top = Math.max(0, Math.floor(cy - r));
    const bottom = Math.min(this.height, Math.ceil(cy + r));

    for (let y = top; y < bottom; y += 1) {
      for (let x = from; x < to; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        // Smoothstep, so the falloff has no visible edge.
        const t = 1 - d / r;
        this.blend(x, y, rgb, t * t * (3 - 2 * t) * alpha);
      }
    }
  }

  /** A rounded rectangle, drawn as a rect plus four corner discs. */
  roundedRect(x0: number, y0: number, w: number, h: number, r: number, rgb: Rgb, alpha = 1): void {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y += 1) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x += 1) {
        const dx = Math.max(x0 + r - x - 0.5, 0, x + 0.5 - (x0 + w - r));
        const dy = Math.max(y0 + r - y - 0.5, 0, y + 0.5 - (y0 + h - r));
        const d = Math.hypot(dx, dy);
        this.blend(x, y, rgb, (d <= r ? 1 : Math.max(0, r + 0.5 - d)) * alpha);
      }
    }
  }

  /**
   * A band of darkness along the bottom edge.
   *
   * Every cover carries white badges over its lower third — the ETA, the offer,
   * the name — and a scrim is what keeps them readable whatever the art behind
   * them turns out to be.
   */
  bottomScrim(height: number, rgb: Rgb, maxAlpha = 0.45): void {
    for (let y = this.height - height; y < this.height; y += 1) {
      const t = (y - (this.height - height)) / height;
      for (let x = 0; x < this.width; x += 1) {
        this.blend(x, y, rgb, t * t * maxAlpha);
      }
    }
  }

  png(): Buffer {
    return encodePng(this.width, this.height, this.pixels);
  }
}
