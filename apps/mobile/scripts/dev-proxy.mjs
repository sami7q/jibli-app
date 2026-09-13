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
 * `web` points the app at this by setting EXPO_PUBLIC_API_URL.
 *
 * Set JIBLI_PROXY_UPSTREAM to point somewhere other than the deployed API.
 */

const UPSTREAM = (process.env.JIBLI_PROXY_UPSTREAM ?? 'https://jibli-api.onrender.com').replace(
  /\/$/,
  '',
);
const PORT = Number(process.env.JIBLI_PROXY_PORT ?? 4010);

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

createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS).end();
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
  console.log('The web preview points here; phones talk to the API directly.');
});
