/**
 * The Jibli brand mark.
 *
 * Drawn as inline SVG rather than loaded as an image file: it is a handful of
 * paths, so inlining removes a render-blocking request on every page, keeps the
 * logo crisp at any size, and lets it inherit the surrounding colour on the
 * dark Admin sidebar without shipping a second asset.
 *
 * The mark is a delivery pin whose head holds a fork, with speed lines trailing
 * behind it — the same shape as the app icon.
 */

export interface LogoProps {
  /** Rendered height in pixels. The mark scales from its own aspect ratio. */
  readonly size?: number;
  /** `onLight` for the white Restaurant sidebar, `onDark` for Admin's. */
  readonly tone?: 'onLight' | 'onDark';
  /** Show the "Jibli / جيبلي" wordmark beside the mark. */
  readonly withWordmark?: boolean;
  readonly className?: string;
}

/** The icon alone — the pin, fork and speed lines inside a rounded square. */
export function JibliMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      // Decorative here: every use pairs it with the wordmark or a visible
      // heading, so announcing it again would only add noise (plan §134).
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="16" fill="var(--jibli-orange-500)" />

      {/* Speed lines: the mark reads as "delivery", not just "food". */}
      <g fill="#fff" opacity="0.95">
        <rect x="8" y="21" width="16" height="4.5" rx="2.25" />
        <rect x="12" y="30" width="11" height="4.5" rx="2.25" />
        <rect x="9" y="39" width="6" height="4.5" rx="2.25" />
      </g>

      {/* Pin: a circle fused to a downward point. */}
      <path
        d="M40 10c9.94 0 18 8.06 18 18 0 7.9-9.2 18.2-15.1 24.1a4.1 4.1 0 0 1-5.8 0C31.2 46.2 22 35.9 22 28c0-9.94 8.06-18 18-18Z"
        fill="#fff"
      />
      <circle cx="40" cy="27.5" r="12" fill="var(--jibli-orange-500)" />

      {/* Fork: three tines over a handle. */}
      <g fill="#fff">
        <rect x="35.1" y="18.5" width="2.2" height="7.5" rx="1.1" />
        <rect x="38.9" y="18.5" width="2.2" height="7.5" rx="1.1" />
        <rect x="42.7" y="18.5" width="2.2" height="7.5" rx="1.1" />
        <path d="M34.6 25.4h10.8a5.4 5.4 0 0 1-4.3 5.3v6a1.1 1.1 0 0 1-2.2 0v-6a5.4 5.4 0 0 1-4.3-5.3Z" />
      </g>
    </svg>
  );
}

/** The mark plus the bilingual wordmark, as the sidebars use it. */
export function JibliLogo({
  size = 36,
  tone = 'onLight',
  withWordmark = true,
  className,
}: LogoProps) {
  const latin = tone === 'onDark' ? '#fff' : 'var(--jibli-ink-900)';

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
    >
      <JibliMark size={size} />

      {withWordmark ? (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.05 }}>
          {/*
            The Latin wordmark is explicitly dir="ltr": inside an RTL document
            the bidi algorithm would otherwise be free to reorder it, and a
            brand name is not text to be reordered.
          */}
          <span
            dir="ltr"
            style={{
              fontSize: size * 0.58,
              fontWeight: 800,
              color: latin,
              letterSpacing: '-0.02em',
            }}
          >
            Jibli
          </span>
          <span
            style={{
              fontSize: size * 0.38,
              fontWeight: 700,
              color: 'var(--jibli-orange-500)',
            }}
          >
            جيبلي
          </span>
        </div>
      ) : null}
    </div>
  );
}
