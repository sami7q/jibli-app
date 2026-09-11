import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ADMIN_PASSWORD_MIN_LENGTH, checkPasswordPolicy, hashPassword } from '@jibli/auth';
import { normalizeUsername, toE164Iraq } from '@jibli/validation';
import { createDatabase } from '../client.js';
import { shouldUseSsl } from '../ssl.js';
import { users, userPlatformRoles } from '../schema/index.js';
import { uuidv7 } from '../ids.js';

/**
 * Create the first Super Admin.
 *
 * A freshly migrated database has geography and configuration but no human in
 * it, so nobody can sign into the Admin Portal — and roles can only be granted
 * from inside that portal. This breaks that circle exactly once.
 *
 * Usage:
 *   pnpm --filter @jibli/db bootstrap-admin -- --phone 07701234567 --name "اسم المدير"
 *
 * The password is generated and printed once. It is never written to a log
 * file, never stored in plaintext, and the operator is expected to change it
 * and enrol MFA immediately (plan §88).
 */

interface Args {
  username: string;
  name: string;
  phone?: string;
  password?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const username = get('--username');
  const name = get('--name');

  if (!username || !name) {
    console.error(
      'Usage: bootstrap-admin --username <username> --name "<full name>"' +
        ' [--phone <iraqi mobile>] [--password <password>]',
    );
    process.exit(1);
  }

  const password = get('--password');
  const phone = get('--phone');
  return {
    username: normalizeUsername(username),
    name,
    ...(phone ? { phone } : {}),
    ...(password ? { password } : {}),
  };
}

/**
 * A generated passphrase.
 *
 * Base64url of 18 random bytes: 144 bits of entropy, no ambiguous characters to
 * mistype, and long enough to satisfy the portal password policy without the
 * operator having to think about it.
 */
function generatePassword(): string {
  return `Jibli-${randomBytes(18).toString('base64url')}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL must be set');
    process.exit(1);
  }

  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(args.username)) {
    console.error(
      `Not a valid username: ${args.username}` +
        ' (lowercase letters, digits, . _ - ; 3-32 chars; must start alphanumeric)',
    );
    process.exit(1);
  }

  // Optional: a Super Admin signs in by username. A phone is only useful if
  // they also use the mobile app.
  let phoneE164: string | null = null;
  if (args.phone) {
    try {
      phoneE164 = toE164Iraq(args.phone);
    } catch (error) {
      console.error(`Not a valid Iraqi mobile number: ${args.phone}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  const password = args.password ?? generatePassword();
  // Platform staff are held to the longer minimum (plan §1853).
  const policy = checkPasswordPolicy(password, {
    minLength: ADMIN_PASSWORD_MIN_LENGTH,
    username: args.username,
  });
  if (!policy.ok) {
    console.error(`Password rejected: ${policy.problems.join(', ')}`);
    process.exit(1);
  }

  const { db, sql: client } = createDatabase({
    connectionString,
    maxConnections: 1,
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL),
  });

  try {
    const passwordHash = await hashPassword(password);

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(and(sql`lower(${users.username}) = ${args.username}`, isNull(users.deletedAt)))
        .limit(1);

      /*
       * Re-running this is a password reset for that number, not a duplicate
       * account. An operator who has lost access needs a way back in, and
       * failing here would leave them with no path that does not involve raw
       * SQL against production.
       */
      const userId = existing?.id ?? uuidv7();

      if (existing) {
        await tx
          .update(users)
          .set({
            passwordHash,
            fullName: existing.fullName ?? args.name,
            status: 'ACTIVE',
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      } else {
        await tx.insert(users).values({
          id: userId,
          username: args.username,
          phoneE164,
          fullName: args.name,
          passwordHash,
          passwordChangedAt: new Date(),
          // Staff are trusted at creation: there is no OTP step for a portal
          // account, and the profile-completion flow is a customer concern.
          ...(phoneE164 ? { phoneVerifiedAt: new Date() } : {}),
          profileCompletedAt: new Date(),
          status: 'ACTIVE',
        });
      }

      const [role] = await tx
        .select({ id: userPlatformRoles.id })
        .from(userPlatformRoles)
        .where(
          and(
            eq(userPlatformRoles.userId, userId),
            eq(userPlatformRoles.role, 'SUPER_ADMIN'),
            isNull(userPlatformRoles.revokedAt),
          ),
        )
        .limit(1);

      if (!role) {
        await tx.insert(userPlatformRoles).values({
          id: uuidv7(),
          userId,
          role: 'SUPER_ADMIN',
          grantedBy: null,
        });
      }

      return { userId, created: !existing, roleGranted: !role };
    });

    console.log('');
    console.log('  Super Admin ready');
    console.log('  ─────────────────────────────────────────────');
    console.log(`  username  ${args.username}`);
    if (phoneE164) console.log(`  phone     ${phoneE164}`);
    console.log(`  name      ${args.name}`);
    console.log(`  user id   ${result.userId}`);
    console.log(`  action    ${result.created ? 'created' : 'password reset on existing user'}`);
    console.log(`  role      ${result.roleGranted ? 'SUPER_ADMIN granted' : 'SUPER_ADMIN already held'}`);

    if (!args.password) {
      console.log('');
      console.log(`  password  ${password}`);
      console.log('');
      console.log('  This is shown once and is not stored anywhere in plaintext.');
    }

    console.log('');
    console.log('  Next: sign in to the Admin Portal, then enrol MFA from');
    console.log('  Settings → Two-factor authentication. Plan §88 requires it');
    console.log('  for Super Admin before any finance action.');
    console.log('');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('bootstrap-admin failed:', error);
  process.exit(1);
});
