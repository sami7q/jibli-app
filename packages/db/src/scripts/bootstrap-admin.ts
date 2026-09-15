import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  checkPasswordPolicy,
  generatePortalPassword,
  hashPassword,
} from '@jibli/auth';
import { normalizeUsername, toE164Iraq } from '@jibli/validation';
import { createDatabase } from '../client.js';
import { shouldUseSsl } from '../ssl.js';
import { users, userPlatformRoles } from '../schema/index.js';
import { uuidv7 } from '../ids.js';

/**
 * Create the first Super Admin.
 *
 * A freshly migrated database has geography and configuration but no humans in
 * it, so nobody can sign into the Admin Portal — and platform roles can only be
 * granted from inside that portal. This breaks that circle exactly once.
 *
 * Usage:
 *   pnpm --filter @jibli/db bootstrap-admin --  *     --username sami --name "اسم المدير" [--phone 07701234567]
 *
 * The password is generated and printed once. It is never stored in plaintext,
 * and the account is flagged must_change_password: a bootstrap password is read
 * off a terminal and lands in shell history, so it is treated as exposed from
 * the moment it exists.
 */

interface Args {
  username: string;
  name: string;
  phone?: string;
  password?: string;
  /** Skip the forced change at first sign-in. Off unless asked for. */
  keepPassword: boolean;
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
        ' [--phone <iraqi mobile>] [--password <password>] [--keep-password]',
    );
    process.exit(1);
  }

  const password = get('--password');

  /*
   * `--keep-password` exists for the one case the default gets wrong: an
   * operator setting a password for their own account, which nobody else ever
   * saw. The default stays on, because a password handed to someone is a
   * password someone else knows.
   */
  const keepPassword = argv.includes('--keep-password');
  const phone = get('--phone');
  return {
    username: normalizeUsername(username),
    keepPassword,
    name,
    ...(phone ? { phone } : {}),
    ...(password ? { password } : {}),
  };
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

  const password =
    args.password ??
    generatePortalPassword({ minLength: ADMIN_PASSWORD_MIN_LENGTH, username: args.username });
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
            username: args.username,
            status: 'ACTIVE',
            mustChangePassword: !args.keepPassword,
            passwordChangedAt: new Date(),
            // A reset is also the way out of a lockout.
            failedLoginCount: 0,
            lockedUntil: null,
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
          /*
           * A bootstrap password is read off a terminal, lands in shell
           * history, and is usually pasted somewhere to be handed over. Treat
           * it as already exposed and require replacement at first sign-in.
           */
          mustChangePassword: !args.keepPassword,
          // Staff are trusted at creation: there is no OTP step for a portal
          // account.
          ...(phoneE164 ? { phoneVerifiedAt: new Date() } : {}),
          /*
           * Deliberately NOT setting profile_completed_at.
           *
           * It is a customer-flow marker, and users_profile_geography_complete
           * requires a completed profile to carry a governorate and a city —
           * a discovery geography a portal account has no reason to hold. The
           * flag is only ever read when placing an order, which a portal
           * account never does (plan §11).
           */
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
    console.log(
      `  role      ${result.roleGranted ? 'SUPER_ADMIN granted' : 'SUPER_ADMIN already held'}`,
    );

    if (!args.password) {
      console.log('');
      console.log(`  password  ${password}`);
      console.log('');
      console.log('  This is shown once and is not stored anywhere in plaintext.');
    }

    console.log('');
    console.log('  Next, in order:');
    /*
     * `--keep-password` turns the forced change off, and this line was
     * announcing it anyway. A script that tells you what is about to happen
     * and is wrong about it is worse than one that says nothing: the next
     * person reads it, waits for a prompt that never comes, and stops
     * believing the rest of the output.
     */
    console.log(
      args.keepPassword
        ? '    1. Sign in — this password stands until you change it yourself'
        : '    1. Sign in — you will be required to change this password',
    );
    console.log('    2. Enrol MFA. Plan §88 blocks every finance action until you do');
    console.log('');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('bootstrap-admin failed:', error);
  process.exit(1);
});
