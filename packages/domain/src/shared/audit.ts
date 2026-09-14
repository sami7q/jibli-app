import { auditLogs, uuidv7, type DbExecutor } from '@jibli/db';

/**
 * Audit logging (plan §64).
 *
 * "Never log passwords, OTPs, access tokens, refresh tokens, or delivery PIN
 * values." Redaction happens here rather than at each call site, so a new caller
 * cannot forget it.
 */

/** Keys scrubbed from before/after snapshots, matched case-insensitively. */
const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'password_hash',
  'otp',
  'otpcode',
  'codehash',
  'code_hash',
  'pin',
  'deliverypin',
  'delivery_pin',
  'deliverypinhash',
  'delivery_pin_hash',
  'token',
  'accesstoken',
  'refreshtoken',
  'refreshtokenhash',
  'refresh_token_hash',
  'secret',
  'mfasecret',
  'mfasecretencrypted',
  'mfa_secret_encrypted',
  'authorization',
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return SENSITIVE_KEYS.some((s) => normalized === s.replace(/[^a-z]/g, ''));
}

/** Deep-clone a snapshot with sensitive values replaced. */
export function redactSnapshot(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactSnapshot(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? '[REDACTED]' : redactSnapshot(inner, depth + 1);
  }
  return out;
}

export interface AuditEntry {
  readonly actorUserId: string | null;
  readonly actorRole?: string | null;
  /** Verb-noun, e.g. "geography.city.disable" or "finance.settlement.void". */
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
}

/**
 * Write an audit row.
 *
 * Takes the transaction so the audit entry commits or rolls back with the change
 * it describes. An audit log that records actions that did not happen is worse
 * than none.
 */
export async function writeAudit(tx: DbExecutor, entry: AuditEntry): Promise<string> {
  const id = uuidv7();
  await tx.insert(auditLogs).values({
    id,
    actorUserId: entry.actorUserId,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    beforeJson: entry.before === undefined ? null : (redactSnapshot(entry.before) as object),
    afterJson: entry.after === undefined ? null : (redactSnapshot(entry.after) as object),
    reason: entry.reason ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    requestId: entry.requestId ?? null,
  });
  return id;
}

/**
 * Actions the plan requires to be audited (plan §64). Naming them as constants
 * keeps the audit search filters in the Admin portal honest.
 */
export const AUDIT_ACTIONS = {
  GEOGRAPHY_GOVERNORATE_UPDATE: 'geography.governorate.update',
  GEOGRAPHY_CITY_UPDATE: 'geography.city.update',
  RESTAURANT_CREATE: 'restaurant.create',
  RESTAURANT_APPROVE: 'restaurant.approve',
  RESTAURANT_REJECT: 'restaurant.reject',
  RESTAURANT_REQUEST_INFO: 'restaurant.request_info',
  RESTAURANT_SUSPEND: 'restaurant.suspend',
  RESTAURANT_REACTIVATE: 'restaurant.reactivate',
  RESTAURANT_COMMISSION_UPDATE: 'restaurant.commission.update',
  RESTAURANT_LOCATION_CHANGE_APPROVE: 'restaurant.location_change.approve',
  ROLE_GRANT: 'roles.grant',
  ROLE_REVOKE: 'roles.revoke',
  STAFF_INVITE: 'staff.invite',
  STAFF_DEACTIVATE: 'staff.deactivate',
  SETTLEMENT_GENERATE: 'finance.settlement.generate',
  SETTLEMENT_ISSUE: 'finance.settlement.issue',
  SETTLEMENT_VOID: 'finance.settlement.void',
  SETTLEMENT_PAYMENT_RECORD: 'finance.payment.record',
  SETTLEMENT_ADJUSTMENT_CREATE: 'finance.adjustment.create',
  ORDER_OVERRIDE: 'order.override',
  DELIVERY_PIN_OVERRIDE: 'delivery.pin.override',
  DRIVER_CREATE: 'driver.create',
  DRIVER_ACTIVATE: 'driver.activate',
  DRIVER_SUSPEND: 'driver.suspend',
  CUSTOMER_BLOCK: 'customer.block',
  CUSTOMER_PHONE_UNMASK: 'customer.phone.unmask',
  CONFIG_UPDATE: 'config.update',
  INVENTORY_ADJUST: 'inventory.adjust',
  PORTAL_USER_CREATE: 'portal_user.create',
  PORTAL_USER_RESET_PASSWORD: 'portal_user.reset_password',
  PORTAL_USER_SUSPEND: 'portal_user.suspend',
  PORTAL_USER_REACTIVATE: 'portal_user.reactivate',
  PASSWORD_CHANGE: 'password.change',
  COUPON_CREATE: 'coupon.create',
  COUPON_UPDATE: 'coupon.update',
  SUPPORT_THREAD_RESOLVE: 'support.thread.resolve',
  CATEGORY_CREATE: 'category.create',
  CATEGORY_UPDATE: 'category.update',
  CATEGORY_DELETE: 'category.delete',
  BANNER_CREATE: 'banner.create',
  BANNER_UPDATE: 'banner.update',
  BANNER_DELETE: 'banner.delete',
  COMMISSION_COLLECT: 'finance.commission.collect',
  REVIEW_HIDE: 'review.hide',
  REVIEW_RESTORE: 'review.restore',
  EXPORT_CREATE: 'export.create',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
