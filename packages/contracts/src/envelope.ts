import { AppError, ERROR_CODES, type ErrorCode } from './errors.js';

/**
 * API response envelopes (plan §66).
 *
 *   success: { "data": {}, "meta": {} }
 *   error:   { "error": { code, message, details, request_id } }
 */

export interface ResponseMeta {
  readonly request_id?: string;
  readonly cursor?: string | null;
  readonly has_more?: boolean;
  readonly total?: number;
  readonly page?: number;
  readonly page_size?: number;
  readonly [key: string]: unknown;
}

export interface SuccessEnvelope<T> {
  readonly data: T;
  readonly meta: ResponseMeta;
}

export interface ErrorEnvelope {
  readonly error: {
    readonly code: ErrorCode;
    /** Arabic, human-facing. */
    readonly message: string;
    readonly details: Record<string, unknown>;
    readonly request_id: string;
  };
}

export function success<T>(data: T, meta: ResponseMeta = {}): SuccessEnvelope<T> {
  return { data, meta };
}

export function paginated<T>(
  items: T[],
  meta: { cursor?: string | null; hasMore: boolean; requestId?: string },
): SuccessEnvelope<T[]> {
  return {
    data: items,
    meta: {
      cursor: meta.cursor ?? null,
      has_more: meta.hasMore,
      ...(meta.requestId ? { request_id: meta.requestId } : {}),
    },
  };
}

/**
 * Render any thrown value as an error envelope.
 *
 * Unknown errors collapse to INTERNAL_ERROR with no detail: an unexpected
 * exception must never leak a stack trace, SQL fragment or internal identifier
 * to a client (plan §89).
 */
export function toErrorEnvelope(error: unknown, requestId: string): ErrorEnvelope {
  if (AppError.is(error)) {
    return {
      error: {
        code: error.code,
        message: error.messageAr,
        details: error.details as Record<string, unknown>,
        request_id: requestId,
      },
    };
  }
  const internal = new AppError(ERROR_CODES.INTERNAL_ERROR, { cause: error });
  return {
    error: {
      code: internal.code,
      message: internal.messageAr,
      details: {},
      request_id: requestId,
    },
  };
}

/** Field-level validation detail, shaped so forms can highlight the right input. */
export interface FieldIssue {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export function validationError(issues: FieldIssue[]): AppError {
  return new AppError(ERROR_CODES.VALIDATION_FAILED, { details: { issues } });
}
