import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  doublePrecision,
} from 'drizzle-orm/pg-core';
import type { DevicePlatform, PlatformRole, UserStatus } from '@jibli/contracts';
import { createdAt, deletedAt, fk, primaryId, updatedAt, utcTimestamp } from './_shared.js';
import { cities, governorates } from './geography.js';

/**
 * Identity, sessions and addresses (plan §10–§13).
 */

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    /**
     * Always E.164 when present. Null for a portal account created by staff
     * before anyone at the restaurant has been reached — a CHECK constraint
     * requires at least one of phone or username (migration 0005).
     */
    phoneE164: text('phone_e164'),
    /**
     * Portal login name. Lowercase ASCII, unique case-insensitively.
     * Customers and drivers authenticate by OTP and have none.
     */
    username: text('username'),
    phoneVerifiedAt: utcTimestamp('phone_verified_at'),
    fullName: text('full_name'),

    /**
     * Identity from a third-party provider (migration 0015).
     *
     * `googleSub` is Google's stable subject id, never the email — a Google
     * account can change its address, and matching on one would hand an
     * account to whoever claims the address next. The email is stored for
     * display and support, and is never used to deliver an OTP.
     *
     * Neither replaces the phone: an order needs a number a driver can call,
     * so `phoneVerifiedAt` still gates checkout.
     */
    email: text('email'),
    googleSub: text('google_sub'),

    /** Default discovery geography — NOT a delivery address (plan §12). */
    profileGovernorateId: fk('profile_governorate_id').references(() => governorates.id, {
      onDelete: 'restrict',
    }),
    profileCityId: fk('profile_city_id').references(() => cities.id, { onDelete: 'restrict' }),

    preferredLanguage: text('preferred_language').notNull().default('AR'),
    /** Set once the mandatory post-OTP flow completes (plan §11). */
    profileCompletedAt: utcTimestamp('profile_completed_at'),
    status: text('status').$type<UserStatus>().notNull().default('ACTIVE'),

    /** Web credentials for portal users. Customers and drivers authenticate by OTP only. */
    passwordHash: text('password_hash'),
    /** Set when staff issued the password, cleared once the owner replaces it. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    passwordChangedAt: utcTimestamp('password_changed_at'),
    /** Per-account lockout, which survives a restart unlike the Redis limiter. */
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: utcTimestamp('locked_until'),
    mfaSecretEncrypted: text('mfa_secret_encrypted'),
    mfaEnabledAt: utcTimestamp('mfa_enabled_at'),
    /** Highest TOTP counter already spent — blocks replay inside one window. */
    mfaLastUsedCounter: bigint('mfa_last_used_counter', { mode: 'number' }),
    /** Enrolment is two-phase: pending until a code proves the app holds it. */
    mfaPendingSecretEncrypted: text('mfa_pending_secret_encrypted'),
    mfaPendingStartedAt: utcTimestamp('mfa_pending_started_at'),

    lastLoginAt: utcTimestamp('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    // One identity per phone. A customer who later becomes a driver reuses it (plan §45).
    uniqueIndex('users_phone_key').on(table.phoneE164),
    // Case-insensitive in the database (migration 0005 indexes lower(username)).
    uniqueIndex('users_username_key').on(table.username),
    // Partial in the database (migration 0015): null for every phone-only
    // customer, and a plain unique index would allow exactly one of them.
    uniqueIndex('users_google_sub_key').on(table.googleSub),
    index('users_status_idx').on(table.status),
    index('users_profile_city_idx').on(table.profileCityId),
  ],
);

/** Platform staff roles (plan §62). Restaurant roles live in restaurant_members. */
export const userPlatformRoles = pgTable(
  'user_platform_roles',
  {
    id: primaryId(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<PlatformRole>().notNull(),
    grantedBy: fk('granted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    revokedAt: utcTimestamp('revoked_at'),
  },
  (table) => [
    uniqueIndex('user_platform_roles_unique').on(table.userId, table.role),
    index('user_platform_roles_user_idx').on(table.userId),
  ],
);

/**
 * OTP challenges (plan §10, §78).
 *
 * Only a hash is stored. "Do not log OTP values. Do not persist OTP values on
 * the device" — and the server keeps no reversible copy either.
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: primaryId(),
    phoneE164: text('phone_e164').notNull(),
    /** HMAC-SHA256 of the code with a server-side pepper. */
    codeHash: text('code_hash').notNull(),
    purpose: text('purpose').notNull().default('LOGIN'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    expiresAt: utcTimestamp('expires_at').notNull(),
    consumedAt: utcTimestamp('consumed_at'),
    /** Risk context for abuse analysis — never the code itself. */
    requestIp: text('request_ip'),
    requestUserAgent: text('request_user_agent'),
    createdAt: createdAt(),
  },
  (table) => [
    index('otp_challenges_phone_idx').on(table.phoneE164, table.createdAt),
    index('otp_challenges_expiry_idx').on(table.expiresAt),
  ],
);

/**
 * Sessions with refresh-token rotation (plan §77).
 * The refresh token is stored hashed so a database read cannot mint sessions.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    /** Rotation chain: each refresh supersedes the previous session row. */
    supersededBySessionId: fk('superseded_by_session_id'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    deviceId: text('device_id'),
    /** Timestamp of the last successful MFA challenge, for step-up checks (plan §88). */
    mfaVerifiedAt: utcTimestamp('mfa_verified_at'),
    expiresAt: utcTimestamp('expires_at').notNull(),
    revokedAt: utcTimestamp('revoked_at'),
    revokedReason: text('revoked_reason'),
    lastUsedAt: utcTimestamp('last_used_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('sessions_refresh_hash_key').on(table.refreshTokenHash),
    index('sessions_user_idx').on(table.userId, table.createdAt),
  ],
);

/**
 * Delivery addresses (plan §12, §13).
 *
 * Separate from profile geography: changing a profile city never rewrites these.
 */
export const userAddresses = pgTable(
  'user_addresses',
  {
    id: primaryId(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label'),
    governorateId: fk('governorate_id')
      .notNull()
      .references(() => governorates.id, { onDelete: 'restrict' }),
    cityId: fk('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    /** Iraqi addressing habits, not a Western postal model (plan §13). */
    districtText: text('district_text'),
    street: text('street'),
    building: text('building'),
    floor: text('floor'),
    landmark: text('landmark'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    deliveryNotes: text('delivery_notes'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('user_addresses_user_idx').on(table.userId),
    index('user_addresses_city_idx').on(table.cityId),
  ],
);

/** Push tokens (plan §56). Invalid provider tokens are disabled, not deleted. */
export const userDevices = pgTable(
  'user_devices',
  {
    id: primaryId(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<DevicePlatform>().notNull(),
    pushToken: text('push_token').notNull(),
    appVersion: text('app_version'),
    osVersion: text('os_version'),
    deviceModel: text('device_model'),
    lastSeenAt: utcTimestamp('last_seen_at'),
    revokedAt: utcTimestamp('revoked_at'),
    revokedReason: text('revoked_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('user_devices_token_key').on(table.pushToken),
    index('user_devices_user_idx').on(table.userId, table.revokedAt),
  ],
);

/**
 * Audit log (plan §64).
 *
 * before/after snapshots are redacted of secrets by the writer — never a place
 * for passwords, OTPs, tokens or delivery PINs.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    actorUserId: fk('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    reason: text('reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.entityType, table.entityId, table.createdAt),
    index('audit_logs_actor_idx').on(table.actorUserId, table.createdAt),
    index('audit_logs_action_idx').on(table.action, table.createdAt),
    // Unfiltered "newest activity" feed on the Admin home screen (migration 0004).
    index('audit_logs_recent_idx').on(table.createdAt),
  ],
);

export const usersRelations = relations(users, ({ many, one }) => ({
  addresses: many(userAddresses),
  devices: many(userDevices),
  sessions: many(sessions),
  platformRoles: many(userPlatformRoles),
  profileGovernorate: one(governorates, {
    fields: [users.profileGovernorateId],
    references: [governorates.id],
  }),
  profileCity: one(cities, { fields: [users.profileCityId], references: [cities.id] }),
}));

export const userAddressesRelations = relations(userAddresses, ({ one }) => ({
  user: one(users, { fields: [userAddresses.userId], references: [users.id] }),
  city: one(cities, { fields: [userAddresses.cityId], references: [cities.id] }),
  governorate: one(governorates, {
    fields: [userAddresses.governorateId],
    references: [governorates.id],
  }),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserAddressRow = typeof userAddresses.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type OtpChallengeRow = typeof otpChallenges.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;

/**
 * MFA recovery codes (plan §88).
 *
 * Generated at enrolment, shown once, stored only as a hash. Each is
 * single-use — consumption is a conditional UPDATE, so two concurrent
 * submissions cannot both spend the same code.
 */
export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: primaryId(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: utcTimestamp('used_at'),
    /** Recorded so an unexpected recovery use can be investigated. */
    usedIp: text('used_ip'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('mfa_recovery_codes_hash_key').on(table.codeHash),
    index('mfa_recovery_codes_user_idx').on(table.userId, table.usedAt),
  ],
);

/**
 * MFA attempt log.
 *
 * Backs the lockout counter. Kept in PostgreSQL rather than Redis because
 * locking an admin account is a security decision that must survive a cache
 * flush. The submitted code is never stored.
 */
export const mfaAttempts = pgTable(
  'mfa_attempts',
  {
    id: primaryId(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    succeeded: boolean('succeeded').notNull(),
    method: text('method').$type<'TOTP' | 'RECOVERY_CODE' | 'PASSWORD'>().notNull(),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (table) => [index('mfa_attempts_user_idx').on(table.userId, table.createdAt)],
);

export type MfaRecoveryCodeRow = typeof mfaRecoveryCodes.$inferSelect;
export type MfaAttemptRow = typeof mfaAttempts.$inferSelect;

/**
 * Every portal sign-in attempt (migration 0005).
 *
 * Kept apart from audit_logs because a failed login changes no entity and so
 * has nothing to audit — but it is exactly what answers "is someone spraying
 * passwords across our restaurant accounts". Different volume, different
 * retention, different question.
 *
 * The password never appears here in any form (plan §1512).
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: primaryId(),
    /** Null when the username matched nothing — the attempt still matters. */
    userId: fk('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** What was typed. Not a secret, and needed to spot a spray. */
    identifier: text('identifier').notNull(),
    succeeded: boolean('succeeded').notNull(),
    failureReason: text('failure_reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (table) => [
    index('login_attempts_user_idx').on(table.userId, table.createdAt),
    index('login_attempts_identifier_idx').on(table.identifier, table.createdAt),
    index('login_attempts_ip_idx').on(table.ip, table.createdAt),
  ],
);

export type LoginAttemptRow = typeof loginAttempts.$inferSelect;
