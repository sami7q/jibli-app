import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  AppError,
  ERROR_CODES,
  toErrorEnvelope,
  validationError,
  type FieldIssue,
} from '@jibli/contracts';

/**
 * Central error handling (plan §66, §76, §89).
 *
 * Every failure leaves through here so responses share one shape and an
 * unexpected exception can never leak a stack trace, SQL fragment or internal
 * identifier to a client.
 */

function zodToFieldIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    code: issue.code,
    message: issue.message,
  }));
}

/** PostgreSQL SQLSTATEs worth translating into a business error. */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

/**
 * The SQLSTATE and constraint from a thrown database error.
 *
 * drizzle-orm 0.45 wraps the postgres driver's error in a `DrizzleQueryError`
 * and carries the real error under `.cause`, so reading `.code` off the thrown
 * object alone finds nothing and every unique/FK/check violation became a 500
 * (MERCH-5 / FLOW-6). This walks the cause chain to the row that actually
 * carries the SQLSTATE.
 */
export function pgErrorInfo(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      const constraint =
        (current as { constraint_name?: unknown }).constraint_name ??
        (current as { constraint?: unknown }).constraint;
      return { code, constraint: typeof constraint === 'string' ? constraint : undefined };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return {};
}

function fromDatabaseError(error: unknown): AppError | null {
  const { code, constraint } = pgErrorInfo(error);
  if (code === undefined) return null;
  const constraintName = constraint;

  switch (code) {
    case PG_UNIQUE_VIOLATION:
      // A unique index firing is usually a race that the application already has
      // a business meaning for; name the constraint so support can trace it.
      return new AppError(ERROR_CODES.CONFLICT, {
        details: constraintName ? { constraint: constraintName } : {},
        cause: error,
      });
    case PG_FOREIGN_KEY_VIOLATION:
      return new AppError(ERROR_CODES.VALIDATION_FAILED, {
        details: {
          reason: 'REFERENCED_ENTITY_MISSING',
          ...(constraintName ? { constraint: constraintName } : {}),
        },
        cause: error,
      });
    case PG_CHECK_VIOLATION:
      return new AppError(ERROR_CODES.VALIDATION_FAILED, {
        details: {
          reason: 'CHECK_CONSTRAINT_FAILED',
          ...(constraintName ? { constraint: constraintName } : {}),
        },
        cause: error,
      });
    default:
      return null;
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.requestId ?? 'unknown';

    // Schema validation — the client can fix this, so say exactly what is wrong.
    if (error instanceof ZodError) {
      const appError = validationError(zodToFieldIssues(error));
      request.log.info(
        { event: 'request.validation_failed', requestId, issues: error.issues.length },
        'Request failed validation',
      );
      return reply.status(appError.httpStatus).send(toErrorEnvelope(appError, requestId));
    }

    if (AppError.is(error)) {
      // Expected business outcomes are logged at info; they are not incidents
      // and must not page anyone (plan §91).
      const level = error.expected ? 'info' : 'error';
      request.log[level](
        { event: 'request.app_error', requestId, code: error.code, details: error.details },
        error.message,
      );
      return reply.status(error.httpStatus).send(toErrorEnvelope(error, requestId));
    }

    const dbError = fromDatabaseError(error);
    if (dbError) {
      request.log.warn(
        {
          event: 'request.database_error',
          requestId,
          code: dbError.code,
          details: dbError.details,
        },
        'Database constraint rejected the request',
      );
      return reply.status(dbError.httpStatus).send(toErrorEnvelope(dbError, requestId));
    }

    // Fastify's own errors (body too large, malformed JSON, rate limit).
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === 'number' && statusCode < 500) {
      const mapped =
        statusCode === 429
          ? new AppError(ERROR_CODES.RATE_LIMITED)
          : statusCode === 413
            ? new AppError(ERROR_CODES.FILE_TOO_LARGE)
            : new AppError(ERROR_CODES.VALIDATION_FAILED);
      return reply.status(mapped.httpStatus).send(toErrorEnvelope(mapped, requestId));
    }

    // Anything else is a genuine defect. Log it fully, tell the client nothing.
    request.log.error(
      {
        event: 'request.unhandled_error',
        requestId,
        err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'Unhandled error',
    );
    return reply.status(500).send(toErrorEnvelope(error, requestId));
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const appError = new AppError(ERROR_CODES.NOT_FOUND, {
      details: { path: request.url, method: request.method },
    });
    return reply
      .status(appError.httpStatus)
      .send(toErrorEnvelope(appError, request.requestId ?? 'unknown'));
  });
}
