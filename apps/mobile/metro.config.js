const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro configuration.
 *
 * Two things the defaults cannot know about this repository.
 *
 * **It is a pnpm monorepo.** The app's dependencies live in a virtual store at
 * the workspace root, and its workspace packages are symlinked source, not
 * published builds. Metro has to watch the root and look for modules in both
 * places, or an edit to `@jibli/money` never reaches the app and half the
 * dependency tree is invisible.
 *
 * **The workspace packages are ESM TypeScript.** Their internal imports are
 * written as `./arabic.js` — the specifier that will exist once `tsc` emits —
 * while on disk the file is still `arabic.ts`. Webpack is told about this in
 * `config/next-portal.mjs` via `extensionAlias`; Metro has no such option, so
 * the same rule is expressed here as a resolver.
 *
 * Without it the bundle fails with "Unable to resolve ./arabic.js", which names
 * the specifier and not the cause, and every workspace package with more than
 * one file is unusable from the app.
 */

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/** Extensions a `.js` specifier may actually be on disk, in order. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const relative = moduleName.startsWith('.');

  if (relative && moduleName.endsWith('.js')) {
    const withoutExtension = moduleName.slice(0, -'.js'.length);

    for (const extension of SOURCE_EXTENSIONS) {
      try {
        return context.resolveRequest(context, withoutExtension + extension, platform);
      } catch {
        // Not this one. Fall through to the next, then to the literal
        // specifier — a real `.js` file on disk must still resolve.
      }
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
