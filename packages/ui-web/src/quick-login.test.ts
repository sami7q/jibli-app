import { describe, expect, it, vi } from 'vitest';
import {
  forgetQuickLogin,
  quickLoginSupported,
  recallCredentials,
  rememberCredentials,
  type QuickLoginScope,
} from './quick-login.js';

/**
 * The whole point of this module is that it fails quietly. A browser that does
 * not implement the API, a user who declines the prompt, an insecure context —
 * each of those must cost the shortcut and never the sign-in, so every case
 * below is about what happens when it does *not* work.
 */

class FakePasswordCredential {
  readonly id: string;
  readonly password: string;
  readonly name?: string;

  constructor(data: { id: string; password: string; name?: string }) {
    this.id = data.id;
    this.password = data.password;
    if (data.name !== undefined) this.name = data.name;
  }
}

const workingScope = (overrides: Partial<QuickLoginScope> = {}) =>
  ({
    isSecureContext: true,
    PasswordCredential: FakePasswordCredential,
    navigator: {
      credentials: {
        get: vi.fn(async () => new FakePasswordCredential({ id: 'sami', password: 'secret' })),
        store: vi.fn(async () => undefined),
        preventSilentAccess: vi.fn(async () => undefined),
      },
    },
    ...overrides,
  }) as unknown as QuickLoginScope;

describe('quickLoginSupported()', () => {
  it('accepts a browser with the API in a secure context', () => {
    expect(quickLoginSupported(workingScope())).toBe(true);
  });

  it('refuses an insecure context, whatever the browser supports', () => {
    expect(quickLoginSupported(workingScope({ isSecureContext: false }))).toBe(false);
  });

  it('refuses a browser without PasswordCredential (Firefox, Safari)', () => {
    const scope = workingScope();
    delete (scope as { PasswordCredential?: unknown }).PasswordCredential;
    expect(quickLoginSupported(scope)).toBe(false);
  });

  it('refuses a server render, where there are no globals at all', () => {
    expect(quickLoginSupported({} as QuickLoginScope)).toBe(false);
  });
});

describe('rememberCredentials()', () => {
  it('hands the browser the username as the credential id', async () => {
    const scope = workingScope();
    expect(await rememberCredentials({ username: 'sami', password: 'pw' }, scope)).toBe(true);

    const store = scope.navigator!.credentials!.store as ReturnType<typeof vi.fn>;
    const [credential] = store.mock.calls[0] as [FakePasswordCredential];
    expect(credential.id).toBe('sami');
    expect(credential.password).toBe('pw');
  });

  it('passes a display name through when one is given', async () => {
    const scope = workingScope();
    await rememberCredentials({ username: 'sami', password: 'pw', displayName: 'سامي' }, scope);

    const store = scope.navigator!.credentials!.store as ReturnType<typeof vi.fn>;
    const [credential] = store.mock.calls[0] as [FakePasswordCredential];
    expect(credential.name).toBe('سامي');
  });

  it('reports failure rather than throwing when the browser refuses', async () => {
    const scope = workingScope();
    (scope.navigator!.credentials!.store as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('user declined'),
    );
    await expect(rememberCredentials({ username: 'a', password: 'b' }, scope)).resolves.toBe(false);
  });

  it('does nothing on a browser without the API', async () => {
    expect(await rememberCredentials({ username: 'a', password: 'b' }, {} as QuickLoginScope)).toBe(
      false,
    );
  });
});

describe('recallCredentials()', () => {
  it('returns what the browser stored', async () => {
    await expect(recallCredentials('optional', workingScope())).resolves.toEqual({
      username: 'sami',
      password: 'secret',
    });
  });

  it('asks with the mediation it was given', async () => {
    const scope = workingScope();
    await recallCredentials('silent', scope);
    expect(scope.navigator!.credentials!.get).toHaveBeenCalledWith({
      password: true,
      mediation: 'silent',
    });
  });

  it('returns null when there is nothing saved', async () => {
    const scope = workingScope();
    (scope.navigator!.credentials!.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(recallCredentials('silent', scope)).resolves.toBeNull();
  });

  it('returns null for a credential carrying no password', async () => {
    const scope = workingScope();
    (scope.navigator!.credentials!.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'sami',
      password: null,
    });
    await expect(recallCredentials('silent', scope)).resolves.toBeNull();
  });

  it('returns null rather than throwing when the browser rejects', async () => {
    const scope = workingScope();
    (scope.navigator!.credentials!.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('NotAllowedError'),
    );
    await expect(recallCredentials('optional', scope)).resolves.toBeNull();
  });
});

describe('forgetQuickLogin()', () => {
  it('tells the browser to stop signing in silently', async () => {
    const scope = workingScope();
    await forgetQuickLogin(scope);
    expect(scope.navigator!.credentials!.preventSilentAccess).toHaveBeenCalled();
  });

  it('survives a browser that has the API but not that method', async () => {
    const scope = workingScope();
    delete (scope.navigator!.credentials as { preventSilentAccess?: unknown }).preventSilentAccess;
    await expect(forgetQuickLogin(scope)).resolves.toBeUndefined();
  });
});
