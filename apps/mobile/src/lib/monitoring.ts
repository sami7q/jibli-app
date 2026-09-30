import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { configString } from './app-config';

/**
 * Crash reporting.
 *
 * Before this, a render error was caught by `ErrorBoundary`, written to
 * `console.error`, and lost — `console` output goes nowhere in a release build.
 * The app shipped with no way to learn that it had crashed on anybody's phone.
 *
 * That was a worse gap here than it usually is. `expo-updates` is configured,
 * so a JavaScript fix reaches every installed copy in minutes rather than in a
 * review cycle; the expensive missing half was knowing *what* to fix. A crash
 * on one Android version, or on the one screen a customer reaches only at
 * checkout, would have been visible first as a review saying "لا يعمل".
 *
 * **Off unless a DSN is configured.** `EXPO_PUBLIC_SENTRY_DSN` is read when the
 * config is evaluated, so it is baked in at build time like every other
 * `EXPO_PUBLIC_` value. With none, `init` is never called and the SDK does
 * nothing — which keeps a development build, and a build made before a Sentry
 * project exists, behaving exactly as it did.
 *
 * **It costs 1.37 MB of JavaScript, on both platforms, measured.** That is a
 * large fraction of the payload and it is paid whether or not a DSN is set:
 * Metro does not tree-shake this SDK, and importing only `init` and
 * `captureException` by name was measured and changed nothing. It is the price
 * of the feature rather than an oversight, and it is worth stating next to the
 * feature rather than discovering later while chasing binary size. If the
 * trade-off is judged wrong, removing the dependency is the lever — not
 * rearranging these imports.
 */

/*
 * A DSN is an https URL or it is nothing. This line was `extra.sentryDsn`, and
 * the release APK embedded `{}` for the unset value — truthy — so the installed
 * app initialised Sentry with an object for an address on its first line and
 * closed on the splash. See `app-config.ts`.
 */
const configured = configString('sentryDsn');
const dsn = configured?.startsWith('https://') ? configured : null;

export function startMonitoring(): void {
  if (!dsn) return;

  /*
   * Crash reporting must never be the crash. A bad DSN or a native init
   * failure costs the reports, not the app.
   */
  try {
    initSentry(dsn);
  } catch {
    /* The app runs unreported rather than not at all. */
  }
}

function initSentry(dsn: string): void {
  Sentry.init({
    dsn,
    /*
     * The binary's version, so a spike can be attributed to a release.
     *
     * `runtimeVersion` follows `version`, and an over-the-air update does not
     * change either — so two builds of 1.0.0 carrying different JavaScript
     * report the same release. That is a known limit of reading it from here
     * and is worth more than reporting nothing.
     */
    release: Constants.expoConfig?.version ?? '1.0.0',

    /*
     * Errors only. No performance tracing, no session replay, no profiling.
     *
     * Each of those samples continuously and sends far more than a crash does,
     * on a connection the customer is paying for by the megabyte. The question
     * this is here to answer is "did it crash, and where" — nothing else.
     */
    tracesSampleRate: 0,

    /*
     * `sendDefaultPii` is false by default and is left that way deliberately.
     *
     * This app holds phone numbers and home addresses, and the privacy manifest
     * in `app.config.ts` declares that none of it is collected for tracking. A
     * crash reporter that quietly attached a request body would make that
     * declaration untrue.
     */
    sendDefaultPii: false,

    /*
     * The one place anything identifying could leak.
     *
     * Breadcrumbs record navigation and network calls automatically, and this
     * app's URLs carry ids — `/order/<uuid>` — which are not names but are
     * still a customer's order history. Dropping the query string keeps the
     * route shape, which is what makes a stack trace readable, without the
     * parameters.
     */
    beforeBreadcrumb(breadcrumb) {
      if (typeof breadcrumb.data?.url === 'string') {
        const [path] = breadcrumb.data.url.split('?');
        return { ...breadcrumb, data: { ...breadcrumb.data, url: path } };
      }
      return breadcrumb;
    },
  });
}

/**
 * Report an error that the app handled but should not have had to.
 *
 * Distinct from an unhandled crash, which the SDK captures on its own. This is
 * for the cases the app recovers from and would otherwise stay silent about —
 * a render error caught by the boundary being the one that matters.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!dsn) return;

  Sentry.captureException(error, context ? { extra: context } : undefined);
}
