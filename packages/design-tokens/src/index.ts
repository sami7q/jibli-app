/**
 * Jibli design tokens — one source, three surfaces.
 *
 * The same values were written twice: as CSS custom properties in
 * `ui-web/tokens.css` and again by hand as a TypeScript object in the mobile
 * app's theme. Two copies of a palette is not duplication anyone notices until
 * a designer changes the orange, one of them is updated, and the phone quietly
 * stops matching the portals.
 *
 * So the values live here, in plain data with no platform in them:
 *
 *   web    → `toCssVariables()` generates the `:root` block
 *   mobile → imports the objects directly (numbers, not `rem` strings)
 *
 * The rule that keeps this honest: **nothing in this package may import a
 * platform.** No `react-native`, no DOM. The moment it needs one, the thing
 * being added is not a token.
 *
 * Two conventions worth knowing before editing:
 *
 *   Spacing and type are in **pixels** here. The web emitter converts to `rem`
 *   so a reader who raises their browser font size gets a bigger layout;
 *   React Native has no such unit and takes the number as-is.
 *
 *   Shadows are structured, not strings. A CSS box-shadow and an iOS
 *   `shadowOffset`/Android `elevation` cannot be written as one string, but
 *   they can be derived from the same four numbers.
 */

// ── Palette ─────────────────────────────────────────────────────────────────
//
// Raw ramps. Screens should reach for the semantic names below instead: a
// component that says `orange500` cannot be re-themed, while one that says
// `brand` can.

export const palette = {
  orange: {
    50: '#fff4ed',
    100: '#ffe6d5',
    200: '#ffc9aa',
    300: '#ffa474',
    400: '#ff7a3c',
    500: '#ff6b2c', // primary — the logo orange
    600: '#f04e0a',
    700: '#c73c07',
    800: '#9e310e',
    900: '#7f2b0f',
  },
  ink: {
    50: '#f8f9fb',
    100: '#f1f3f6',
    200: '#e3e6eb',
    300: '#c7ccd4',
    400: '#9aa1ad',
    500: '#6b7280',
    600: '#4a4f5c',
    700: '#333741',
    800: '#21242b',
    900: '#16181d', // Admin sidebar, headings
  },
  success: { 50: '#ecfdf3', 500: '#12b76a', 700: '#027a48' },
  warning: { 50: '#fffaeb', 500: '#f79009', 700: '#b54708' },
  danger: { 50: '#fef3f2', 500: '#f04438', 700: '#b42318' },
  info: { 50: '#eff8ff', 500: '#2e90fa', 700: '#175cd3' },
  /*
   * The fifth headline tile. Five tiles and four tones meant two of them shared
   * orange, so the row read as four categories rather than five.
   */
  violet: { 50: '#f4f3ff', 500: '#7a5af8', 700: '#5925dc' },
  white: '#ffffff',
  black: '#000000',
} as const;

// ── Semantic colour ─────────────────────────────────────────────────────────
//
// What a colour is *for*. This is the layer screens use, and the layer a new
// set of designs replaces.

export const color = {
  brand: palette.orange[500],
  brandStrong: palette.orange[600],
  brandDeep: palette.orange[700],
  brandSoft: palette.orange[50],

  surfacePage: palette.ink[50],
  surfaceCard: palette.white,
  surfaceRaised: palette.white,
  surfaceSunken: palette.ink[100],
  surfaceInverse: palette.ink[900],

  borderSubtle: palette.ink[200],
  borderStrong: palette.ink[300],

  textPrimary: palette.ink[900],
  textSecondary: palette.ink[600],
  textMuted: palette.ink[500],
  textInverse: palette.white,
  textBrand: palette.orange[600],

  success: palette.success[500],
  successStrong: palette.success[700],
  successSoft: palette.success[50],

  warning: palette.warning[500],
  warningStrong: palette.warning[700],
  warningSoft: palette.warning[50],

  danger: palette.danger[500],
  dangerStrong: palette.danger[700],
  dangerSoft: palette.danger[50],

  info: palette.info[500],
  infoStrong: palette.info[700],
  infoSoft: palette.info[50],
} as const;

// ── Spacing ─────────────────────────────────────────────────────────────────
//
// A 4px base. Numbered rather than named (sm/md/lg) because a numbered scale
// composes — `space[3]` sits between 2 and 4 by construction, while "md" has to
// be remembered.

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  '2xl': 28,
  full: 9999,
} as const;

// ── Type ────────────────────────────────────────────────────────────────────

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
} as const;

/**
 * Line height as a multiplier.
 *
 * `normal` is 1.6 rather than the usual 1.5 because Arabic sits taller than
 * Latin: descenders and the dots below ب، ج، ي collide at 1.5, and the text
 * reads cramped even when it technically fits.
 */
export const lineHeight = {
  tight: 1.3,
  normal: 1.6,
  relaxed: 1.8,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

/**
 * The font stack, Arabic first.
 *
 * Cairo and Tajawal render Arabic far better than any Latin default, which
 * falls back to a system Arabic face with the wrong proportions. The mobile app
 * bundles Cairo; the web loads it and keeps the rest as fallbacks.
 */
export const fontFamily = {
  sansStack:
    "'Cairo', 'Tajawal', 'Noto Sans Arabic', 'Segoe UI', system-ui, -apple-system, sans-serif",
  /** The bundled family name, which is what React Native needs. */
  sans: 'Cairo',
  /** Order numbers and money stay legible in a tabular column. */
  monoStack: "'JetBrains Mono', 'Cascadia Mono', 'Consolas', ui-monospace, monospace",
} as const;

// ── Elevation ───────────────────────────────────────────────────────────────
//
// Structured rather than a CSS string, because the two platforms need
// different shapes from the same intent. `elevation` is Android's own scale and
// has no analogue on the other two — it rides along so the mobile helper does
// not have to invent one.

export interface ShadowToken {
  readonly offsetY: number;
  readonly blur: number;
  readonly spread: number;
  readonly opacity: number;
  readonly elevation: number;
}

export const shadow = {
  sm: { offsetY: 1, blur: 2, spread: 0, opacity: 0.05, elevation: 1 },
  md: { offsetY: 4, blur: 8, spread: -2, opacity: 0.08, elevation: 3 },
  lg: { offsetY: 12, blur: 16, spread: -4, opacity: 0.08, elevation: 6 },
  xl: { offsetY: 20, blur: 28, spread: -6, opacity: 0.12, elevation: 10 },
} as const satisfies Record<string, ShadowToken>;

/** The colour every shadow is cast in. Neutral-cool, never pure black. */
export const shadowColor = '#101828';

// ── Motion ──────────────────────────────────────────────────────────────────

export const duration = {
  instant: 80,
  fast: 150,
  normal: 220,
  slow: 320,
} as const;

// ── Layout constants ────────────────────────────────────────────────────────

/**
 * Minimum touch target.
 *
 * 44 on the web, where a mouse is usually involved; 48 on a phone, which is
 * Android's own guidance and the size a thumb actually needs on a restaurant
 * tablet in a kitchen (plan §134).
 */
export const tapTarget = { web: 44, native: 48 } as const;

export const zIndex = {
  dropdown: 100,
  sticky: 200,
  modal: 400,
  toast: 500,
} as const;

// ── Web emitter ─────────────────────────────────────────────────────────────

/** px → rem, so browser font-size settings scale the layout with the text. */
function rem(px: number): string {
  return `${px / 16}rem`;
}

function rgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A shadow token as a CSS `box-shadow` value. */
export function cssShadow(token: ShadowToken): string {
  return `0 ${token.offsetY}px ${token.blur}px ${token.spread}px ${rgba(shadowColor, token.opacity)}`;
}

export interface CssVariable {
  readonly name: string;
  readonly value: string;
  /** Rendered as a trailing `/* … *\/` on the declaration. */
  readonly note?: string;
  /** Starts a new commented section above this declaration. */
  readonly section?: string;
}

/**
 * Every palette hex, indexed back to the variable that holds it.
 *
 * So a semantic token emits `var(--jibli-ink-50)` rather than `#f8f9fb`. The
 * indirection is the point: overriding one ramp variable in a scope re-themes
 * every semantic token built on it, which a flattened hex cannot do.
 */
function paletteVariableFor(hex: string): string | undefined {
  for (const [ramp, shades] of Object.entries(palette)) {
    if (typeof shades === 'string') continue;
    for (const [shade, value] of Object.entries(shades)) {
      if (value === hex) return `var(--jibli-${ramp}-${shade})`;
    }
  }
  return undefined;
}

/** A semantic colour as a reference to its ramp where one exists. */
function ref(hex: string): string {
  return paletteVariableFor(hex) ?? hex;
}

/**
 * Every token as a CSS custom property, in declaration order.
 *
 * Structured rather than a finished string so the caller decides formatting:
 * the emitter writes a commented stylesheet, and a test can compare the list
 * against the token objects without parsing CSS.
 */
export function cssVariables(): CssVariable[] {
  const vars: CssVariable[] = [];

  const paletteNotes: Record<string, string> = {
    '--jibli-orange-500': 'primary — the logo orange',
    '--jibli-ink-900': 'Admin sidebar, headings',
    '--jibli-violet-500': 'the fifth headline tile, so the row reads as five',
  };

  let first = true;
  for (const [ramp, shades] of Object.entries(palette)) {
    if (typeof shades === 'string') continue;
    for (const [shade, value] of Object.entries(shades)) {
      const name = `--jibli-${ramp}-${shade}`;
      vars.push({
        name,
        value,
        ...(paletteNotes[name] ? { note: paletteNotes[name] } : {}),
        ...(first ? { section: 'Palette' } : {}),
      });
      first = false;
    }
  }

  const semantic: [string, string][] = [
    ['--surface-page', color.surfacePage],
    ['--surface-card', color.surfaceCard],
    ['--surface-raised', color.surfaceRaised],
    ['--surface-sunken', color.surfaceSunken],
    ['--surface-inverse', color.surfaceInverse],
    ['--border-subtle', color.borderSubtle],
    ['--border-strong', color.borderStrong],
    ['--text-primary', color.textPrimary],
    ['--text-secondary', color.textSecondary],
    ['--text-muted', color.textMuted],
    ['--text-inverse', color.textInverse],
    ['--text-brand', color.textBrand],
  ];
  semantic.forEach(([name, value], index) => {
    vars.push({
      name,
      value: ref(value),
      ...(index === 0 ? { section: 'Semantic — what a colour is for' } : {}),
    });
  });

  vars.push(
    {
      name: '--font-sans',
      value: `var(--font-cairo), ${fontFamily.sansStack}`,
      section: 'Type — Arabic first',
      note: 'a Latin default falls back to the wrong Arabic face',
    },
    {
      name: '--font-mono',
      value: fontFamily.monoStack,
      note: 'order numbers and money, in a tabular column',
    },
  );

  for (const [name, value] of Object.entries(fontSize)) {
    vars.push({ name: `--text-${name}`, value: rem(value) });
  }
  for (const [name, value] of Object.entries(lineHeight)) {
    vars.push({
      name: `--leading-${name}`,
      value: String(value),
      ...(name === 'normal' ? { note: 'Arabic needs more line height than Latin' } : {}),
    });
  }

  let firstSpace = true;
  for (const [name, value] of Object.entries(space)) {
    if (name === '0') continue;
    vars.push({
      name: `--space-${name}`,
      value: rem(value),
      ...(firstSpace ? { section: 'Spacing and shape — a 4px base' } : {}),
    });
    firstSpace = false;
  }
  for (const [name, value] of Object.entries(radius)) {
    vars.push({ name: `--radius-${name}`, value: name === 'full' ? '9999px' : `${value}px` });
  }
  for (const [name, token] of Object.entries(shadow)) {
    vars.push({ name: `--shadow-${name}`, value: cssShadow(token) });
  }

  vars.push({
    name: '--tap-target-min',
    value: `${tapTarget.web}px`,
    section: 'Layout constants',
    note: 'large enough for a restaurant tablet (plan §134)',
  });

  for (const [name, value] of Object.entries(zIndex)) {
    vars.push({ name: `--z-${name}`, value: String(value) });
  }
  for (const [name, value] of Object.entries(duration)) {
    vars.push({ name: `--duration-${name}`, value: `${value}ms` });
  }

  return vars;
}
