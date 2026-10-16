import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Orders whose rating prompt the customer waved away with «لاحقاً».
 *
 * Kept on the device so the sheet does not reappear over the chooser on every
 * cold start for the five days the window stays open (CUST-15). Local for the
 * same reason the pin and notification markers are: it is a fact about a card
 * someone closed on this phone, and the five-day window is the server's — once
 * an order falls out of `reviews/pending` the stored id is simply inert.
 *
 * `expo-secure-store` is `export default {}` on web, so the browser preview
 * falls back to `localStorage`, exactly as the session store does. Nothing here
 * is secret; it is a short list of order ids.
 */

const KEY = 'jibli.reviews.dismissed';
/** Bounded so the list cannot grow without end across months of orders. */
const MAX = 50;

const isWeb = Platform.OS === 'web';

async function read(): Promise<string[]> {
  try {
    const raw = isWeb
      ? (globalThis.localStorage?.getItem(KEY) ?? null)
      : await SecureStore.getItemAsync(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function loadDismissedReviews(): Promise<string[]> {
  return read();
}

export async function dismissReview(orderId: string): Promise<void> {
  try {
    const current = await read();
    if (current.includes(orderId)) return;
    const next = [...current, orderId].slice(-MAX);
    const raw = JSON.stringify(next);
    if (isWeb) globalThis.localStorage?.setItem(KEY, raw);
    else await SecureStore.setItemAsync(KEY, raw);
  } catch {
    /* Losing it costs the prompt appearing once more. */
  }
}
