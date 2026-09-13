import { eq, sql } from 'drizzle-orm';
import {
  AppError,
  assertTransition,
  DELIVERY_TRANSITIONS,
  ERROR_CODES,
  EVENT_TYPES,
} from '@jibli/contracts';
import { assertOwnsAssignment, type Principal } from '@jibli/auth';
import {
  appendLedgerEntry,
  assertOverrideAllowed,
  enqueueOutboxEvent,
  verifyDeliveryPin,
  writeAudit,
  AUDIT_ACTIONS,
} from '@jibli/domain';
import {
  deliveryAssignments,
  deliveryPinAttempts,
  driverCashEvents,
  drivers,
  orders,
  orderStatusHistory,
  uuidv7,
} from '@jibli/db';
import { consumeInventoryForOrder } from './inventory-service.js';
import type { AppContext } from '../lib/context.js';

/**
 * COD completion (plan §53).
 *
 * The documented atomic sequence:
 *   1. validate driver           9.  finalize inventory consumption
 *   2. validate assignment       10. restaurant sales event
 *   3. validate state            11. commission accrual event
 *   4. validate PIN/override     12. driver cash custody event
 *   5. mark assignment delivered 13. status history
 *   6. mark order delivered      14. outbox events
 *   7. mark payment PAID_CASH    15. commit
 *   8. record COD cash
 *
 * "A duplicate network retry returns the original successful result and cannot
 * double-accrue commission or driver cash." That guarantee rests on three
 * database constraints, not on application checks alone:
 *   - ledger_entries.idempotency_key is unique
 *   - driver_cash_events has one ORDER_CASH_COLLECTED per order
 *   - the order row is locked FOR UPDATE for the whole transaction
 */

export interface ConfirmDeliveryInput {
  readonly assignmentId: string;
  readonly principal: Principal;
  readonly deliveryPin: string | null;
  readonly overrideReason: string | null;
  readonly idempotencyKey: string;
  readonly requestId: string;
}

export interface ConfirmDeliveryResult {
  readonly orderId: string;
  readonly orderStatus: string;
  readonly paymentStatus: string;
  readonly cashCollectedIqd: number;
  readonly replayed: boolean;
}

export async function confirmDelivery(
  ctx: AppContext,
  input: ConfirmDeliveryInput,
): Promise<ConfirmDeliveryResult> {
  return ctx.db.transaction(async (tx) => {
    // 2. The assignment, locked so two taps cannot both complete it.
    const [assignment] = await tx
      .select()
      .from(deliveryAssignments)
      .where(eq(deliveryAssignments.id, input.assignmentId))
      .for('update')
      .limit(1);

    if (!assignment) {
      throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'assignment' } });
    }

    // 1. The driver must own this assignment — a reassignment revokes the right
    //    immediately, even on a screen that is already open (plan §49).
    const isAdminOverride = input.overrideReason !== null;
    if (!isAdminOverride) {
      assertOwnsAssignment(input.principal, assignment.driverId);
    }

    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, assignment.orderId))
      .for('update')
      .limit(1);

    if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'order' } });

    // Idempotent replay: the work is already done, so report the original result.
    if (assignment.status === 'DELIVERED' && order.paymentStatus === 'PAID_CASH') {
      return {
        orderId: order.id,
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        cashCollectedIqd: order.customerTotalIqd,
        replayed: true,
      };
    }

    // 3. State must permit completion.
    assertTransition(
      DELIVERY_TRANSITIONS,
      {
        from: assignment.status,
        to: 'DELIVERED',
        actorType: isAdminOverride ? 'ADMIN' : 'DRIVER',
        reason: input.overrideReason,
      },
      ERROR_CODES.DELIVERY_CANNOT_TRANSITION,
    );

    // 4. PIN, or an audited override (plan §52).
    if (isAdminOverride) {
      const reason = assertOverrideAllowed(input.overrideReason);
      await writeAudit(tx, {
        actorUserId: input.principal.userId,
        action: AUDIT_ACTIONS.DELIVERY_PIN_OVERRIDE,
        entityType: 'order',
        entityId: order.id,
        reason,
        requestId: input.requestId,
        after: { assignmentId: assignment.id, driverId: assignment.driverId },
      });
    } else if (order.deliveryPinHash) {
      const verification = verifyDeliveryPin({
        submittedPin: input.deliveryPin ?? '',
        storedHash: order.deliveryPinHash,
        orderId: order.id,
        pepper: ctx.env.OTP_HASH_PEPPER,
        currentAttempts: order.deliveryPinAttempts,
      });

      await tx.insert(deliveryPinAttempts).values({
        id: uuidv7(),
        orderId: order.id,
        driverId: assignment.driverId,
        succeeded: verification.valid,
        attemptNumber: order.deliveryPinAttempts + 1,
      });

      if (!verification.valid) {
        await tx
          .update(orders)
          .set({ deliveryPinAttempts: sql`${orders.deliveryPinAttempts} + 1` })
          .where(eq(orders.id, order.id));

        // The PIN itself is never logged (plan §52).
        throw new AppError(ERROR_CODES.DELIVERY_PIN_INVALID, {
          details: { attemptsRemaining: verification.attemptsRemaining },
        });
      }
    }

    const now = new Date();

    // 5. Assignment delivered.
    await tx
      .update(deliveryAssignments)
      .set({
        status: 'DELIVERED',
        deliveredAt: now,
        version: sql`${deliveryAssignments.version} + 1`,
        updatedAt: now,
      })
      .where(eq(deliveryAssignments.id, assignment.id));

    // 6 & 7. Order delivered, completed, and paid in cash — in one write, so
    // the DB check constraint linking COMPLETED to PAID_CASH always holds.
    await tx
      .update(orders)
      .set({
        status: 'COMPLETED',
        paymentStatus: 'PAID_CASH',
        deliveredAt: now,
        completedAt: now,
        version: sql`${orders.version} + 1`,
        updatedAt: now,
      })
      .where(eq(orders.id, order.id));

    // 9. Finalise any inventory still merely reserved. One shared
    //    implementation, so placement, release and consumption can never drift
    //    apart in how they move the reserved and on-hand columns.
    await consumeInventoryForOrder(tx, order.id);

    // 11. Commission accrual. The idempotency key is the order, so a retry
    //     collides with the unique index rather than accruing a second time.
    await appendLedgerEntry(tx, {
      restaurantId: order.restaurantId,
      orderId: order.id,
      entryType: 'COMMISSION_ACCRUED',
      amountIqd: order.commissionAmountIqd,
      effectiveAt: now,
      idempotencyKey: `commission:${order.id}`,
      metadata: {
        commissionBaseIqd: order.commissionBaseIqd,
        commissionFlatIqdSnapshot: order.commissionFlatIqdSnapshot,
      },
    });

    // 10. Platform service fee revenue, tracked separately from what the
    //     restaurant owes (plan §39).
    if (order.platformServiceFeeIqd > 0) {
      await appendLedgerEntry(tx, {
        restaurantId: order.restaurantId,
        orderId: order.id,
        entryType: 'SERVICE_FEE_REVENUE',
        amountIqd: order.platformServiceFeeIqd,
        effectiveAt: now,
        idempotencyKey: `service_fee:${order.id}`,
      });
    }

    // 12. Driver cash custody — restaurant cash, not a Jibli payment (plan §54).
    await tx.insert(driverCashEvents).values({
      id: uuidv7(),
      driverId: assignment.driverId,
      restaurantId: order.restaurantId,
      type: 'ORDER_CASH_COLLECTED',
      amountIqd: order.customerTotalIqd,
      orderId: order.id,
      actorUserId: input.principal.userId,
      idempotencyKey: `cod:${order.id}`,
    });

    // The driver is free for the next task.
    await tx
      .update(drivers)
      .set({ availability: 'AVAILABLE', updatedAt: now })
      .where(eq(drivers.id, assignment.driverId));

    // 13. Status history for both transitions.
    await tx.insert(orderStatusHistory).values([
      {
        id: uuidv7(),
        orderId: order.id,
        fromStatus: order.status,
        toStatus: 'DELIVERED',
        actorType: isAdminOverride ? 'ADMIN' : 'DRIVER',
        actorUserId: input.principal.userId,
        reason: input.overrideReason,
      },
      {
        id: uuidv7(),
        orderId: order.id,
        fromStatus: 'DELIVERED',
        toStatus: 'COMPLETED',
        actorType: 'SYSTEM',
        actorUserId: null,
      },
    ]);

    // 14. Outbox events, in the same transaction.
    await enqueueOutboxEvent(tx, {
      eventType: EVENT_TYPES.ORDER_COMPLETED,
      aggregateType: 'order',
      aggregateId: order.id,
      aggregateVersion: order.version + 1,
      requestId: input.requestId,
      payload: {
        orderId: order.id,
        publicOrderNumber: order.publicOrderNumber,
        restaurantId: order.restaurantId,
        branchId: order.branchId,
        customerId: order.userId,
        status: 'COMPLETED',
        customerTotalIqd: order.customerTotalIqd,
        itemCount: 0,
        customerFirstName: order.customerNameSnapshot.split(' ')[0] ?? '',
      },
    });

    ctx.logger.info(
      {
        event: 'delivery.completed',
        orderId: order.id,
        driverId: assignment.driverId,
        requestId: input.requestId,
      },
      'COD delivery completed',
    );

    // 15. Commit happens when this callback returns.
    return {
      orderId: order.id,
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID_CASH',
      cashCollectedIqd: order.customerTotalIqd,
      replayed: false,
    };
  });
}
