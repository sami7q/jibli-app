/**
 * Signing in again without retyping a generated password.
 *
 * Portal passwords are generated rather than chosen — five groups of four
 * characters — which is right for entropy and miserable to type twenty times a
 * day while testing a deploy. This binds the sign-in form to the browser's own
 * credential store: the browser keeps the password where it keeps every other
 * saved password, scoped to this origin and protected by the operating system,
 * and hands it back when asked.
 *
 * Deliberately *not* a password compiled into the bundle behind an environment
 * variable. Anything the page can read at load, so can anyone who opens
 * `/login`, and a sign-in shortcut that ships the admin password to every
 * visitor is not a shortcut.
 *
 * The reason this is needed at all: the form posts with `fetch` and then
 * navigates client-side, which Chrome does not recognise as a form submission,
 * so it never offers to save the password and its own autofill has nothing to
 * fill from. `rememberCredentials` tells it explicitly.
 */

export interface QuickLoginCredentials {
  readonly username: string;
  readonly password: string;
}

/**
 * `PasswordCredential` is Chromium-only and absent from TypeScript's DOM
 * library, so the shape is declared here rather than pulled in with `any`.
 */
interface PasswordCredentialLike {
  readonly id: string;
  readonly password?: string | null;
}

interface PasswordCredentialConstructor {
  new (data: { id: string; password: string; name?: string }): PasswordCredentialLike;
}

interface CredentialsApi {
  get(options: { password: true; mediation: CredentialMediation }): Promise<unknown>;
  store(credential: PasswordCredentialLike): Promise<unknown>;
  preventSilentAccess?(): Promise<void>;
}

/** The globals the API lives on. Injectable so this is testable without a DOM. */
export interface QuickLoginScope {
  isSecureContext?: boolean;
  PasswordCredential?: PasswordCredentialConstructor;
  navigator?: { credentials?: CredentialsApi };
}

/**
 * `silent` returns a credential only when the browser can choose without
 * asking; `optional` shows the account picker.
 */
export type CredentialMediation = 'silent' | 'optional';

const defaultScope = (): QuickLoginScope => globalThis as unknown as QuickLoginScope;

/**
 * Whether this browser can store and return a password for us.
 *
 * Requires a secure context, which `localhost` counts as — so this works the
 * same in development as on the deployed portal, with separate credentials per
 * origin, which is what you want.
 */
export function quickLoginSupported(scope: QuickLoginScope = defaultScope()): boolean {
  return Boolean(
    scope &&
      scope.isSecureContext &&
      typeof scope.PasswordCredential === 'function' &&
      scope.navigator?.credentials,
  );
}

/**
 * Hand the browser a password to save. Never throws.
 *
 * A failure here costs the convenience and nothing else, so it must not be
 * able to turn a successful sign-in into an error on screen.
 */
export async function rememberCredentials(
  credentials: QuickLoginCredentials & { readonly displayName?: string },
  scope: QuickLoginScope = defaultScope(),
): Promise<boolean> {
  if (!quickLoginSupported(scope)) return false;

  try {
    const Constructor = scope.PasswordCredential as PasswordCredentialConstructor;
    await scope.navigator!.credentials!.store(
      new Constructor({
        id: credentials.username,
        password: credentials.password,
        ...(credentials.displayName ? { name: credentials.displayName } : {}),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the browser for a saved password. Never throws; null means "nothing to
 * offer", which is the ordinary answer before the first successful sign-in.
 */
export async function recallCredentials(
  mediation: CredentialMediation,
  scope: QuickLoginScope = defaultScope(),
): Promise<QuickLoginCredentials | null> {
  if (!quickLoginSupported(scope)) return null;

  try {
    const credential = (await scope.navigator!.credentials!.get({
      password: true,
      mediation,
    })) as PasswordCredentialLike | null;

    // A credential with no password is one of the other credential types the
    // browser may hand back; it is no use for signing in with a password.
    if (!credential?.id || !credential.password) return null;

    return { username: credential.id, password: credential.password };
  } catch {
    return null;
  }
}

/**
 * Stop the browser signing in silently next time.
 *
 * Called on sign-out: someone who signs out on a shared machine has said they
 * are done, and a stored credential that fills itself in afterwards quietly
 * undoes that.
 */
export async function forgetQuickLogin(scope: QuickLoginScope = defaultScope()): Promise<void> {
  if (!quickLoginSupported(scope)) return;
  try {
    await scope.navigator!.credentials!.preventSilentAccess?.();
  } catch {
    // Nothing to do: the next sign-in simply shows the picker.
  }
}
