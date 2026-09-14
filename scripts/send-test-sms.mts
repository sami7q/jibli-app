/**
 * Send one real SMS through the configured gateway, and say what happened.
 *
 *   pnpm sms:test 07701234567
 *
 * The gap this closes. Everything between the sign-in screen and the gateway
 * is covered by tests that stub `fetch`, which proves the request is built
 * correctly and proves nothing at all about whether a particular aggregator
 * accepts it. The remaining failures are the ones only a real send can find:
 * the number written in a shape this vendor rejects, an Arabic body that
 * arrives as question marks, a sender id nobody approved, an empty balance.
 * Each one answers 200 or a bare 4xx and none is visible from the code.
 *
 * Finding them through the app means a database, Redis, a running API and a
 * phone, and ends with `OTP_DELIVERY_FAILED` on a screen. This needs none of
 * them: the same provider class, built from the same environment variables the
 * API reads, carrying the same Arabic template — and it prints the request it
 * is about to make before making it, which is usually where the mistake is.
 *
 * It sends a real message and spends real credit. That is the point of it.
 */

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HttpSmsGatewayProvider,
  NOTIFICATION_TEMPLATES,
  extractOtpCode,
} from '../packages/notifications/src/index.js';
import { loadDotEnv } from '../packages/config/src/dotenv.js';
import {
  toE164Iraq,
  formatIraqiPhoneNational,
  PhoneValidationError,
} from '../packages/validation/src/phone.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Output ───────────────────────────────────────────────────────────────────

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, text: string) => (useColour ? `[${code}m${text}[0m` : text);
const bold = (text: string) => paint('1', text);
const dim = (text: string) => paint('2', text);
const red = (text: string) => paint('31', text);
const green = (text: string) => paint('32', text);
const yellow = (text: string) => paint('33', text);

/** Two columns, so the configuration reads as a table rather than a paragraph. */
function row(label: string, value: string): void {
  console.log(`  ${dim(label.padEnd(15))}${value}`);
}

function die(message: string, ...detail: string[]): never {
  console.error(`\n${red('✗')} ${message}`);
  for (const line of detail) console.error(`  ${dim(line)}`);
  console.error('');
  process.exit(1);
}

/**
 * A secret, identifiably but not usefully.
 *
 * The whole point of printing it is to catch the key that was pasted with a
 * trailing newline or truncated halfway, so the length and the ends have to
 * show — and the middle must not, because this output gets pasted into chat
 * when someone asks why it is not working.
 */
function maskSecret(value: string): string {
  if (value.length <= 10) return `${'•'.repeat(value.length)} (${value.length} chars)`;
  return `${value.slice(0, 7)}…${value.slice(-4)} (${value.length} chars)`;
}

// ── A .env file, since this repo has no convention for one ────────────────────

// ── Arguments ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
${bold('pnpm sms:test <iraqi-number> [--via <channel>] [--env-file <path>] [--text "..."]')}

Sends one real message through the gateway configured in the environment, using
the same provider the API uses. Costs one message.

  ${dim('pnpm sms:test 07701234567')}
  ${dim('pnpm sms:test 07701234567 --via whatsapp')}
  ${dim('pnpm sms:test 07701234567 --via auto')}
  ${dim('pnpm sms:test +964 770 123 4567 --env-file .env.sms')}

${bold('--via')} overrides the vendor's channel field for this one send, so a
channel can be tried before it is committed to in the environment. On OTPIQ:
sms, whatsapp, telegram, auto, whatsapp-sms, whatsapp-telegram-sms.

WhatsApp and Telegram need the gateway in code mode
(${dim('SMS_GATEWAY_BODY_MODE=code')}) — those channels carry an approved template
with the code in it, never free text.

Reads .env from the repo root when present. Variables already set in the shell
win over the file.
`);
  process.exit(args.length === 0 ? 1 : 0);
}

function takeOption(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined) die(`${name} needs a value`);
  args.splice(index, 2);
  return value;
}

const envFileArg = takeOption('--env-file');
const customText = takeOption('--text');
const viaChannel = takeOption('--via');

// Whatever is left is the number; joined, so an unquoted "+964 770 123 4567"
// still works rather than failing on the shell having split it.
const rawNumber = args.join(' ').trim();
if (!rawNumber) die('No phone number given.', 'pnpm sms:test 07701234567');

console.log(`\n${bold('Jibli — SMS gateway check')}\n`);

// ── Environment ──────────────────────────────────────────────────────────────

const envPath = envFileArg ? resolve(root, envFileArg) : resolve(root, '.env');

if (existsSync(envPath)) {
  // The same loader the API boots with, so a file that works here works there.
  const { loaded } = loadDotEnv({ path: envPath, allowInProduction: true });
  row('env file', `${envFileArg ?? '.env'} ${dim(`(${loaded} variables)`)}`);
} else if (envFileArg) {
  die(`No such file: ${envFileArg}`);
} else {
  row('env file', dim('none — using the ambient environment'));
}

const env = process.env;

/*
 * Read directly rather than through `loadApiEnv`, deliberately.
 *
 * That schema validates the whole API — database URL, JWT secrets, S3
 * credentials, a dozen more — and refuses everything if any one is missing.
 * Requiring a Postgres URL before an SMS can be tested would defeat the
 * purpose: this is the tool for the machine that has the API key and nothing
 * else. The five variables that matter here are checked below instead.
 */
const gatewayUrl = env.SMS_GATEWAY_URL;
const apiKey = env.SMS_GATEWAY_API_KEY;

if (!gatewayUrl || !apiKey) {
  die(
    'The gateway is not configured.',
    'SMS_GATEWAY_URL and SMS_GATEWAY_API_KEY must both be set.',
    '',
    'Copy the OTPIQ block out of .env.example into .env, add your key,',
    'then run this again.',
  );
}

if (env.OTP_PROVIDER && env.OTP_PROVIDER !== 'sms_gateway') {
  console.log(
    `  ${yellow('!')} ${dim(`OTP_PROVIDER is "${env.OTP_PROVIDER}" — the API would not use this gateway.`)}`,
  );
  console.log(`  ${dim('  This test uses it anyway. Set OTP_PROVIDER=sms_gateway to match.')}`);
}

// ── The number ───────────────────────────────────────────────────────────────

let e164: string;
try {
  // The same function the API calls, so a number this rejects could not have
  // signed in either.
  e164 = toE164Iraq(rawNumber);
} catch (error) {
  if (error instanceof PhoneValidationError) {
    die(`"${rawNumber}" is not a valid Iraqi mobile number (${error.code}).`, error.message);
  }
  throw error;
}

// ── The request, printed before it is made ───────────────────────────────────

let extraFields: Record<string, string> | undefined = undefined;
if (env.SMS_GATEWAY_EXTRA_FIELDS) {
  try {
    extraFields = JSON.parse(env.SMS_GATEWAY_EXTRA_FIELDS) as Record<string, string>;
  } catch {
    die(
      'SMS_GATEWAY_EXTRA_FIELDS is not valid JSON.',
      `Got: ${env.SMS_GATEWAY_EXTRA_FIELDS}`,
      'Expected an object of strings, e.g. {"smsType":"custom"}',
    );
  }
}

/*
 * `--via` writes the vendor's own channel field, which is a vendor constant
 * like every other one — so it goes through SMS_GATEWAY_EXTRA_FIELDS rather
 * than becoming a setting of its own. `provider` is what OTPIQ calls it; a
 * gateway that calls it something else is configured in the file directly.
 */
if (viaChannel) {
  extraFields = { ...(extraFields ?? {}), provider: viaChannel };
}

const numberFormat = (env.SMS_GATEWAY_NUMBER_FORMAT ?? 'e164') as
  'e164' | 'e164_no_plus' | 'national';

const onTheWire =
  numberFormat === 'e164_no_plus'
    ? e164.replace(/^\+/, '')
    : numberFormat === 'national'
      ? `0${e164.slice(4)}`
      : e164;

const method = (env.SMS_GATEWAY_METHOD ?? 'POST') as 'POST' | 'GET';
const encoding = (env.SMS_GATEWAY_ENCODING ?? 'json') as 'json' | 'form';
const authScheme = (env.SMS_GATEWAY_AUTH_SCHEME ?? 'bearer') as 'bearer' | 'header' | 'body';

console.log('');
row('gateway', `${method} ${gatewayUrl}`);
row('encoding', method === 'GET' ? dim('query string') : encoding);
row('auth', `${authScheme} ${dim(maskSecret(apiKey))}`);
row(
  'sender id',
  env.SMS_GATEWAY_SENDER_ID ?? dim("none — the gateway's own approved sender is used"),
);

const bodyMode = (env.SMS_GATEWAY_BODY_MODE ?? 'text') as 'text' | 'code';

const fieldNames = [
  `${env.SMS_GATEWAY_TO_FIELD ?? 'to'}=<number>`,
  `${env.SMS_GATEWAY_BODY_FIELD ?? 'message'}=${bodyMode === 'code' ? '<code only>' : '<text>'}`,
];
row('field names', fieldNames.join(', '));
row(
  'body mode',
  bodyMode === 'code'
    ? `code ${dim("— the gateway's own template carries the wording")}`
    : `text ${dim('— our Arabic message is sent verbatim')}`,
);

if (extraFields) {
  row(
    'extra fields',
    Object.entries(extraFields)
      .map(([key, value]) => `${key}=${value}`)
      .join(', '),
  );
}
if (env.SMS_GATEWAY_SUCCESS_FIELD) {
  row(
    'success when',
    `${env.SMS_GATEWAY_SUCCESS_FIELD} = ${env.SMS_GATEWAY_SUCCESS_VALUE ?? dim('(anything truthy)')}`,
  );
}

/*
 * The one combination that is guaranteed to fail, caught before it is paid
 * for: WhatsApp and Telegram will not carry free text from a business, so a
 * text-mode send to either is refused by the vendor after being billed for.
 */
const channel = extraFields?.provider;
if (bodyMode !== 'code' && channel && /whatsapp|telegram|auto/.test(channel)) {
  console.log(`\n  ${yellow('!')} ${dim(`provider=${channel} with SMS_GATEWAY_BODY_MODE=text.`)}`);
  console.log(`  ${dim('  WhatsApp and Telegram carry an approved template, not free text.')}`);
  console.log(`  ${dim('  Set SMS_GATEWAY_BODY_MODE=code, or this will only ever reach SMS.')}`);
}

console.log('');
row('recipient', `${e164}  ${dim(formatIraqiPhoneNational(e164))}`);
row('sent as', `${bold(onTheWire)}  ${dim(`SMS_GATEWAY_NUMBER_FORMAT=${numberFormat}`)}`);

/*
 * A real code in the real template.
 *
 * Not a placeholder: the Arabic template is what exercises the vendor's
 * Unicode handling, and a message that arrives as question marks is the
 * failure this script exists to catch. Printed so it can be compared against
 * whatever the handset shows — if they differ, the gateway substituted a code
 * of its own and no sign-in could ever succeed.
 */
const code = String(Math.floor(1000 + Math.random() * 9000));
const body = customText ?? NOTIFICATION_TEMPLATES.otpCode(code).bodyAr;

const isArabic = /[؀-ۿ]/.test(body);
// GSM-7 fits 160 per segment; anything with Arabic in it is UCS-2 at 70.
const perSegment = isArabic ? 70 : 160;
const segments = Math.ceil(body.length / perSegment);

const wireBody = bodyMode === 'code' ? (extractOtpCode(body) ?? body) : body;

console.log('');
row('message', body);
if (bodyMode === 'code') {
  row('', dim(`sent as: ${bold(wireBody)} ${dim('— wording comes from the vendor template')}`));
}
/*
 * Segment arithmetic belongs to text mode only.
 *
 * In code mode the sentence below is never transmitted — the vendor's approved
 * template is — so counting its characters would report a length and a price
 * for a message that does not exist. The vendor's own per-template rate
 * applies instead, which this script has no way to know.
 */
if (bodyMode === 'code') {
  row('', dim('length and price follow the vendor template, not the text above'));
} else {
  row(
    '',
    dim(
      `${body.length} chars · ${isArabic ? 'Arabic (UCS-2)' : 'Latin (GSM-7)'} · ` +
        `${segments} segment${segments === 1 ? '' : 's'} · billed as ${segments}`,
    ),
  );
}
if (!customText) row('', `${dim('expect to receive code')} ${bold(code)}`);
if (bodyMode !== 'code' && segments > 1) {
  console.log(
    `  ${yellow('!')} ${dim('Over one segment — each message costs ' + segments + 'x.')}`,
  );
}

// ── Send ─────────────────────────────────────────────────────────────────────

/*
 * A logger that keeps the provider's own output out of the way.
 *
 * The provider logs structured JSON on every send, which is right in the API
 * and noise here — this script is already reporting the same facts in a shape
 * a person can read. Warnings still come through, because the allowlist
 * refusal below is one.
 */
const captured: { level: string; fields: Record<string, unknown>; message: string }[] = [];
const quietLogger = {
  info: (fields: Record<string, unknown>, message: string) =>
    captured.push({ level: 'info', fields, message }),
  warn: (fields: Record<string, unknown>, message: string) =>
    captured.push({ level: 'warn', fields, message }),
  error: (fields: Record<string, unknown>, message: string) =>
    captured.push({ level: 'error', fields, message }),
  debug: () => {},
  fatal: (fields: Record<string, unknown>, message: string) =>
    captured.push({ level: 'fatal', fields, message }),
  trace: () => {},
  child: () => quietLogger,
} as unknown as ConstructorParameters<typeof HttpSmsGatewayProvider>[0];

const provider = new HttpSmsGatewayProvider(quietLogger, {
  url: gatewayUrl,
  apiKey,
  senderId: env.SMS_GATEWAY_SENDER_ID,
  authScheme,
  apiKeyHeader: env.SMS_GATEWAY_API_KEY_HEADER,
  apiKeyField: env.SMS_GATEWAY_API_KEY_FIELD,
  toField: env.SMS_GATEWAY_TO_FIELD,
  bodyField: env.SMS_GATEWAY_BODY_FIELD,
  senderField: env.SMS_GATEWAY_SENDER_FIELD,
  timeoutMs: env.SMS_GATEWAY_TIMEOUT_MS ? Number(env.SMS_GATEWAY_TIMEOUT_MS) : 8000,
  bodyMode,
  numberFormat,
  method,
  encoding,
  extraFields,
  successField: env.SMS_GATEWAY_SUCCESS_FIELD,
  successValue: env.SMS_GATEWAY_SUCCESS_VALUE,
  messageIdField: env.SMS_GATEWAY_MESSAGE_ID_FIELD,
});

/*
 * The allowlist applies here exactly as it does in the API.
 *
 * Skipping it would make this script pass against a configuration under which
 * the app cannot sign anybody in, which is the one result a verification tool
 * must never produce.
 */
const allowlist = (env.OTP_PHONE_ALLOWLIST ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

if (allowlist.length > 0 && env.APP_ENV !== 'production' && !allowlist.includes(e164)) {
  die(
    'Blocked by OTP_PHONE_ALLOWLIST before reaching the gateway.',
    'The API would refuse this number the same way, so the block is the correct answer.',
    '',
    `Allowed: ${allowlist.join(', ')}`,
    `Add ${e164} to OTP_PHONE_ALLOWLIST, or unset it.`,
  );
}

console.log(`\n${dim('Sending…')}`);

const startedAt = Date.now();
const result = await provider.send({ toE164: e164, body });
const elapsed = Date.now() - startedAt;

console.log('');

if (result.ok) {
  console.log(`  ${green('✓')} ${bold('Accepted by the gateway')} ${dim(`in ${elapsed}ms`)}`);
  if (result.providerMessageId) row('message id', result.providerMessageId);

  console.log(`
  ${yellow('Accepted is not delivered.')} ${dim('The gateway took the message; the')}
  ${dim('operator still has to hand it to the handset. Check the phone.')}

  ${bold(`Arrives within a minute with the code ${customText ? '(your text)' : code}`)}
    ${dim('The integration works. Sign in from the app with this number.')}

  ${bold('Arrives as ???? or ٭٭٭٭')}
    ${dim('Unicode is off. Ask the vendor which field turns Arabic on and add')}
    ${dim('it to SMS_GATEWAY_EXTRA_FIELDS — usually {"type":"unicode"} or a route id.')}

  ${bold('Arrives with a different code')}
    ${dim('The gateway generated its own instead of sending ours, so no sign-in')}
    ${dim('can succeed. On OTPIQ this means smsType is not "custom".')}

  ${bold('Never arrives')}
    ${dim('Sender id not approved for this operator, the number is barred for A2P,')}
    ${dim('or the route to this network is down. Check the delivery report in the')}
    ${dim('vendor dashboard against the message id above — that says which.')}
`);
  process.exit(0);
}

console.log(`  ${red('✗')} ${bold('Refused')} ${dim(`after ${elapsed}ms`)}`);
row('reason', red(result.error ?? 'unknown'));

const reason = result.error ?? '';
const hint = (() => {
  if (reason.includes('HTTP_401') || reason.includes('HTTP_403'))
    return 'The key was rejected. Check SMS_GATEWAY_API_KEY, and that SMS_GATEWAY_AUTH_SCHEME matches how the vendor wants it sent (bearer / header / body).';
  /*
   * Trial mode is checked before credit, because the vendor's own wording
   * mentions credit and the two are not the same problem. A trial account can
   * be refused while showing a healthy balance — the grant is not purchased
   * credit — so "you are out of credit" sends the reader to a dashboard that
   * disagrees with the error and tells them nothing.
   */
  if (reason.toLowerCase().includes('trial'))
    return 'The vendor account is still in TRIAL mode: it will only send to the account holder\u2019s own verified number, whatever balance the dashboard shows — a trial grant is not purchased credit. No customer can sign in until a real top-up lifts it, so clear this before switching the gateway on anywhere real.';
  if (reason.toLowerCase().includes('credit') || reason.includes('HTTP_402'))
    return 'The account is out of credit. Top it up in the vendor dashboard.';
  if (reason.includes('HTTP_429'))
    return 'Rate limited by the vendor. OTPIQ allows 10 messages per number per 10 minutes; wait and retry.';
  if (reason.includes('HTTP_400') || reason.includes('HTTP_422'))
    return 'The gateway understood the request and disliked its contents — the reason above says which field. The usual culprit is SMS_GATEWAY_NUMBER_FORMAT, or a required constant missing from SMS_GATEWAY_EXTRA_FIELDS.';
  if (/whatsapp|telegram/.test(extraFields?.provider ?? '') && reason.includes('HTTP_4'))
    return 'This channel was refused. If the reason mentions a sender, a WABA or a template, the vendor wants your own WhatsApp Business Account connected before it will carry this channel — fall back to provider=sms, or provider=auto so it degrades on its own.';
  if (reason.includes('HTTP_404'))
    return 'SMS_GATEWAY_URL points at nothing. Check the path against the vendor docs.';
  if (reason.includes('AbortError') || reason.includes('TimeoutError'))
    return 'The gateway did not answer in time, twice. Check that the host is reachable from here, and raise SMS_GATEWAY_TIMEOUT_MS if the vendor is simply slow.';
  if (reason.includes('GATEWAY_SAID'))
    return 'A 200 with a refusal inside it, caught by SMS_GATEWAY_SUCCESS_FIELD. The value above is the gateway’s own status — look it up in their docs.';
  if (reason.includes('FETCH_FAILED') || reason.includes('TypeError'))
    return 'The host could not be reached at all. Check the URL, DNS, and whether this machine needs a proxy.';
  return 'Check the reason above against the vendor documentation.';
})();

console.log(`\n  ${dim(hint)}\n`);
process.exit(1);
