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
 * Set JIBLI_PROXY_UPSTREAM to point somewhere other than the deployed API.
 */

const UPSTREAM = (process.env.JIBLI_PROXY_UPSTREAM ?? 'https://jibli-api.onrender.com').replace(
  /\/$/,
  '',
);
const PORT = Number(process.env.JIBLI_PROXY_PORT ?? 4010);
/** Where `expo start --web` serves the app. */
const APP_ORIGIN = process.env.JIBLI_APP_ORIGIN ?? 'http://localhost:8081';

/** Headers a proxy must not forward verbatim. */
const HOP_BY_HOP = new Set(['host', 'connection', 'content-length', 'accept-encoding']);

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
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'Pixel 7', width: 412, height: 915 },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932 },
];

function framePage(appOrigin) {
  const options = DEVICES.map(
    (d, i) =>
      `<option value="${d.width}x${d.height}"${i === 1 ? ' selected' : ''}>${d.name} — ${d.width}×${d.height}</option>`,
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
    padding: 24px 16px 40px;
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
  /* The notch, only so the top inset is visible rather than imagined. */
  .phone::before {
    content: ""; position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
    width: 34%; height: 22px; background: #23262c; border-radius: 0 0 14px 14px; z-index: 2;
    pointer-events: none;
  }
  iframe { width: 100%; height: 100%; border: 0; display: block; background: #f8f9fa; }
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

  <div class="phone" id="phone"><iframe id="app" src="${appOrigin}"></iframe></div>

  <p class="hint">
    التطبيق نفسه يعمل على <code>${appOrigin}</code>. هذه الصفحة تعرضه بأبعاد الهاتف فقط —
    الخطوط ومساحات الأمان والإيماءات تبقى تقريبية، والحكم النهائي على جهاز حقيقي.
  </p>

<script>
  const phone = document.getElementById('phone');
  const size = document.getElementById('size');
  const app = document.getElementById('app');

  function apply() {
    const [w, h] = size.value.split('x').map(Number);
    phone.style.width = w + 'px';
    phone.style.height = h + 'px';
    // Keep it on screen on a laptop, without changing the layout the app sees.
    const room = window.innerHeight - 190;
    phone.style.transform = h > room ? 'scale(' + (room / h).toFixed(3) + ')' : 'none';
    phone.style.transformOrigin = 'top center';
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

createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS).end();
    return;
  }

  // Anything that is not an API call is the preview frame.
  if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/health')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(framePage(APP_ORIGIN));
    return;
  }

  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([key]) => !HOP_BY_HOP.has(key)),
  );

  try {
    const upstream = await fetch(`${UPSTREAM}${request.url}`, {
      method: request.method,
      headers,
      ...(request.method === 'GET' || request.method === 'HEAD'
        ? {}
        : { body: await readBody(request) }),
    });

    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      ...CORS,
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    });
    response.end(body);

    if (upstream.status >= 400) {
      console.log(`${upstream.status} ${request.method} ${request.url}`);
    }
  } catch (error) {
    console.error(`502 ${request.method} ${request.url} — ${String(error)}`);
    response.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'PROXY_FAILED', message: String(error) } }));
  }
}).listen(PORT, () => {
  console.log(`Jibli dev proxy: http://localhost:${PORT} → ${UPSTREAM}`);
  console.log(`Phone-sized preview: http://localhost:${PORT}  (frames ${APP_ORIGIN})`);
  console.log('The web preview points here for data; phones talk to the API directly.');
});
