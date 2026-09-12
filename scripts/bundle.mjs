import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

/**
 * Bundle a service into one runnable file.
 *
 * The output is `.mjs`, not `.js`, and that matters. The bundle is ESM, and
 * Node decides how to parse a `.js` file by walking up for the nearest
 * package.json `type` field. Under apps/api that says "module" and it works;
 * copied into a container at /app/build/api it finds nothing, defaults to
 * CommonJS, and dies on the first import — a failure that cannot be reproduced
 * by running the bundle where it was built.
 *
 * `tsc -b` alone does not produce something Node can run here: the emitted
 * `dist/index.js` still imports `@jibli/db`, whose package `main` points at
 * TypeScript source. Node then fails with ERR_UNKNOWN_FILE_EXTENSION on the
 * first import — the production build was type-checked but never executable.
 *
 * Bundling resolves every workspace import at build time, so the container
 * ships one file with no node_modules for the workspace packages, starts
 * faster, and cannot drift from a half-built sibling package.
 *
 */

/*
 * Only what genuinely cannot be inlined.
 *
 * Everything else is bundled on purpose. pnpm's isolated linker puts a
 * transitive dependency like `postgres` under the package that declares it, so
 * a bundle that leaves it external cannot resolve it from the service's own
 * build directory — the failure appears at boot, not at build.
 */
const EXTERNAL = [
  // Native addon: a compiled .node binary, not JavaScript.
  '@node-rs/argon2',
  '@node-rs/argon2-win32-x64-msvc',
  '@node-rs/argon2-linux-x64-gnu',
  '@node-rs/argon2-linux-arm64-gnu',
  '@node-rs/argon2-linux-x64-musl',
  '@node-rs/argon2-darwin-arm64',
  // Development-only log transport. It spawns a worker thread that loads itself
  // by module name, which a bundle cannot satisfy. Production logs are JSON.
  'pino-pretty',
];


const target = process.argv[2];
if (!target || !['api', 'worker'].includes(target)) {
  console.error('Usage: node scripts/bundle.mjs <api|worker>');
  process.exit(1);
}

const outdir = `apps/${target}/build`;
await rm(outdir, { recursive: true, force: true });

const result = await build({
  entryPoints: [`apps/${target}/src/index.ts`],
  outfile: `${outdir}/index.mjs`,
  bundle: true,
  platform: 'node',
  // Matches the engines field and the container's Node version.
  target: 'node20',
  format: 'esm',
  // A stack trace from production must point at real source lines.
  sourcemap: true,
  minify: false,
  external: EXTERNAL,
  /*
   * The workspace packages are ESM-only and written with `.js` specifiers that
   * refer to TypeScript files, the same mismatch the Next config had to solve.
   */
  resolveExtensions: ['.ts', '.tsx', '.mjs', '.js', '.json'],
  logLevel: 'info',
  metafile: true,
  banner: {
    // The bundle is ESM but some CommonJS dependencies expect these to exist.
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
});

const bytes = Object.values(result.metafile.outputs).reduce(
  (total, output) => total + output.bytes,
  0,
);
console.log(`\n${target}: ${(bytes / 1024).toFixed(0)} kB → ${outdir}/index.mjs`);
