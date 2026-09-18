import createIconSet from '@expo/vector-icons/createIconSet';
import glyphMap from '../../assets/icons/mci-subset.json';

/**
 * The app's icon set: MaterialCommunityIcons, cut down to what it draws.
 *
 * `@expo/vector-icons/MaterialCommunityIcons` bundles the whole typeface —
 * 7,448 glyphs, 1.25 MB — into both binaries so the app can draw about a
 * hundred of them. It was the single largest file in the payload by a wide
 * margin: bigger than every screen, provider and hook in `src/` combined, and
 * shipped twice because both platforms carry it.
 *
 * `scripts/build-icon-font.mjs` produces `assets/icons/mci-subset.ttf` from the
 * names the source actually refers to. Same glyphs, same codepoints, same
 * rendering — 16.8 KB instead of 1,277 KB.
 *
 * Nothing about drawing an icon changes. This is a drop-in for the import it
 * replaces:
 *
 *     import Icon from '@/ui/icon';
 *     <Icon name="home" size={20} color={color.brand} />
 *
 * **Adding an icon means regenerating.** A name that is not in the subset
 * renders as nothing — no error, no box, just a gap where an icon should be,
 * which is the kind of defect that reaches a store. `icon.test.ts` is the guard:
 * it re-scans the source and fails if any name used is missing here, so the
 * cost of forgetting is a red test rather than a bad release.
 *
 * The font family name is the app's own rather than `material-community`, so
 * this set can never be confused with the full one if something imports both.
 */
export const ICON_FONT_FAMILY = 'jibli-icons';

/**
 * The font file, exported so the root layout can preload it.
 *
 * `createIconSet` would otherwise fetch it in `componentDidMount` and render
 * nothing until it lands — see the note in `src/app/_layout.tsx`.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro asset
export const ICON_FONT = require('../../assets/icons/mci-subset.ttf') as number;

const Icon = createIconSet(glyphMap, ICON_FONT_FAMILY, ICON_FONT);

export type IconName = keyof typeof glyphMap;

export default Icon;
