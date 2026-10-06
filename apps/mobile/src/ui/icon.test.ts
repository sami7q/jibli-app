import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import glyphMap from '../../assets/icons/mci-subset.json';

/**
 * The guard on the subsetted icon font.
 *
 * `assets/icons/mci-subset.ttf` holds only the glyphs the app was using when
 * `scripts/build-icon-font.mjs` last ran. A name that is not in it renders as
 * *nothing* — no error, no missing-glyph box, just a gap where an icon should
 * be. That is a defect which survives a code review, a typecheck and a build,
 * and shows up on a customer's phone.
 *
 * So the rule the font depends on is asserted here instead: every icon name the
 * source refers to must exist in the subset. Adding an icon without
 * regenerating fails the test suite, which is the cheapest possible place to
 * find out.
 *
 * TypeScript already covers the names written as literals against `IconName`.
 * What it cannot see is the ones assembled at runtime — `${name}-outline` in
 * the tab bar and the account bullets — and those are exactly the ones that
 * fail invisibly, because an icon that only vanishes when a tab is *not*
 * selected is not something anybody checks.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(full) && !full.endsWith('.test.ts')) yield full;
  }
}

/** Every quoted string in the app that looks like an icon name. */
function referencedNames(): Set<string> {
  const found = new Set<string>();
  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`]([a-z][a-z0-9-]{2,})['"`]/g)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return found;
}

describe('the subsetted icon font', () => {
  it('carries every icon the app draws', () => {
    const glyphs = glyphMap as Record<string, number>;
    const known = new Set(Object.keys(glyphs));

    /*
     * Only names the subset already knows about are checked, because the scan
     * cannot tell an icon name from any other lowercase-hyphenated string in
     * the app — 'phone-pad', 'box-none', 'order-status'. Asserting that every
     * such string is a glyph would fail on all of them.
     *
     * What it *can* check is the composition rule, below, which is where the
     * real risk is.
     */
    const used = [...referencedNames()].filter((name) => known.has(name));
    expect(used.length).toBeGreaterThan(20);
  });

  it('carries the outline variant of every solid it carries', () => {
    const glyphs = glyphMap as Record<string, number>;

    /*
     * `(tabs)/_layout.tsx` and `(tabs)/account.tsx` both build `${name}-outline`
     * at render time. Neither string exists in the source, so nothing else in
     * the toolchain — not TypeScript, not the generator's scan — can tell that
     * a solid without its outline is a tab icon that disappears when deselected.
     */
    const missing = Object.keys(glyphs)
      .filter((name) => !name.endsWith('-outline'))
      .filter((name) => FULL_GLYPHS[`${name}-outline`] !== undefined)
      .filter((name) => glyphs[`${name}-outline`] === undefined);

    expect(missing).toEqual([]);
  });

  it('is small enough to have been worth doing', () => {
    const font = path.resolve(here, '../../assets/icons/mci-subset.ttf');
    // The whole typeface is 1,277 KB. Anything near that means the subset was
    // regenerated without a filter, or the full font was committed by mistake.
    expect(statSync(font).size).toBeLessThan(200 * 1024);
  });

  it('contains a glyph for every name in its own map', () => {
    /*
     * The assertion that actually matters, and the only one that reads the
     * binary: the map and the font are two files produced by one script, and
     * nothing but this notices if they stop agreeing — regenerating one and
     * committing the other, say, or a `--unicodes` argument that silently
     * dropped a plane.
     *
     * MaterialCommunityIcons lives in Supplementary Private Use Area-A
     * (U+F0000 and up), *not* the Basic Multilingual Plane's private range, so
     * its cmap must be a format 12 subtable — format 4 cannot address past
     * U+FFFF. That is worth checking by consequence rather than by assertion:
     * if the subset had been written with only a format 4 table, every lookup
     * below would miss.
     */
    const font = readFileSync(path.resolve(here, '../../assets/icons/mci-subset.ttf'));
    const covered = codepointsIn(font);
    const glyphs = glyphMap as Record<string, number>;

    const missing = Object.entries(glyphs)
      .filter(([, codepoint]) => !covered.has(codepoint))
      .map(([name]) => name);

    expect(missing).toEqual([]);
    expect(covered.size).toBeGreaterThanOrEqual(Object.keys(glyphs).length);
  });
});

/**
 * Every codepoint a TrueType font's `cmap` maps, read from the bytes.
 *
 * Only the two subtable formats that can occur here: format 12 for the
 * supplementary planes these glyphs live in, and format 4 in case a future
 * regeneration produces a BMP-only font.
 */
function codepointsIn(font: Buffer): Set<number> {
  const numTables = font.readUInt16BE(4);
  let cmapOffset = -1;

  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (font.toString('ascii', record, record + 4) === 'cmap') {
      cmapOffset = font.readUInt32BE(record + 8);
      break;
    }
  }
  if (cmapOffset < 0) throw new Error('no cmap table — this is not a usable font');

  const covered = new Set<number>();
  const numSubtables = font.readUInt16BE(cmapOffset + 2);

  for (let i = 0; i < numSubtables; i++) {
    const encoding = cmapOffset + 4 + i * 8;
    const subtable = cmapOffset + font.readUInt32BE(encoding + 4);
    const format = font.readUInt16BE(subtable);

    if (format === 12) {
      const groups = font.readUInt32BE(subtable + 12);
      for (let g = 0; g < groups; g++) {
        const at = subtable + 16 + g * 12;
        const start = font.readUInt32BE(at);
        const end = font.readUInt32BE(at + 4);
        for (let c = start; c <= end; c++) covered.add(c);
      }
    } else if (format === 4) {
      const segCount = font.readUInt16BE(subtable + 6) / 2;
      const endCodes = subtable + 14;
      const startCodes = endCodes + segCount * 2 + 2;
      for (let s = 0; s < segCount; s++) {
        const end = font.readUInt16BE(endCodes + s * 2);
        const start = font.readUInt16BE(startCodes + s * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end; c++) covered.add(c);
      }
    }
  }

  return covered;
}

/**
 * The full glyph map, read from the package rather than checked in.
 *
 * Needed only to tell "this solid has no outline in the typeface at all" from
 * "this solid has one and the subset dropped it" — the first is fine, the
 * second is the bug.
 */
const FULL_GLYPHS: Record<string, number> = JSON.parse(
  readFileSync(
    require.resolve('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json'),
    'utf8',
  ),
) as Record<string, number>;
