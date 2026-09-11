import { AppError, type ErrorCode } from '@jibli/contracts';

/**
 * Assertions for domain errors.
 *
 * The pattern these replace appears in several suites:
 *
 *     try {
 *       doTheThing();
 *       expect.unreachable('should have thrown');
 *     } catch (error) {
 *       expect(AppError.hasCode(error, 'ITEM_UNAVAILABLE')).toBe(true);
 *     }
 *
 * Written by hand it has a failure mode that is easy to miss: forget the
 * `unreachable` line and the test passes when nothing throws at all. These
 * helpers make that impossible, and they return the error so a caller can go on
 * to assert on its details.
 *
 * They deliberately take no dependency on a test runner — no `expect`, no
 * `vitest` import — so they work anywhere and the package stays free of a
 * framework it does not need.
 */

export class AssertionFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionFailed';
  }
}

/**
 * Run `fn`, require it to throw an `AppError` carrying `code`, and return it.
 *
 * Accepts a sync throw or a rejected promise via {@link expectRejectsAppError}.
 */
export function expectAppError(fn: () => unknown, code: ErrorCode): AppError {
  let thrown: unknown;
  let threw = false;

  try {
    fn();
  } catch (error) {
    threw = true;
    thrown = error;
  }

  if (!threw) {
    throw new AssertionFailed(`expected ${code} to be thrown, but the call returned normally`);
  }

  return assertAppError(thrown, code);
}

/** The async form: awaits the promise and requires it to reject with `code`. */
export async function expectRejectsAppError(
  promise: Promise<unknown> | (() => Promise<unknown>),
  code: ErrorCode,
): Promise<AppError> {
  let thrown: unknown;
  let threw = false;

  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    threw = true;
    thrown = error;
  }

  if (!threw) {
    throw new AssertionFailed(`expected ${code} to be rejected with, but the promise resolved`);
  }

  return assertAppError(thrown, code);
}

function assertAppError(thrown: unknown, code: ErrorCode): AppError {
  if (!AppError.is(thrown)) {
    const described =
      thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
    throw new AssertionFailed(`expected an AppError with code ${code}, got ${described}`);
  }

  // Narrowed by AppError.is above; naming it keeps the narrowing across the
  // template literals, which `thrown` loses under noUncheckedIndexedAccess.
  const error: AppError = thrown;

  if (error.code !== code) {
    throw new AssertionFailed(
      `expected AppError code ${code}, got ${error.code} (${error.message})`,
    );
  }

  return error;
}
