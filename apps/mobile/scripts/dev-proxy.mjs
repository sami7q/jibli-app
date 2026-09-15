import { createServer } from 'node:http';

/**
 * A CORS-adding proxy in front of the API, for `expo start --web` only.
 *
 * The app on a phone is a native client: it sends no `Origin` header, the
 * API's CORS callback lets such requests through, and no proxy exists anywhere
 * in production. A browser is different — it sends `Origin: http://localhost:8081`,
 * which is not on the API's allowlist, so every request from the web preview
 * fails and the screens render empty.
 *
 * Rather than widen the production allowlist to include a developer's laptop,
 * this sits in front of it locally. Run it beside the dev server:
 *
 *     pnpm --filter @jibli/mobile proxy        # terminal 1
 *     pnpm --filter @jibli/mobile web          # terminal 2
 *
 * It also serves a phone frame at `/` — open http://localhost:4010 rather than
 * the dev server directly, and the app renders at 390×844 inside a device
 * outline instead of stretched across a desktop window. A layout reviewed at
 * 1900px wide is not the layout anyone will use.
 *
 * Set JIBLI_PROXY_UPSTREAM to point somewhere other than the API it finds.
 */

/** The deployed API, used when nothing is running locally. */
const DEPLOYED = 'https://jibli-api.onrender.com';
/** Where `pnpm dev:api` listens. */
const LOCAL = `http://localhost:${process.env.API_PORT ?? 4000}`;

const PORT = Number(process.env.JIBLI_PROXY_PORT ?? 4010);
/** Where `expo start --web` serves the app. */
const APP_ORIGIN = process.env.JIBLI_APP_ORIGIN ?? 'http://localhost:8081';

/**
 * Headers a proxy must not forward verbatim.
 *
 * `origin` and `referer` are on the list for the reason this file exists at
 * all. Forwarding them would hand the API the browser's origin — the one its
 * CORS allowlist does not contain — and the request would be refused upstream
 * by the exact rule the proxy is here to sidestep. Dropping them makes the
 * upstream see what a phone sends, which is nothing.
 */
const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'origin',
  'referer',
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type,Authorization,X-App-Version,X-Idempotency-Key,X-Request-Id,X-Restaurant-Id',
  'Access-Control-Max-Age': '600',
};

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Phone sizes worth checking, smallest first.
 *
 * The small one is not nostalgia: an iPhone SE is 375 points wide and still
 * supported, and it is where a two-line category label or a long restaurant
 * name runs out of room first.
 */
const DEVICES = [
  { name: 'iPhone SE', width: 375, height: 667, safeTop: 20, safeBottom: 0, notch: false },
  { name: 'iPhone 14', width: 390, height: 844, safeTop: 47, safeBottom: 34, notch: true },
  { name: 'Pixel 7', width: 412, height: 915, safeTop: 24, safeBottom: 24, notch: false },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932, safeTop: 59, safeBottom: 34, notch: true },
];

function framePage(appOrigin) {
  const options = DEVICES.map(
    (d, i) =>
      `<option value="${d.width}x${d.height}x${d.safeTop}x${d.safeBottom}x${d.notch ? 1 : 0}"${i === 1 ? ' selected' : ''}>${d.name} — ${d.width}×${d.height}</option>`,
  ).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>جيبلي — معاينة الهاتف</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; flex-direction: column; align-items: center; gap: 20px;
    /* Centred rather than top-aligned: a scaled-down phone pinned to the top
       left a window's worth of empty grey under it and read as misaligned. */
    justify-content: center;
    padding: 20px 16px 28px;
    background: #14161a;
    color: #e5e7eb;
    font: 14px/1.6 "Segoe UI", system-ui, sans-serif;
  }
  header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: center; }
  h1 { font-size: 15px; font-weight: 600; margin: 0; color: #ff7f3f; }
  select, button {
    font: inherit; color: #e5e7eb; background: #22262d;
    border: 1px solid #343a44; border-radius: 8px; padding: 6px 10px; cursor: pointer;
  }
  .phone {
    position: relative;
    border: 10px solid #23262c;
    border-radius: 44px;
    background: #000;
    box-shadow: 0 24px 60px rgba(0,0,0,.55);
    overflow: hidden;
    transition: width .18s ease, height .18s ease;
  }
  /*
    The safe areas, reserved rather than drawn over.

    A browser reports env(safe-area-inset-*) as zero inside an iframe, so the
    app laid itself out as if the screen began at the very top — and the notch
    this page drew on top of it covered the header. Giving the strips their own
    height puts the app's first pixel exactly where a device's safe area ends,
    which is what the app itself does on hardware.
  */
  .phone__safe {
    background: #f8f9fa; flex-shrink: 0; position: relative;
  }
  .phone__stack { display: flex; flex-direction: column; height: 100%; }
  /* The island, in the space the app is already keeping clear of it. */
  .phone.has-notch .phone__safe--top::after {
    content: ""; position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%);
    width: 30%; height: 24px; background: #16181d; border-radius: 14px;
  }
  /* The home indicator, for the same reason. */
  .phone__safe--bottom::after {
    content: ""; position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
    width: 36%; height: 5px; background: #c9ccd2; border-radius: 3px;
  }
  iframe { width: 100%; flex: 1; border: 0; display: block; background: #f8f9fa; }
  .hint { font-size: 12px; color: #9ca3af; max-width: 560px; text-align: center; }
  code { background: #22262d; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
  <header>
    <h1>جيبلي — معاينة بحجم الهاتف</h1>
    <select id="size">${options}</select>
    <button id="reload">إعادة التحميل</button>
  </header>

  <div class="phone" id="phone">
    <div class="phone__stack">
      <div class="phone__safe phone__safe--top" id="safeTop"></div>
      <!--
        The allow attribute is what makes the GPS button work in here.

        This frame is cross-origin: the page is :4010 and the app is :8081. A
        browser refuses Geolocation to a cross-origin frame unless the parent
        delegates it through Permissions Policy. Without the attribute,
        navigator.geolocation still exists and is still callable, and its error
        callback fires with PERMISSION_DENIED before any prompt appears — so
        the preview looks like an app whose location feature is broken while
        the same code works on a phone.
      -->
      <iframe id="app" src="${appOrigin}" allow="geolocation"></iframe>
      <div class="phone__safe phone__safe--bottom" id="safeBottom"></div>
    </div>
  </div>

  <p class="hint">
    التطبيق نفسه يعمل على <code>${appOrigin}</code>. هذه الصفحة تعرضه بأبعاد الهاتف فقط —
    الخطوط ومساحات الأمان والإيماءات تبقى تقريبية، والحكم النهائي على جهاز حقيقي.
  </p>

<script>
  const phone = document.getElementById('phone');
  const size = document.getElementById('size');
  const app = document.getElementById('app');

  const safeTop = document.getElementById('safeTop');
  const safeBottom = document.getElementById('safeBottom');

  function apply() {
    const [w, h, top, bottom, notch] = size.value.split('x').map(Number);
    phone.style.width = w + 'px';
    phone.style.height = h + 'px';

    /*
     * The insets are part of the device's height, not extra on top of it: an
     * iPhone 14 is 844 points tall including the 47 above the app and the 34
     * below it. So they are carved out of the frame rather than added to it,
     * and what is left is what a screen actually gives a layout to work with.
     */
    safeTop.style.height = top + 'px';
    safeBottom.style.height = bottom + 'px';
    phone.classList.toggle('has-notch', notch === 1);

    // Keep it on screen on a laptop, without changing the layout the app sees.
    const room = window.innerHeight - 150;
    const scale = h > room ? room / h : 1;
    phone.style.transform = scale === 1 ? 'none' : 'scale(' + scale.toFixed(3) + ')';
    phone.style.transformOrigin = 'top center';

    /*
     * A transform does not change the space the element reserves.
     *
     * Scaled to 80%, the phone still occupied its full 844px in the layout, so
     * a fifth of that height sat under it as dead grey and the frame looked
     * shoved against the top of the window. Pulling the leftover back is what
     * lets the page's centring actually centre what is drawn.
     */
    phone.style.marginBottom = Math.round(h * (scale - 1)) + 'px';

    localStorage.setItem('jibli.preview.size', size.value);
  }

  size.addEventListener('change', apply);
  window.addEventListener('resize', apply);
  document.getElementById('reload').addEventListener('click', () => {
    app.src = app.src;
  });

  const saved = localStorage.getItem('jibli.preview.size');
  if (saved) size.value = saved;
  apply();
</script>
</body>
</html>`;
}

/**
 * The API this proxy talks to.
 *
 * An explicit JIBLI_PROXY_UPSTREAM wins. Otherwise it looks for an API on this
 * machine first and falls back to the deployed one — which is the order that
 * matches what a developer means. Starting the API locally and then watching
 * the preview talk to Render (or the reverse) is a confusing ten minutes, and
 * the two behave differently: only a local run returns OTP codes.
 *
 * Probed once, at startup. Start the API afterwards and restart this.
 */
async function resolveUpstream() {
  const explicit = process.env.JIBLI_PROXY_UPSTREAM;
  if (explicit) return { url: explicit.replace(/\/$/, ''), reason: 'JIBLI_PROXY_UPSTREAM' };

  try {
    const probe = await fetch(`${LOCAL}/health/live`, { signal: AbortSignal.timeout(800) });
    if (probe.ok) return { url: LOCAL, reason: 'a local API is running' };
  } catch {
    /* nothing local; the deployed API it is */
  }

  return { url: DEPLOYED, reason: 'no local API found' };
}

let upstream = { url: DEPLOYED, reason: 'not resolved yet' };

/** Whether a response means "the upstream is not up yet", as opposed to an answer. */
const isColdStart = (status) => status === 502 || status === 503 || status === 504;

/**
 * How long to keep trying before giving up.
 *
 * Render's free plan spins an idle service down after fifteen minutes and
 * takes about a minute to wake it. During that minute the request either
 * hangs, is refused, or comes back 502 from Render's edge — and the proxy
 * used to turn every one of those into a bare 502 with a JavaScript error
 * string in it, which the app rendered as «حدث خطأ غير متوقع». The first
 * request of a session failing is not a bug in the app; it is a cold start,
 * and waiting it out is the whole fix.
 */
const WAKE_BUDGET_MS = 90_000;
const ATTEMPT_TIMEOUT_MS = 30_000;

/**
 * A local API gets one attempt.
 *
 * Nothing wakes up on localhost: a refused connection means the process is not
 * running, and ninety seconds of retries would only delay saying so.
 */
const wakeBudget = () => (upstream.url.startsWith('http://localhost') ? 0 : WAKE_BUDGET_MS);

let announcedWake = false;

async function forward(request, body) {
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([key]) => !HOP_BY_HOP.has(key)),
  );

  const deadline = Date.now() + wakeBudget();
  let lastError = null;

  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await fetch(`${upstream.url}${request.url}`, {
        method: request.method,
        headers,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body }),
      });

      if (!isColdStart(result.status) || Date.now() >= deadline) return { result };
      lastError = `upstream ${result.status}`;
    } catch (error) {
      lastError = String(error);
      if (Date.now() >= deadline) return { error: lastError };
    }

    if (!announcedWake) {
      announcedWake = true;
      console.log(`Upstream not answering (${lastError}) — waking it, this takes up to a minute…`);
    }

    // Back off, but stay inside the budget.
    const wait = Math.min(2000 * attempt, 8000, Math.max(0, deadline - Date.now()));
    if (wait === 0) return { error: lastError };
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/*
 * Resolved before the first connection is accepted, rather than in the listen
 * callback: the probe is a network round trip, and a request that arrived
 * during it would silently go to the wrong API.
 */
upstream = await resolveUpstream();

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS).end();
    return;
  }

  // Anything that is not an API call is the preview frame.
  if (
    request.method === 'GET' &&
    !request.url.startsWith('/api/') &&
    !request.url.startsWith('/health')
  ) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(framePage(APP_ORIGIN));
    return;
  }

  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBody(request);

  const { result, error } = await forward(request, body);

  if (error) {
    console.error(`503 ${request.method} ${request.url} — ${upstream.url} unreachable: ${error}`);
    if (upstream.url === LOCAL) {
      console.error('  Start it with `pnpm dev:api`, or unset JIBLI_PROXY_UPSTREAM to use the deployed API.');
    }
    /*
     * Answer in the API's own error shape, with a code the app knows.
     *
     * `api.ts` reads `error.message` as the Arabic text to show, and falls
     * back to «حدث خطأ غير متوقع» for anything it cannot parse. A raw
     * `TypeError: fetch failed` under an invented code told the user nothing
     * and told the developer nothing either.
     */
    response.writeHead(503, { ...CORS, 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'الخدمة غير متاحة حالياً، الرجاء المحاولة بعد قليل',
          details: { upstream: upstream.url, reason: error },
          request_id: '',
        },
      }),
    );
    return;
  }

  announcedWake = false;
  const payload = Buffer.from(await result.arrayBuffer());
  response.writeHead(result.status, {
    ...CORS,
    'Content-Type': result.headers.get('content-type') ?? 'application/json',
  });
  response.end(payload);

  if (result.status >= 400) {
    console.log(`${result.status} ${request.method} ${request.url}`);
  }
});

server.listen(PORT, () => {
  console.log(`Jibli dev proxy: http://localhost:${PORT} → ${upstream.url}  (${upstream.reason})`);
  console.log(`Phone-sized preview: http://localhost:${PORT}  (frames ${APP_ORIGIN})`);
  if (upstream.url === DEPLOYED) {
    console.log(
      'The deployed API sleeps when idle; the first request may take a minute to wake it.',
    );
  }
  console.log('The web preview points here for data; phones talk to the API directly.');
});
