/**
 * Predictable identifiers for tests.
 *
 * Production rows carry UUIDv7, which is random and time-ordered — excellent in
 * a database, unreadable in a failing assertion. A test that says
 * `expected order-2, got order-3` diagnoses itself; one that compares two v7
 * strings does not.
 *
 * These are *not* UUIDs and must never reach a database column typed as one.
 * They are for in-memory domain tests, where an identifier is only ever
 * compared for equality.
 */

export function idSequence(prefix: string): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
}

/**
 * A valid UUID built from a counter, for the cases that *do* hit the database.
 *
 * Deterministic and ordered, so a failure names a recognisable row while still
 * satisfying a uuid column and any `z.string().uuid()` validation in front of
 * it. Version and variant nibbles are set so it parses as a v4 UUID.
 */
export function uuidSequence(seed = 0): () => string {
  let counter = seed;
  return () => {
    counter += 1;
    const hex = counter.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
}
