/**
 * When the shop's phone and the courier's phone should ring.
 *
 * The two live engines (`owner-live.tsx`, `driver-live.tsx`) poll and listen;
 * this decides, from one snapshot to the next, whether what changed is worth
 * interrupting somebody for. No React and no network, so every rule here is
 * pinned by `work-watch.test.ts` rather than discovered on a device.
 */

/** Anything with an id and a status: an order on the board, a courier's task. */
interface Tracked {
  readonly id: string;
  readonly status: string;
}

/**
 * Pending orders that were not on the board last time.
 *
 * `known` is every order id seen so far (null before the first snapshot).
 * The first snapshot rings only for orders already waiting — an owner opening
 * the app with an order on the board must hear it — and never for history.
 */
export function freshPending(
  known: ReadonlySet<string> | null,
  orders: readonly Tracked[],
  pendingStatus = 'PENDING_RESTAURANT',
): { fresh: string[]; known: Set<string> } {
  const next = new Set(known ?? []);
  const fresh: string[] = [];
  for (const order of orders) {
    if (order.status === pendingStatus && !next.has(order.id)) fresh.push(order.id);
    next.add(order.id);
  }
  return { fresh, known: next };
}

/** A courier's task as the list endpoint returns it. */
export interface TaskSnapshot {
  readonly assignment_id: string;
  readonly status: string;
  readonly order_status: string;
}

/**
 * What changed for a courier between two looks at their active tasks.
 *
 * `assigned`: a task they have not seen before — a new job to accept.
 * `ready`: a task they already hold whose order just became READY — time to
 * go and collect it.
 */
export function courierChanges(
  previous: ReadonlyMap<string, TaskSnapshot> | null,
  tasks: readonly TaskSnapshot[],
): { assigned: string[]; ready: string[]; snapshot: Map<string, TaskSnapshot> } {
  const snapshot = new Map(tasks.map((task) => [task.assignment_id, task]));
  if (previous === null) {
    // First look: a task still waiting for an answer rings; the rest is state.
    return {
      assigned: tasks.filter((task) => task.status === 'ASSIGNED').map((t) => t.assignment_id),
      ready: [],
      snapshot,
    };
  }

  const assigned: string[] = [];
  const ready: string[] = [];
  for (const task of tasks) {
    const before = previous.get(task.assignment_id);
    if (!before) {
      assigned.push(task.assignment_id);
      continue;
    }
    const collecting = task.status === 'ASSIGNED' || task.status === 'ACCEPTED';
    if (collecting && task.order_status === 'READY' && before.order_status !== 'READY') {
      ready.push(task.assignment_id);
    }
  }
  return { assigned, ready, snapshot };
}

/** How often a waiting order rings again, and for how long. */
export const REMINDER_EVERY_MS = 30_000;
export const REMINDER_FOR_MS = 5 * 60_000;

/**
 * Whether to ring again for something still waiting.
 *
 * Every 30 seconds for the first five minutes: long enough to reach somebody
 * who stepped away from the counter, short of turning the phone into an alarm
 * nobody can stop. A new order restarts it; answering the order ends it.
 */
export function shouldRemind(
  waitingSince: number | null,
  lastRang: number | null,
  now: number,
): boolean {
  if (waitingSince === null || lastRang === null) return false;
  if (now - waitingSince > REMINDER_FOR_MS) return false;
  return now - lastRang >= REMINDER_EVERY_MS;
}
