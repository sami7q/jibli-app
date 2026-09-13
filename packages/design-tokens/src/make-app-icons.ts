import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { color, palette } from './index.js';
import { Canvas, hexToRgb, type Rgb } from './png.js';

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
 * The encoder and the canvas live in `png.ts`, shared with the demo
 * marketplace's placeholder artwork.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', '..', 'apps', 'mobile', 'assets');

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
