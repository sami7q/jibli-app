import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { currentSection } from '@/theme';

type GlyphName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * The glyph that stands in for a picture nobody uploaded.
 *
 * Four places draw one — a merchant card with no cover, a menu row with no
 * photograph, a cart line, a restaurant header — and all four used a fork and
 * knife. In Jibli Market that is a fork over a bottle of detergent, which is
 * the same kind of wrong as the sidebar offering a grocer «المنيو»: the colour
 * changed with the section and the picture of the section did not.
 *
 * A function rather than a constant because the section changes while the app
 * is running, and a module-level constant would freeze whichever half happened
 * to be open when this file was first imported.
 */
export function missingImageGlyph(): GlyphName {
  return currentSection() === 'MARKET' ? 'basket-outline' : 'silverware-fork-knife';
}
