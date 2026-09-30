import { describe, expect, it } from 'vitest';
import {
  REMINDER_EVERY_MS,
  REMINDER_FOR_MS,
  courierChanges,
  freshPending,
  shouldRemind,
} from './work-watch';

/**
 * When a shop's phone and a courier's phone ring.
 *
 * Getting these wrong in one direction is an order nobody answers; in the
 * other it is a phone that rings for history and gets muted for good. Both
 * directions are pinned here.
 */

const order = (id: string, status: string) => ({ id, status });
const task = (assignment_id: string, status: string, order_status: string) => ({
  assignment_id,
  status,
  order_status,
});

describe('a new order for the shop', () => {
  it('rings on first load for an order already waiting', () => {
    const { fresh } = freshPending(null, [order('a', 'PENDING_RESTAURANT'), order('b', 'READY')]);
    expect(fresh).toEqual(['a']);
  });

  it('does not ring for history on first load', () => {
    const { fresh } = freshPending(null, [order('a', 'COMPLETED'), order('b', 'PREPARING')]);
    expect(fresh).toEqual([]);
  });

  it('rings for an order that was not on the board last time', () => {
    const first = freshPending(null, [order('a', 'ACCEPTED')]);
    const second = freshPending(first.known, [
      order('a', 'ACCEPTED'),
      order('b', 'PENDING_RESTAURANT'),
    ]);
    expect(second.fresh).toEqual(['b']);
  });

  it('rings once per order, however many times the board reloads', () => {
    const first = freshPending(null, [order('b', 'PENDING_RESTAURANT')]);
    const again = freshPending(first.known, [order('b', 'PENDING_RESTAURANT')]);
    expect(again.fresh).toEqual([]);
  });

  it('does not ring for an order that arrives already answered', () => {
    const first = freshPending(null, []);
    const next = freshPending(first.known, [order('c', 'ACCEPTED')]);
    expect(next.fresh).toEqual([]);
  });
});

describe('a courier’s task', () => {
  it('rings on first look for a task still waiting to be accepted', () => {
    const { assigned } = courierChanges(null, [task('t1', 'ASSIGNED', 'PREPARING')]);
    expect(assigned).toEqual(['t1']);
  });

  it('does not ring on first look for a task already under way', () => {
    const { assigned, ready } = courierChanges(null, [task('t1', 'PICKED_UP', 'OUT_FOR_DELIVERY')]);
    expect(assigned).toEqual([]);
    expect(ready).toEqual([]);
  });

  it('rings for a task that was not there before', () => {
    const first = courierChanges(null, []);
    const next = courierChanges(first.snapshot, [task('t2', 'ASSIGNED', 'ACCEPTED')]);
    expect(next.assigned).toEqual(['t2']);
  });

  it('rings when the order the courier is waiting on becomes ready', () => {
    const first = courierChanges(null, [task('t1', 'ACCEPTED', 'PREPARING')]);
    const next = courierChanges(first.snapshot, [task('t1', 'ACCEPTED', 'READY')]);
    expect(next.ready).toEqual(['t1']);
    expect(next.assigned).toEqual([]);
  });

  it('rings for ready only once', () => {
    const first = courierChanges(null, [task('t1', 'ACCEPTED', 'READY')]);
    const next = courierChanges(first.snapshot, [task('t1', 'ACCEPTED', 'READY')]);
    expect(next.ready).toEqual([]);
  });

  it('does not ring for ready after the courier has already collected it', () => {
    const first = courierChanges(null, [task('t1', 'PICKED_UP', 'READY')]);
    const next = courierChanges(first.snapshot, [task('t1', 'PICKED_UP', 'OUT_FOR_DELIVERY')]);
    expect(next.ready).toEqual([]);
  });
});

describe('reminders', () => {
  const start = 1_000_000;

  it('waits the interval before ringing again', () => {
    expect(shouldRemind(start, start, start + REMINDER_EVERY_MS - 1)).toBe(false);
    expect(shouldRemind(start, start, start + REMINDER_EVERY_MS)).toBe(true);
  });

  it('stops after the reminder window, so the phone is not an alarm', () => {
    const late = start + REMINDER_FOR_MS + 1;
    expect(shouldRemind(start, late - REMINDER_EVERY_MS, late)).toBe(false);
  });

  it('never reminds for nothing', () => {
    expect(shouldRemind(null, null, start)).toBe(false);
    expect(shouldRemind(start, null, start + REMINDER_EVERY_MS)).toBe(false);
  });
});
