'use client';

import { useEffect, useState } from 'react';

/**
 * Debounce a rapidly changing value.
 *
 * Search boxes hit paginated endpoints; firing a request per keystroke wastes
 * the server's bounded page budget and makes results flicker as slower
 * responses land out of order (plan §74).
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
