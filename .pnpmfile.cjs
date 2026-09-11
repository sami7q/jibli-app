/**
 * pnpm install hooks.
 *
 * This monorepo deliberately runs two React major versions: the web portals are
 * React 19 (Next.js 15), while the mobile app is React 18 because React Native
 * 0.76 does not support 19. That is a normal state for a platform with both
 * surfaces, and neither app can simply move to match the other.
 *
 * The friction is type-level, not runtime. React 19's `ReactNode` admits
 * `bigint`, React 18's does not, so any dependency of the mobile app that
 * resolves the React 19 typings produces JSX that is "incompatible" with the
 * app's own React 18 typings — even though both would run identically.
 *
 * The React Native navigation stack is where this surfaces, so its `@types/react`
 * is pinned to the version the mobile app actually builds against.
 */

/** Packages in the mobile app's tree that must type against React 18. */
const REACT_18_CONSUMERS = [
  'expo-router',
  'react-helmet-async',
  '@react-navigation/native',
  '@react-navigation/native-stack',
  '@react-navigation/core',
  '@react-navigation/elements',
  '@react-navigation/routers',
  '@react-navigation/bottom-tabs',
  'react-native',
  'react-native-safe-area-context',
  'react-native-screens',
];

const REACT_18_TYPES = '18.3.31';

function readPackage(pkg) {
  if (REACT_18_CONSUMERS.includes(pkg.name)) {
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      if (pkg[field]?.['@types/react']) {
        pkg[field]['@types/react'] = REACT_18_TYPES;
      }
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
