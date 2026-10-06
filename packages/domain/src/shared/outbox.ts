import type { EventType } from '@jibli/contracts';
import { outboxEvents, uuidv7, type DbExecutor } from '@jibli/db';

/**
 * Transactional outbox writer (plan §31).
 *
 *   order DB transaction
 *   → outbox_events row in the SAME transaction
 *   → worker reads outbox
 *   → realtime publish
 *   → push/browser notification
 *   → mark published
 *
 * Because the event row commits with the state change, "the order exists but
 * nobody was told" is impossible. If realtime is down the event simply stays
 * pending and is retried.
 *
 * Every function here takes the transaction explicitly. Passing a pooled
 * connection by mistake would silently break the guarantee, so the parameter is
 * named `tx` and never defaulted.
 */

export interface OutboxEventInput {
  readonly eventType: EventType;
  readonly aggregateType:
    'order' | 'delivery' | 'restaurant' | 'settlement' | 'inventory' | 'geography' | 'driver';
  readonly aggregateId: string;
  readonly aggregateVersion?: number;
  readonly payload: Record<string, unknown>;
  readonly requestId?: string | null;
}

export async function enqueueOutboxEvent(tx: DbExecutor, event: OutboxEventInput): Promise<string> {
  const id = uuidv7();
  await tx.insert(outboxEvents).values({
    id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion ?? 0,
    payload: event.payload,
    status: 'PENDING',
    requestId: event.requestId ?? null,
  });
  return id;
}

/** Insert several events atomically — one order transition can fan out to many. */
export async function enqueueOutboxEvents(
  tx: DbExecutor,
  events: readonly OutboxEventInput[],
): Promise<string[]> {
  if (events.length === 0) return [];
  const rows = events.map((event) => ({
    id: uuidv7(),
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion ?? 0,
    payload: event.payload,
    status: 'PENDING' as const,
    requestId: event.requestId ?? null,
  }));
  await tx.insert(outboxEvents).values(rows);
  return rows.map((r) => r.id);
}

/**
 * Exponential backoff with jitter for a failed publish (plan §93).
 *
 * Jitter matters: without it, a provider outage produces a synchronised retry
 * stampede the moment it recovers.
 */
export function nextAttemptDelayMs(attemptCount: number): number {
  const baseMs = 1_000;
  const maxMs = 5 * 60 * 1_000;
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.min(attemptCount, 10));
  const jitter = Math.random() * exponential * 0.3;
  return Math.floor(exponential - exponential * 0.15 + jitter);
}

/** After this many failures the event is parked for a human (plan §93). */
export const OUTBOX_MAX_ATTEMPTS = 12;
