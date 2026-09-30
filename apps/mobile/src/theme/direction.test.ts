import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The guard on the app's layout direction.
 *
 * Every row in the app reads right-to-left through `ROW`, every column pins
 * its edges through `ALIGN_START`, and both are set at runtime from what the
 * native layer was measured doing — see the note above `ROW` in `index.ts`.
 * That only holds if nothing in the app goes round the tokens, and the ways
 * round are all one-liners that look harmless in a review:
 *
 *   - a raw `flexDirection: 'row'`, which follows the native flag and so
 *     draws one way in Expo Go and the other in a store build;
 *   - a logical side — `marginStart`, `paddingEnd`, `start:` — which flips
 *     with the native direction while the visual order stays pinned;
 *   - a read of `I18nManager.isRTL`, the flag that has been seen to disagree
 *     with the layout it describes;
 *   - a token captured at module scope, which freezes the pre-measurement
 *     guess before the probe has answered.
 *
 * Each of these was a real defect at least once. Failing the suite is the
 * cheapest place to find the next one.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');

/** The two files allowed to know about the native direction. */
const EXEMPT = new Set([
  path.join(SRC, 'theme', 'index.ts'),
  path.join(SRC, 'ui', 'direction-probe.tsx'),
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) yield full;
  }
}

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    if (EXEMPT.has(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      // Comments may mention the forbidden spelling; only code counts.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (pattern.test(line))
        found.push(`${path.relative(SRC, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  return found;
}

describe('layout direction', () => {
  it('has no raw row outside the theme and the probe', () => {
    expect(offenders(/flexDirection:\s*['"](row|row-reverse)['"]/)).toEqual([]);
  });

  it('names sides physically, never logically', () => {
    expect(
      offenders(
        /\b(marginStart|marginEnd|paddingStart|paddingEnd|borderStartWidth|borderEndWidth|borderStartColor|borderEndColor|insetInlineStart|insetInlineEnd|start|end):\s*(?!\{)/,
      ),
    ).toEqual([]);
  });

  it('never reads the native flag directly', () => {
    expect(offenders(/I18nManager\.(isRTL|getConstants)/)).toEqual([]);
  });

  it('never captures a direction token at module scope', () => {
    // A declaration at column zero is module scope; inside a function it is indented.
    expect(
      offenders(
        /^(export\s+)?(const|let|var)\s.*\b(ROW|ROW_LTR|ALIGN_START|ALIGN_END|LAID_OUT_RTL)\b/,
      ),
    ).toEqual([]);
  });

  it('never freezes a direction token inside StyleSheet.create', () => {
    /*
     * `StyleSheet.create` runs when the module loads, which is before the probe
     * has measured anything — a `flexDirection: ROW` inside one keeps the
     * pre-measurement guess for the life of the process. The direction goes
     * in an inline style beside the sheet instead.
     */
    const found: string[] = [];
    for (const file of walk(SRC)) {
      if (EXEMPT.has(file)) continue;
      let inside = false;
      let previous = '';
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          // A sheet built through `lazySheet` is read after the measurement, so
          // it may. The wrapper sits on the same line or, once formatted, the
          // line before.
          const lazy = /lazySheet\(/.test(line) || /lazySheet\(/.test(previous);
          if (/StyleSheet\.create\(/.test(line) && !lazy) inside = true;
          previous = line;
          if (
            inside &&
            /\b(ROW|ROW_LTR|ALIGN_START|ALIGN_END|TEXT_START|LAID_OUT_RTL)\b/.test(line)
          ) {
            found.push(`${path.relative(SRC, file)}:${index + 1}: ${line.trim()}`);
          }
          if (inside && /^\}\)/.test(line)) inside = false;
        });
    }
    expect(found).toEqual([]);
  });
  it('never writes a text alignment as a bare side', () => {
    // `'right'` flips to the left on Android once the layout mirrors — see
    // `TEXT_START`. A text wants `TEXT_START`, an input `INPUT_TEXT_START`.
    expect(offenders(/textAlign:\s*['"]right['"]/)).toEqual([]);
  });
});
