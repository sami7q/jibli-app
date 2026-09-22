import { lt } from 'drizzle-orm';
import { auditLogs, loginAttempts, otpChallenges } from '@jibli/db';
import type { WorkerContext } from '../context.js';
import { withJobLock } from './job-lock.js';

/**
 * Data retention.
 *
 * Three tables accumulate personal data as a by-product of running the
 * platform, and nothing ever removed a row from any of them. `otp_challenges`
 * holds a phone number for every sign-in attempt anybody has ever made;
 * `login_attempts` holds an identifier and an IP for every one that failed;
 * `audit_logs` holds who did what, including the phone number of a customer who
 * asked to be deleted.
 *
 * Keeping all of it forever is not a security posture, it is an absence of one.
 * Both stores' data-safety forms ask how long data is kept, and "indefinitely,
 * because nobody wrote the job" is an answer that has to be given honestly if it
 * is the true one.
 *
 * **The periods are a business decision, not a technical one.** Plan §164 is
 * explicit that retention "must be reviewed with Iraqi legal/accounting
 * advice". These are the operator's chosen values, held in the environment so
 * that advice can change them without a release:
 *
 *   audit logs      365 days — a full accounting cycle
 *   login attempts   90 days — long enough to investigate an incident
 *   OTP challenges    7 days — they expire in minutes; a week is generous
 *
 * Deletes rather than anonymises, deliberately. An audit row stripped of its
 * actor is not a safer record, it is a useless one taking up space — and the
 * financial history these rows describe lives in `orders` and `ledger_entries`,
 * which this job does not touch and must never touch.
 */

export interface RetentionSummary {
  readonly auditLogs: number;
  readonly loginAttempts: number;
  readonly otpChallenges: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runRetentionSweep(
  ctx: WorkerContext,
  options: { now?: Date } = {},
): Promise<RetentionSummary | null> {
  const now = options.now ?? new Date();

  const cutoffs = {
    auditLogs: new Date(now.getTime() - ctx.env.RETENTION_AUDIT_LOG_DAYS * DAY_MS),
    loginAttempts: new Date(now.getTime() - ctx.env.RETENTION_LOGIN_ATTEMPT_DAYS * DAY_MS),
    otpChallenges: new Date(now.getTime() - ctx.env.RETENTION_OTP_CHALLENGE_DAYS * DAY_MS),
  };

  let summary: RetentionSummary = { auditLogs: 0, loginAttempts: 0, otpChallenges: 0 };

  const ran = await withJobLock(ctx, 'retention_sweep', 60 * 60 * 1000, async () => {
    /*
     * Three separate statements rather than one transaction.
     *
     * A retention sweep is not atomic in any meaningful sense — deleting old
     * OTP rows has nothing to do with deleting old audit rows — and wrapping
     * them together would hold locks on three busy tables at once for no
     * benefit. If one fails the others have still done useful work and the next
     * run picks up what was missed.
     */
    const audit = await ctx.db
      .delete(auditLogs)
      .where(lt(auditLogs.createdAt, cutoffs.auditLogs))
      .returning({ id: auditLogs.id });

    const logins = await ctx.db
      .delete(loginAttempts)
      .where(lt(loginAttempts.createdAt, cutoffs.loginAttempts))
      .returning({ id: loginAttempts.id });

    const otps = await ctx.db
      .delete(otpChallenges)
      .where(lt(otpChallenges.createdAt, cutoffs.otpChallenges))
      .returning({ id: otpChallenges.id });

    summary = {
      auditLogs: audit.length,
      loginAttempts: logins.length,
      otpChallenges: otps.length,
    };

    const total = audit.length + logins.length + otps.length;
    if (total > 0) {
      ctx.logger.info(
        {
          event: 'retention.swept',
          ...summary,
          auditLogDays: ctx.env.RETENTION_AUDIT_LOG_DAYS,
          loginAttemptDays: ctx.env.RETENTION_LOGIN_ATTEMPT_DAYS,
          otpChallengeDays: ctx.env.RETENTION_OTP_CHALLENGE_DAYS,
        },
        `Retention sweep removed ${total} rows`,
      );
    }
  });

  return ran ? summary : null;
}
