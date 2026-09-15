import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Reading a `.env` file into the environment, for development only.
 *
 * The API has always read `process.env` and nothing else, which is right for
 * Render — the dashboard is the source of truth there and a file on disk would
 * be a second one. On a laptop it meant there was no way to configure the API
 * short of exporting a dozen variables into the shell before every run, so in
 * practice nobody did, and the API ran on defaults: `OTP_PROVIDER=console`, a
 * provider that logs that a code was issued and sends nothing.
 *
 * That is a quiet failure rather than a loud one. Sign-in *works* — the code is
 * generated, stored, hashed, rate-limited, and the screen advances to the
 * countdown — and no message ever arrives, with nothing in the logs to say why
 * because the console provider is behaving exactly as designed.
 *
 * No dependency: `dotenv` is four lines of parsing and one more thing to keep
 * current.
 */

export interface LoadDotEnvResult {
  /** The file read, or null when there was none. */
  readonly path: string | null;
  /** How many variables it set. Values already in the environment are kept. */
  readonly loaded: number;
}

/**
 * The nearest `.env`, looking up from the working directory.
 *
 * It used to resolve `.env` against the working directory and stop there,
 * which is correct for a single-package project and wrong for this one. Every
 * script here is run through pnpm — `pnpm db:migrate`, `pnpm dev:api` — and
 * pnpm runs a package's script with that package's own directory as the
 * working directory. So a command launched from the repository root, with the
 * repository's `.env` sitting right there, looked for `packages/db/.env`,
 * found nothing, and reported "DATABASE_URL must be set" — a message that
 * sends you to check the file rather than to notice that nothing read it.
 *
 * Walking up finds the one file that exists. It stops at the workspace root
 * rather than continuing to the filesystem root, so a stray `.env` in a home
 * directory can never be picked up by a project that has none.
 */
function findUpwards(filename: string): string | null {
  let directory = process.cwd();

  for (;;) {
    const candidate = join(directory, filename);
    if (existsSync(candidate)) return candidate;

    // The workspace root is the boundary: above it is somebody's home
    // directory, and whatever is there belongs to them, not to this project.
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return null;

    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * Fill absent variables from a `.env` file. Never overwrites.
 *
 * The precedence matters both ways round: a real environment always wins, so a
 * deployment cannot be altered by a file that shipped inside an image by
 * mistake, and `SMS_GATEWAY_API_KEY=… pnpm dev:api` still beats the file when a
 * second vendor is being tried.
 */
export function loadDotEnv(
  options: {
    /**
     * An explicit file. Absent means the nearest `.env` at or above the
     * working directory, stopping at the workspace root — see findUpwards.
     */
    readonly path?: string;
    /**
     * Refuse to read anything in production.
     *
     * Deliberately the default. A production process that silently picked up a
     * file would have two sources of truth and no way to tell which one a given
     * value came from — which is the problem this was meant to avoid, arriving
     * from the other direction.
     */
    readonly allowInProduction?: boolean;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): LoadDotEnvResult {
  const env = options.env ?? process.env;

  if (!options.allowInProduction && env.NODE_ENV === 'production') {
    return { path: null, loaded: 0 };
  }

  const path = options.path ? resolve(options.path) : findUpwards('.env');
  if (path === null || !existsSync(path)) return { path: null, loaded: 0 };

  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    // Unreadable is the same as absent: this is a convenience, and failing a
    // boot over it would be worse than the inconvenience it exists to remove.
    return { path: null, loaded: 0 };
  }

  let loaded = 0;

  for (const raw of contents.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (key === '') continue;

    let value = line.slice(separator + 1).trim();
    // Quotes are stripped, so a value with spaces or a `#` in it survives.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    if (env[key] === undefined) {
      env[key] = value;
      loaded += 1;
    }
  }

  return { path, loaded };
}
