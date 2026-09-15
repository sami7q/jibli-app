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

/*
 * Added to Expo's own list, not substituted for it.
 *
 * `getDefaultConfig` sets watch folders of its own from SDK 54 onward, and
 * assigning over them drops whatever it needed watched — `expo-doctor` flags
 * exactly this. The root still has to be here for the pnpm store and the
 * workspace symlinks.
 */
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/** Extensions a `.js` specifier may actually be on disk, in order. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * One React, always.
 *
 * The repository no longer runs two React majors — SDK 54 brought the app to
 * React 19, which is what the web portals were already on — so the specific
 * failure this was written for is gone: a React 19 `jsx-runtime` beside React
 * 18's renderer threw "Objects are not valid as a React child", because the
 * two majors stamp elements with different symbols.
 *
 * It stays because the hazard is pnpm's, not the version split's. pnpm
 * resolves a package's `react` from whichever importer pulled it, so a
 * transitive dependency can hold a *second copy* of the same version — and two
 * copies of React 19 break hooks exactly as thoroughly as one copy each of 18
 * and 19, with "Invalid hook call" instead.
 *
 * Pinning the whole family to the app's own copies makes both unrepresentable
 * rather than unlikely.
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
