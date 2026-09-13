/**
 * Babel configuration.
 *
 * Two things happen here, and the second one exists to undo a collision
 * between tools that were each doing something reasonable.
 *
 * `tsconfig.json` declares two path mappings: `@/*` for the app's own source,
 * and `react` pinned to this project's React 18 typings — without that pin the
 * navigation stack resolves the workspace's React 19 copy, whose `ReactNode`
 * admits `bigint`, and every screen is reported as having incompatible JSX.
 *
 * Expo's Metro reads the same `paths` and applies them to *runtime* resolution.
 * So `import ... from 'react'` resolved to `@types/react` — a package with no
 * JavaScript in it — and the bundle failed with "none of these files exist".
 * The app could not start, on any device, for a reason that no amount of
 * typechecking would ever surface.
 *
 * The fix is to give each tool one job: `tsconfig.json` describes types and
 * nothing else (`experiments.tsconfigPaths` is off in app.config.ts), and the
 * `@/` alias is rewritten here, before the bundler ever sees it.
 */
module.exports = function babelConfig(api) {
  // Expo's transformer calls this without an api object for expo-router's
  // virtual `require.context` module, so the cache hint is optional.
  api?.cache?.(true);

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          // Relative to this file, not to whatever directory Metro's
          // transformer happens to run in — which is not the app root.
          cwd: 'babelrc',
          alias: { '@': './src' },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
    ],
  };
};
