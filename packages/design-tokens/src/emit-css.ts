import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssVariables } from './index.js';

/**
 * Write the `:root` block of `ui-web/tokens.css` from the token objects.
 *
 * Only that block. Everything after the marker below — the reset, the bidi
 * isolation helpers, the focus ring, the reduced-motion rule — is hand-written
 * CSS with no equivalent on the other platforms, and regenerating it would
 * throw away decisions that took longer than the palette did.
 *
 * Run with `pnpm --filter @jibli/design-tokens build:css`. A test asserts the
 * committed file matches, so a token edited without regenerating fails CI
 * rather than shipping a phone and a portal that disagree.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, '..', '..', 'ui-web', 'src', 'tokens.css');

/** Everything below this line in tokens.css is hand-written and preserved. */
export const HANDWRITTEN_MARKER = '/* ── Base reset ─';

const HEADER = `/**
 * Jibli design tokens.
 *
 * GENERATED — do not edit the :root block below.
 * Source: packages/design-tokens/src/index.ts
 * Regenerate: pnpm --filter @jibli/design-tokens build:css
 *
 * The same values feed the mobile app, which cannot read CSS. Editing a colour
 * here rather than at the source is how a phone stops matching its portals.
 *
 * Plan §2 makes RTL a first-class layout requirement, not a mirrored
 * afterthought. These tokens are direction-agnostic — spacing uses logical
 * properties (inline-start/end) so a component never hard-codes left or right.
 */
`;

/** The generated stylesheet, given whatever hand-written tail already exists. */
export function renderTokensCss(existing: string): string {
  const markerAt = existing.indexOf(HANDWRITTEN_MARKER);
  const tail = markerAt === -1 ? '' : existing.slice(markerAt);

  const lines: string[] = [];

  for (const variable of cssVariables()) {
    if (variable.section) {
      // A rule of dashes to the same width, so the sections line up the way
      // they did when this file was written by hand.
      const rule = '─'.repeat(Math.max(4, 68 - variable.section.length));
      lines.push(`${lines.length === 0 ? '' : '\n'}  /* ── ${variable.section} ${rule} */`);
    }
    const note = variable.note ? ` /* ${variable.note} */` : '';
    lines.push(`  ${variable.name}: ${variable.value};${note}`);
  }

  return `${HEADER}\n:root {\n${lines.join('\n')}\n}\n\n${tail}`;
}

if (process.argv[1] && process.argv[1].endsWith('emit-css.ts')) {
  const existing = readFileSync(TARGET, 'utf8');
  const next = renderTokensCss(existing);

  if (existing === next) {
    console.log('tokens.css already matches the token source.');
  } else {
    writeFileSync(TARGET, next, 'utf8');
    console.log(`Wrote ${TARGET}`);
  }
}
