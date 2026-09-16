/**
 * Font files imported by path.
 *
 * `expo/types` declares the image extensions Metro understands and stops
 * there, so `import Cairo_400Regular from '…/Cairo_400Regular.ttf'` is a type
 * error even though Metro resolves it perfectly well. The five faces are
 * imported that way deliberately — see the note in `app/_layout.tsx` — so the
 * declaration belongs here rather than the import being bent back through the
 * package index that bundles three fonts nobody can render.
 *
 * `number` is what Metro actually hands over: an entry in the asset registry,
 * which is what `expo-font` takes.
 */
declare module '*.ttf' {
  const asset: number;
  export default asset;
}

declare module '*.otf' {
  const asset: number;
  export default asset;
}
