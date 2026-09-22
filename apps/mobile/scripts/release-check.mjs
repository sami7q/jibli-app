import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as dns } from 'node:dns';

/**
 * Everything that has to be true before `eas build --profile production`.
 *
 * `preflight.mjs` answers "can I run this on my phone". This answers the other
 * question, and it is a different list: what a store rejects, what is baked
 * into a binary and therefore cannot be fixed by an update, and what fails
 * silently on a customer's device rather than on a builder.
 *
 * Read-only. It changes nothing and prints what to do about anything it finds.
 *
 *     node scripts/release-check.mjs
 */

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

let failures = 0;
let warnings = 0;

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m, fix) => {
  console.log(`  ✗ ${m}`);
  if (fix) console.log(`      → ${fix}`);
  failures += 1;
};
const warn = (m, fix) => {
  console.log(`  ! ${m}`);
  if (fix) console.log(`      → ${fix}`);
  warnings += 1;
};
const note = (m) => console.log(`      ${m}`);

console.log('\nChecking what the stores will check.\n');

// ── 1. The URLs that get baked into the binary ───────────────────────────────

console.log('Links App Review will open');

/*
 * These are read when app.config.ts is evaluated, which is at *build* time — so
 * a binary built with the placeholders has dead links inside it and no
 * `eas update` can reach them. app.config.ts refuses to build production with
 * the placeholder; this is the earlier, friendlier version of the same check,
 * and it also verifies that whatever replaced it actually resolves.
 */
const links = [
  ['EXPO_PUBLIC_PRIVACY_URL', process.env.EXPO_PUBLIC_PRIVACY_URL, 'https://jibli.iq/privacy'],
  ['EXPO_PUBLIC_TERMS_URL', process.env.EXPO_PUBLIC_TERMS_URL, 'https://jibli.iq/terms'],
];

for (const [name, value, placeholder] of links) {
  const url = value ?? placeholder;

  if (url === placeholder) {
    bad(
      `${name} is unset, so it would bake ${placeholder}`,
      `Set it in eas.json's production profile. Baked at build time — a wrong one costs a submission.`,
    );
    continue;
  }

  try {
    const { hostname } = new URL(url);
    await dns.lookup(hostname);
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
    if (response.ok) ok(`${name} → ${url}`);
    else bad(`${name} → ${url} answered ${response.status}`);
  } catch (error) {
    bad(
      `${name} → ${url} is not reachable: ${error instanceof Error ? error.message : String(error)}`,
      'Both stores refuse a submission whose privacy policy does not resolve.',
    );
  }
}

// ── 2. Android push ──────────────────────────────────────────────────────────

console.log('\nAndroid notifications');

/*
 * The failure this catches is the quietest one in the app. Without FCM
 * credentials the build succeeds, POST_NOTIFICATIONS is still requested, the
 * customer still grants it — and no notification ever arrives, because
 * getExpoPushTokenAsync had nothing to register against.
 */
const googleServices = process.env.GOOGLE_SERVICES_JSON;
if (googleServices && existsSync(googleServices)) {
  ok(`google-services.json at ${googleServices}`);
} else if (existsSync(path.join(projectRoot, 'google-services.json'))) {
  warn(
    'google-services.json is present but GOOGLE_SERVICES_JSON is unset',
    'app.config.ts reads the env var. Set it, or EAS will build without FCM.',
  );
} else {
  bad(
    'no FCM credentials — Android push will not work',
    'eas credentials -p android, or upload google-services.json as the GOOGLE_SERVICES_JSON secret file.',
  );
  note('iOS needs nothing here: EAS holds the APNs key and Apple routes on the bundle id.');
}

// ── 3. Map tiles ─────────────────────────────────────────────────────────────

console.log('\nMap tiles');
if (process.env.EXPO_PUBLIC_MAP_TILE_URL) {
  ok(`${process.env.EXPO_PUBLIC_MAP_TILE_URL}`);
  if (!process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION) {
    warn(
      'no EXPO_PUBLIC_MAP_TILE_ATTRIBUTION',
      'Every tile vendor requires visible attribution; it is a licence term, not a courtesy.',
    );
  }
} else {
  bad(
    'no tile provider — the address picker will draw no map at all',
    'Set EXPO_PUBLIC_MAP_TILE_URL. MapTiler/Stadia free tiers cover this many times over.',
  );
  note('There is no longer a fallback: it used to default to tile.openstreetmap.org,');
  note('which the OSMF usage policy forbids a distributed app from using.');
}

// ── 4. The icon font subset ──────────────────────────────────────────────────

console.log('\nAssets');
const subsetFont = path.join(projectRoot, 'assets/icons/mci-subset.ttf');
if (existsSync(subsetFont)) {
  const kb = statSync(subsetFont).size / 1024;
  if (kb > 200) {
    warn(
      `mci-subset.ttf is ${kb.toFixed(0)} KB — larger than a subset should be`,
      'Re-run scripts/build-icon-font.mjs; the full typeface is 1,277 KB.',
    );
  } else {
    ok(`icon font subset ${kb.toFixed(1)} KB`);
  }
} else {
  bad('assets/icons/mci-subset.ttf is missing', 'node scripts/build-icon-font.mjs');
}

const androidSplash = path.join(projectRoot, 'assets/splash-android.png');
if (existsSync(androidSplash)) ok('square Android splash present');
else bad('assets/splash-android.png is missing', 'Android 12+ masks the splash image to a circle.');

// ── 5. Version ───────────────────────────────────────────────────────────────

console.log('\nVersion');
const { version } = require(path.join(projectRoot, 'package.json'));
note(`package.json says ${version}; app.config.ts holds the one that ships.`);
note('runtimeVersion follows appVersion, so bumping it cuts the OTA update line');
note('for every installed copy. Bump it when you mean to, not to mark a release.');

console.log(
  failures === 0
    ? `\nReady to build.${warnings > 0 ? ` ${warnings} warning(s) worth reading.` : ''}\n`
    : `\n${failures} thing(s) block a store build.${warnings > 0 ? ` ${warnings} warning(s).` : ''}\n`,
);

process.exit(failures === 0 ? 0 : 1);
