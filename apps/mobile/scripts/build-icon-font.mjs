import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build the icon font this app actually needs.
 *
 * `@expo/vector-icons` ships MaterialCommunityIcons whole: 7,400-odd glyphs in
 * 1.25 MB, bundled into both binaries, so that this app can draw about sixty of
 * them. That single file was a fifth of the entire JavaScript-and-assets
 * payload — more than every screen in the app put together.
 *
 * This produces a subset containing only the glyphs the source refers to, plus
 * a glyph map naming them, and `src/ui/icon.tsx` builds an icon set from the
 * pair. Nothing about how a screen draws an icon changes.
 *
 * **It is not part of the build.** It needs `pyftsubset` (fonttools), which is
 * not something an EAS builder or a fresh clone should have to have. The output
 * is committed, and `icon.test.ts` fails if a name used in the source is
 * missing from it — so forgetting to re-run this is caught by the test suite
 * rather than by a blank square in a release.
 *
 *     pip install fonttools
 *     node scripts/build-icon-font.mjs
 */

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const SRC = path.join(projectRoot, 'src');
const OUT_DIR = path.join(projectRoot, 'assets', 'icons');

const vectorIcons = path.dirname(require.resolve('@expo/vector-icons/package.json'));
const FULL_FONT = path.join(
  vectorIcons,
  'build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf',
);
const FULL_GLYPHS = path.join(
  vectorIcons,
  'build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json',
);

/** @type {Record<string, number>} */
const glyphs = JSON.parse(readFileSync(FULL_GLYPHS, 'utf8'));

// ── Which names the app refers to ───────────────────────────────────────────

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(full)) yield full;
  }
}

/*
 * Every quoted string in the app that happens to name a glyph — not only the
 * ones passed straight to an icon component.
 *
 * Deliberately generous, because icon names travel: they sit in `const TABS`
 * arrays, in union types on a component's props, in a record keyed by order
 * status. Tracing which of those reach an icon would need real analysis, and
 * being wrong means a missing glyph — which renders as nothing at all, in a
 * release, on one screen. Over-including costs a few hundred bytes per glyph.
 */
const referenced = new Set();
for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  for (const [, name] of source.matchAll(/['"`]([a-z][a-z0-9-]{2,})['"`]/g)) {
    if (name in glyphs) referenced.add(name);
  }
}

/*
 * The variants built at runtime rather than written down.
 *
 * `(tabs)/_layout.tsx` draws `${name}-outline` when a tab is not focused, and
 * `account.tsx` does the same for its bullets. Those strings never appear in
 * the source, so the scan above cannot see them — and a tab icon that vanishes
 * when it is *not* selected is exactly the kind of thing that ships.
 *
 * Adding the outline of everything is cheap and makes the rule "if the solid is
 * here, the outline is too" rather than a list to maintain.
 */
for (const name of [...referenced]) {
  const outline = `${name}-outline`;
  if (outline in glyphs) referenced.add(outline);
}

const names = [...referenced].sort();
if (names.length === 0) throw new Error('found no icon names — has the glyph map moved?');

// ── Subset ──────────────────────────────────────────────────────────────────

const codepoints = names.map((name) => glyphs[name]);
const subsetGlyphs = Object.fromEntries(names.map((name) => [name, glyphs[name]]));

writeFileSync(path.join(OUT_DIR, 'mci-subset.json'), `${JSON.stringify(subsetGlyphs, null, 2)}\n`);

const outFont = path.join(OUT_DIR, 'mci-subset.ttf');
execFileSync(
  'pyftsubset',
  [
    FULL_FONT,
    `--unicodes=${codepoints.map((c) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`).join(',')}`,
    `--output-file=${outFont}`,
    // The app draws glyphs by codepoint through a glyph map; none of the
    // layout machinery, hinting tables or alternate sets is reachable from it.
    '--no-hinting',
    '--desubroutinize',
    '--drop-tables+=DSIG',
    '--name-IDs=*',
    '--recalc-bounds',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

const before = statSync(FULL_FONT).size;
const after = statSync(outFont).size;
console.log(`glyphs   ${Object.keys(glyphs).length.toLocaleString()} → ${names.length}`);
console.log(
  `font     ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(1)} KB ` +
    `(saved ${((before - after) / 1024).toFixed(0)} KB per platform)`,
);
