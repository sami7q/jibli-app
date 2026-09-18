import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Type-only, so it is erased before runtime and does not load the module ahead
// of the mocks below. The values come from the dynamic import.
import type { ApiError as ApiErrorShape } from './api';

/**
 * The API client's four behaviours that are hard to see and expensive to get
 * wrong on a phone.
 *
 * Nothing in the mobile app was tested before this file — the client contains
 * the single-flight token refresh, and a bug there revokes the whole refresh
 * chain as a replay and signs the customer out mid-order. That is not something
 * to find on a device.
 *
 * `secure-store` is mocked because it is native; everything else is the real
 * module.
 */

const store = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked',
  setItemAsync: async (key: string, value: string) => void store.set(key, value),
  getItemAsync: async (key: string) => store.get(key) ?? null,
  deleteItemAsync: async (key: string) => void store.delete(key),
}));

/*
 * React Native's published source is Flow, not TypeScript, and Vite's parser
 * stops on `import typeof` the moment anything in the graph reaches for it —
 * the whole suite fails to collect, with an error that names no file.
 *
 * `secure-session` imports `Platform` to tell a browser from a device. Under
 * the test runner it is neither, and `'ios'` is the branch worth exercising:
 * the keystore path, which is what actually ships.
 */
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (spec: Record<string, unknown>) => spec.ios ?? spec.default },
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.2.3', extra: { apiUrl: 'https://api.test' } } },
}));

const { apiRequest, ApiError, NetworkError, idempotencyKey } = await import('./api');
const { saveSession, loadSession } = await import('./secure-session');

/**
 * The error a request rejected with.
 *
 * A bare `.catch(e => e)` widens to `unknown` and — worse — turns a request
 * that unexpectedly *succeeds* into a passing test with an undefined error.
 * This fails loudly on a resolve, which is the case worth catching.
 */
async function rejection(promise: Promise<unknown>): Promise<ApiErrorShape> {
  let caught: unknown;
  let rejected = false;

  try {
    await promise;
  } catch (error) {
    caught = error;
    rejected = true;
  }

  if (!rejected) throw new Error('expected the request to reject, but it resolved');
  return caught as ApiErrorShape;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  store.clear();
  await saveSession({ accessToken: 'access-1', refreshToken: 'refresh-1', userId: 'u1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('apiRequest()', () => {
  it('unwraps the envelope rather than handing back the whole body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: { ok: true }, meta: {} })),
    );

    await expect(apiRequest('/api/v1/thing')).resolves.toEqual({ ok: true });
  });

  it('sends the bearer token and the app version', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: null, meta: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/v1/thing');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/v1/thing');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-1');
    // The server refuses a build older than the minimum (plan §119); it can
    // only do that if every request says which build it is.
    expect(headers['X-App-Version']).toBe('1.2.3');
  });

  it('omits the token where the caller says the route is public', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [], meta: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/v1/storefront', { authenticated: false });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('turns an error body into an ApiError carrying the Arabic message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: 'MINIMUM_ORDER_NOT_MET',
              message: 'الحد الأدنى للطلب غير محقق',
              details: { minimumOrderIqd: 10000 },
              request_id: 'req-9',
            },
          },
          422,
        ),
      ),
    );

    const error = await rejection(apiRequest('/api/v1/orders', { method: 'POST' }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('MINIMUM_ORDER_NOT_MET');
    // The server already answered in Arabic; replacing it with a generic
    // string throws away the only part that helps (plan §112).
    expect(error.messageAr).toBe('الحد الأدنى للطلب غير محقق');
    expect(error.isRecoverableBusinessError).toBe(true);
  });

  it('distinguishes a dead connection from an answer the server chose to give', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    );

    // The difference decides whether a placed order is resolved by idempotency
    // key or treated as failed (plan §109) — so it is a distinct type, not a
    // status code.
    await expect(apiRequest('/api/v1/orders')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('token refresh', () => {
  it('refreshes once on 401 and replays the original request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'SESSION_EXPIRED' } }, 401))
      .mockResolvedValueOnce(
        jsonResponse({ data: { access_token: 'access-2', refresh_token: 'refresh-2' }, meta: {} }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true }, meta: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/v1/thing')).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Rotated, and stored — the next request must not present the old one.
    await expect(loadSession()).resolves.toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
  });

  it('refreshes exactly once when several requests fail together', async () => {
    let refreshes = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/refresh')) {
          refreshes += 1;
          // Slow enough that all three callers are waiting on it.
          await new Promise((resolve) => setTimeout(resolve, 10));
          return jsonResponse({
            data: { access_token: 'access-2', refresh_token: 'refresh-2' },
            meta: {},
          });
        }
        // Every first attempt is stale; the replay carries the new token.
        return jsonResponse({ data: { ok: true }, meta: {} }, refreshes === 0 ? 401 : 200);
      }),
    );

    await Promise.all([
      apiRequest('/api/v1/a'),
      apiRequest('/api/v1/b'),
      apiRequest('/api/v1/c'),
    ]);

    /*
     * The whole point. Rotation is single-use: three concurrent refreshes
     * would present an already-rotated token twice, and the server revokes the
     * entire chain as a replay (plan §77) — signing the customer out, usually
     * mid-order, for no reason they can see.
     */
    expect(refreshes).toBe(1);
  });

  it('gives up rather than looping when the refresh itself is rejected', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh')
        ? jsonResponse({ error: { code: 'SESSION_EXPIRED' } }, 401)
        : jsonResponse({ error: { code: 'UNAUTHENTICATED' } }, 401),
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = await rejection(apiRequest('/api/v1/thing'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.needsLogin).toBe(true);
    // The session is cleared, so the app routes to sign-in instead of retrying.
    await expect(loadSession()).resolves.toBeNull();
    // One attempt, one refresh, and stop.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('a sleeping server', () => {
  /**
   * The API runs on a plan that spins down when idle. Waking it takes about a
   * minute, and during that minute the edge — not the API — answers with an
   * HTML 502 the client cannot parse.
   */
  const gatewayHtml = (status: number) =>
    new Response('<html><body>Bad Gateway</body></html>', {
      status,
      headers: { 'Content-Type': 'text/html' },
    });

  beforeEach(() => {
    // The retry sleeps between attempts; no test should wait for it in real time.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Run a request to completion, letting every backoff elapse instantly. */
  async function settle<T>(pending: Promise<T>): Promise<T> {
    const done = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.runAllTimersAsync();
    const outcome = await done;
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  }

  it('waits out a cold start on a read and returns the eventual answer', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 1 ? gatewayHtml(502) : jsonResponse({ data: { ok: true }, meta: {} });
      }),
    );

    await expect(settle(apiRequest('/api/v1/storefront', { authenticated: false }))).resolves.toEqual(
      { ok: true },
    );
    expect(calls).toBe(2);
  });

  it('does not repeat a write, whatever the gateway claims', async () => {
    const fetchMock = vi.fn(async () => gatewayHtml(503));
    vi.stubGlobal('fetch', fetchMock);

    const error = await rejection(
      settle(apiRequest('/api/v1/orders', { method: 'POST', body: { id: 1 } })),
    );

    // Once. A gateway saying the request never arrived is what the gateway
    // believes, not what the server knows, and a duplicate order is worse.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.status).toBe(503);
  });

  it('says the service is unavailable rather than «unexpected error»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gatewayHtml(502)),
    );

    const error = await rejection(settle(apiRequest('/api/v1/thing', { method: 'POST', body: {} })));

    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.messageAr).toBe('الخدمة غير متاحة حالياً، الرجاء المحاولة بعد قليل');
  });

  it('gives up after a bounded number of attempts', async () => {
    const fetchMock = vi.fn(async () => gatewayHtml(504));
    vi.stubGlobal('fetch', fetchMock);

    const error = await rejection(settle(apiRequest('/api/v1/storefront', { authenticated: false })));

    // The original plus two retries, then the error — never an open loop.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('idempotencyKey()', () => {
  it('is unique per call, so a retry is the caller reusing one deliberately', () => {
    const keys = new Set(Array.from({ length: 200 }, () => idempotencyKey('order')));
    expect(keys.size).toBe(200);
  });

  it('carries its scope, so a key in a log says what it was for', () => {
    expect(idempotencyKey('order')).toMatch(/^order-/);
  });
});

describe('request timeouts', () => {
  /**
   * `fetch` has no timeout of its own, anywhere. Without the one this client
   * adds, a connection that opens and is never answered — an ordinary event on
   * mobile data — left every screen in the app on a spinner indefinitely, with
   * no error and no way out but force-quitting.
   */

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A fetch that respects its abort signal and otherwise never answers. */
  const hangs = () =>
    vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
          );
        }),
    );

  async function settle<T>(pending: Promise<T>): Promise<T> {
    const done = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.runAllTimersAsync();
    const outcome = await done;
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  }

  it('gives up on a read that never answers, as a NetworkError', async () => {
    vi.stubGlobal('fetch', hangs());

    const error = await rejection(
      settle(apiRequest('/api/v1/storefront', { authenticated: false })),
    );

    // Reported as a network failure rather than a new error class, so the
    // retry rules and the Arabic message every screen already handles apply.
    expect(error).toBeInstanceOf(NetworkError);
  });

  it('gives a write longer than a read before giving up', async () => {
    const fetchMock = hangs();
    vi.stubGlobal('fetch', fetchMock);

    const pending = apiRequest('/api/v1/orders', { method: 'POST', body: { id: 1 } }).catch(
      (error: unknown) => error,
    );

    // Past the read timeout, a write must still be waiting: it may have reached
    // the server and be committing, and the answer is worth more than the wait.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toBeInstanceOf(NetworkError);
  });

  it('honours a caller that cancels, without calling it a network failure', async () => {
    vi.stubGlobal('fetch', hangs());
    const controller = new AbortController();

    const pending = apiRequest('/api/v1/storefront', {
      authenticated: false,
      signal: controller.signal,
    }).catch((error: unknown) => error);

    controller.abort();
    await vi.runAllTimersAsync();

    // A screen unmounting is not an error to show anybody, so it must stay an
    // abort rather than becoming «تعذّر الاتصال بالخادم».
    const error = await pending;
    expect(error).not.toBeInstanceOf(NetworkError);
    expect((error as Error).name).toBe('AbortError');
  });

  it('does not leave its timer running after a request settles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { ok: true }, meta: {} })));

    await apiRequest('/api/v1/storefront', { authenticated: false });

    // A 15-second timer left behind by every request would pile up on a list
    // screen and keep the app awake for no reason.
    expect(vi.getTimerCount()).toBe(0);
  });
});
