import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';

/**
 * Everything that has to be true before you pick up the phone.
 *
 * Each of these has already cost an evening, and each fails in a way that
 * points somewhere else:
 *
 *   Not logged in to Expo CLI — Expo Go answers «You need to be signed in to
 *   Expo Go and Expo CLI to open your project». SDK 57 requires an account on
 *   BOTH ends, and the message arrives on the phone while the cause is on the
 *   computer.
 *
 *   The advertised address is a virtual adapter — WSL's 172.x, or Hyper-V's.
 *   The QR encodes an address the phone cannot route to, and Expo Go sits on a
 *   spinner that never resolves.
 *
 *   The API is asleep. It is a free instance that spins down after fifteen
 *   minutes; the first request takes about a minute. The app is not broken, it
 *   is waiting, and knowing which beforehand is the whole difference.
 *
 * Read-only. It changes nothing and prints what to do about anything it finds.
 */

const require = createRequire(import.meta.url);

const ok = (m) => console.log(`  \u2713 ${m}`);
const bad = (m, fix) => {
  console.log(`  \u2717 ${m}`);
  if (fix) console.log(`      \u2192 ${fix}`);
  failures += 1;
};
const note = (m) => console.log(`      ${m}`);

let failures = 0;

console.log('\nChecking what the phone will need.\n');

// ── 1. The SDK the project serves ────────────────────────────────────────────
const sdk = require('expo/package.json').version;
const major = sdk.split('.')[0];
console.log(`Expo SDK ${sdk}`);
note(`Expo Go on the App Store carries exactly one SDK — the newest.`);
note(`If your phone says it is for a different SDK than ${major}, the project`);
note(`must move, not the phone: iOS cannot install an older Expo Go.`);

// ── 2. Signed in to the CLI ──────────────────────────────────────────────────
console.log('\nExpo account');
let account = null;
try {
  account = execFileSync('npx', ['expo', 'whoami'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  }).trim();
} catch {
  account = null;
}

if (account && !/not logged in/i.test(account)) {
  ok(`CLI signed in as ${account}`);
  note(`Expo Go on the phone must be signed in to THIS SAME account:`);
  note(`open Expo Go \u2192 tap the avatar, top right \u2192 sign in.`);
} else {
  bad(
    'CLI is not signed in — Expo Go will refuse the project',
    'npx expo login   (create the free account first at https://expo.dev/signup)',
  );
  note('Since SDK 57 the account is required on both ends, same account, and');
  note('there is no way around it on iOS short of a development build.');
}

// ── 3. The address the QR will carry ─────────────────────────────────────────
console.log('\nNetwork');
const candidates = [];
for (const [name, addresses] of Object.entries(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family !== 'IPv4' || address.internal) continue;
    // Link-local (169.254.x) means DHCP never answered on that adapter.
    if (address.address.startsWith('169.254.')) continue;
    candidates.push({ name, ip: address.address });
  }
}

/** Adapters that exist for a virtual machine, not for the network the phone is on. */
const isVirtual = (name) => /wsl|hyper-v|vethernet|vmware|virtualbox|docker|loopback/i.test(name);

const real = candidates.filter((c) => !isVirtual(c.name));
const virtual = candidates.filter((c) => isVirtual(c.name));

if (real.length === 0) {
  bad(
    'No ordinary network adapter has an address',
    'Connect the computer to the same Wi-Fi as the phone.',
  );
} else {
  for (const c of real) ok(`${c.ip}  (${c.name})`);
  if (real.length > 1) {
    note('More than one. Expo picks one; if the phone hangs on a spinner it');
    note('picked the wrong one — disable the adapter you are not using.');
  }
}

for (const c of virtual) {
  note(`ignoring ${c.ip} (${c.name}) — virtual, unreachable from a phone`);
}

// ── 4. The API the app will talk to ──────────────────────────────────────────
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'https://jibli-api.onrender.com';
console.log(`\nAPI  ${apiUrl}`);

if (/localhost|127\.0\.0\.1/.test(apiUrl)) {
  bad(
    'EXPO_PUBLIC_API_URL points at localhost',
    'A phone\u2019s localhost is the phone. Use the computer\u2019s LAN address.',
  );
} else {
  const started = Date.now();
  try {
    const response = await fetch(`${apiUrl}/health/ready`, {
      signal: AbortSignal.timeout(90_000),
    });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const body = await response.json();

    if (response.ok) {
      ok(`reachable in ${elapsed}s — database ${body.checks?.database}, schema ${body.checks?.schema}`);
    } else {
      bad(`answered ${response.status} after ${elapsed}s: ${JSON.stringify(body.checks ?? {})}`);
      if (body.schema_detail) note(`pending migrations: ${body.schema_detail.pending_migrations}`);
    }
    if (Number(elapsed) > 5) {
      note('That was a cold start. It is awake now, so the app will be quick.');
    }
  } catch (error) {
    bad(
      `unreachable: ${error instanceof Error ? error.message : String(error)}`,
      'Check the API is deployed and awake.',
    );
  }
}

// ── 5. Sign-in on the phone ──────────────────────────────────────────────────
console.log('\nSigning in to the app itself');
note('OTP_PROVIDER is `console` on the deployed API, so no real SMS is sent.');
note('One number works, and it is the one to test with:');
note('  phone 07712345678     code 1234');

console.log(
  failures === 0
    ? '\nReady. Run `pnpm dev:mobile` and scan the QR.\n'
    : `\n${failures} thing(s) to fix first.\n`,
);

process.exit(failures === 0 ? 0 : 1);
