import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HANDWRITTEN_MARKER, renderTokensCss } from './emit-css.js';
import {
  color,
  cssShadow,
  cssVariables,
  fontSize,
  palette,
  shadow,
  space,
  tapTarget,
} from './index.js';

/**
 * The point of this file is one test: the committed stylesheet still matches
 * the tokens it was generated from.
 *
 * Without it the generator is a suggestion. Someone changes the orange here,
 * forgets to run the emitter, and the phone and the portals disagree — which is
 * exactly the failure the package was created to remove, reintroduced by a
 * missing build step.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS_CSS = join(HERE, '..', '..', 'ui-web', 'src', 'tokens.css');

describe('the generated stylesheet', () => {
  const committed = readFileSync(TOKENS_CSS, 'utf8').replace(/\r\n/g, '\n');

  it('is up to date with the token source', () => {
    expect(renderTokensCss(committed)).toBe(committed);
  });

  it('keeps the hand-written half — reset, bidi helpers, focus ring', () => {
    expect(committed).toContain(HANDWRITTEN_MARKER);
    // The three that would be silently destroyed by a naive regeneration.
    expect(committed).toContain('.ltr-inline');
    expect(committed).toContain('prefers-reduced-motion');
    expect(committed).toContain('direction: rtl');
  });

  it('says it is generated, where someone about to edit it will look', () => {
    expect(committed.slice(0, 400)).toContain('GENERATED');
  });
});

describe('semantic colours', () => {
  const vars = new Map(cssVariables().map((entry) => [entry.name, entry.value]));

  it('reference their ramp rather than repeating a hex', () => {
    // The indirection is what lets one override re-theme everything built on
    // it; a flattened hex cannot be overridden in a scope.
    expect(vars.get('--surface-page')).toBe('var(--jibli-ink-50)');
    expect(vars.get('--text-primary')).toBe('var(--jibli-ink-900)');
    expect(vars.get('--text-brand')).toBe('var(--jibli-orange-600)');
  });

  it('fall back to a literal only where the ramp has no entry', () => {
    // White is not on a ramp, so it stays a hex. That is correct, not an
    // oversight, and the test says so.
    expect(vars.get('--surface-card')).toBe('#ffffff');
  });

  it('every semantic colour resolves to a real palette value', () => {
    const known = new Set<string>();
    for (const shades of Object.values(palette)) {
      if (typeof shades === 'string') known.add(shades);
      else for (const value of Object.values(shades)) known.add(value);
    }

    for (const [name, value] of Object.entries(color)) {
      expect(known, `${name} is not a palette value`).toContain(value);
    }
  });
});

describe('the scales', () => {
  it('space is a 4px grid with no half-steps', () => {
    for (const [name, value] of Object.entries(space)) {
      expect(value % 4, `space[${name}] = ${value} is off the grid`).toBe(0);
    }
  });

  it('font sizes ascend', () => {
    const sizes = Object.values(fontSize);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1] as number);
    }
  });

  it('shadows get deeper together — offset, blur and elevation in step', () => {
    const steps = Object.values(shadow);
    for (let i = 1; i < steps.length; i += 1) {
      const previous = steps[i - 1] as (typeof steps)[number];
      const current = steps[i] as (typeof steps)[number];
      expect(current.offsetY).toBeGreaterThan(previous.offsetY);
      expect(current.blur).toBeGreaterThan(previous.blur);
      expect(current.elevation).toBeGreaterThan(previous.elevation);
    }
  });

  it('renders a shadow as CSS with the neutral-cool cast, never black', () => {
    expect(cssShadow(shadow.md)).toBe('0 4px 8px -2px rgba(16, 24, 40, 0.08)');
  });

  it('a phone gets a bigger minimum tap target than a mouse', () => {
    expect(tapTarget.native).toBeGreaterThan(tapTarget.web);
    expect(tapTarget.web).toBeGreaterThanOrEqual(44);
  });
});
