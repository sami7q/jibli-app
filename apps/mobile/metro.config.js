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

/**
 * One React, always.
 *
 * This monorepo runs two React majors on purpose: the web portals are React 19
 * (Next.js 15) and the app is React 18, because React Native 0.76 does not
 * support 19. pnpm resolves a package's `react` from whichever importer pulled
 * it, so a transitive dependency can quietly end up holding the *other* copy —
 * and it did: a React 19 `jsx-runtime` was in the bundle beside React 18's
 * renderer.
 *
 * That is not a version warning, it is a broken screen. React 19 stamps its
 * elements with `Symbol.for('react.transitional.element')` where 18 uses
 * `react.element`, so React 18's reconciler does not recognise them and throws
 * "Objects are not valid as a React child (found: object with keys {$$typeof,
 * type, key, props})" — an error that names nothing useful and renders nothing
 * at all.
 *
 * Pinning the whole React family to the app's own copies makes the mix
 * unrepresentable rather than unlikely.
 */
const REACT_SINGLETONS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  'react-is',
];

/** Resolved once at startup; a name the app does not have is simply skipped. */
const SINGLETON_PATHS = new Map(
  REACT_SINGLETONS.flatMap((name) => {
    try {
      return [[name, require.resolve(name, { paths: [projectRoot] })]];
    } catch {
      return [];
    }
  }),
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const singleton = SINGLETON_PATHS.get(moduleName);
  if (singleton) {
    return { type: 'sourceFile', filePath: singleton };
  }

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
