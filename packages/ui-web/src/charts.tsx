import { useId } from 'react';
import { money, moneyCompact } from './format.js';
import { axisTicks, niceCeiling } from './chart-scale.js';

/**
 * Charts, drawn as plain SVG.
 *
 * A charting library would be the single largest thing in these bundles —
 * Recharts pulls in the whole of D3's scale and shape packages for what is, on
 * these screens, four shapes: a bar, an area, a donut and a progress row. These
 * render on the server, ship no runtime JavaScript of their own, and cost a few
 * hundred bytes each.
 *
 * Accessibility is not an afterthought here. A `<svg>` full of paths is opaque
 * to a screen reader, so every chart carries `role="img"` with a summary label
 * *and* renders the same numbers as a visually-hidden table. Plan §134 requires
 * that colour never be the only carrier of meaning, which a chart violates by
 * construction unless the values are also available as text.
 */

export interface SeriesPoint {
  /** Short axis label — a weekday or a date. */
  readonly label: string;
  readonly value: number;
}


/** The hidden table every chart pairs with, so the data is never colour-only. */
function DataTableFallback({
  caption,
  points,
  format,
}: {
  caption: string;
  points: readonly SeriesPoint[];
  format: (value: number) => string;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {points.map((point) => (
          <tr key={point.label}>
            <th scope="row">{point.label}</th>
            <td>{format(point.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Vertical bars — used for daily sales and daily commission.
 *
 * Bars are laid out in the SVG's own left-to-right order and the element is
 * marked `dir="ltr"`: a time axis runs oldest-to-newest regardless of the
 * document's direction, and letting RTL flip it would put "today" on the left
 * of a chart whose axis labels say otherwise.
 */
export function BarChart({
  points,
  height = 180,
  caption,
  format = moneyCompact,
  tone = 'orange',
}: {
  points: readonly SeriesPoint[];
  height?: number;
  caption: string;
  format?: (value: number) => string;
  tone?: 'orange' | 'green';
}) {
  if (points.length === 0) {
    return <p className="empty">لا توجد بيانات لعرضها</p>;
  }

  const max = niceCeiling(Math.max(...points.map((point) => point.value)));
  const barWidth = 100 / points.length;
  const fill = tone === 'green' ? 'var(--jibli-success-500)' : 'var(--jibli-orange-500)';
  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <div dir="ltr" style={{ width: '100%' }}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}
        role="img"
        aria-label={`${caption}. الإجمالي ${format(total)}. القيم في الجدول المرافق.`}
      >
        {/* Gridlines at quarters give the eye a scale without an axis. */}
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2="100"
            y1={height - fraction * (height - 18)}
            y2={height - fraction * (height - 18)}
            stroke="var(--border-subtle)"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {points.map((point, index) => {
          const barHeight = max === 0 ? 0 : (point.value / max) * (height - 18);
          return (
            <rect
              key={point.label}
              x={index * barWidth + barWidth * 0.2}
              y={height - 18 - barHeight}
              width={barWidth * 0.6}
              height={Math.max(barHeight, point.value > 0 ? 1 : 0)}
              rx="1"
              fill={fill}
            />
          );
        })}
      </svg>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${points.length}, 1fr)`,
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        {points.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>

      <DataTableFallback caption={caption} points={points} format={format} />
    </div>
  );
}

/**
 * A filled area line — used for the 30-day sales trend.
 *
 * Only a handful of axis labels are drawn: thirty date labels would overlap
 * into an unreadable smear at this width.
 */

/** "12.5 مليون د.ع" -> "12.5 مليون". */
function compactAxisTick(value: number): string {
  return moneyCompact(value).replace(/\s*د\.ع$/, '');
}

export function AreaChart({
  points,
  height = 190,
  caption,
  format = moneyCompact,
  axisFormat = compactAxisTick,
}: {
  points: readonly SeriesPoint[];
  height?: number;
  caption: string;
  format?: (value: number) => string;
  /**
   * Tick text. Defaults to the value formatter with the currency dropped — an
   * axis repeating "د.ع" on every tick spends width the plot needs, and the
   * panel heading already says what the numbers are.
   */
  axisFormat?: (value: number) => string;
}) {
  const gradientId = useId();

  if (points.length < 2) {
    return <p className="empty">لا توجد بيانات كافية لرسم الاتجاه</p>;
  }

  const max = niceCeiling(Math.max(...points.map((point) => point.value)));
  const ticks = axisTicks(max);
  const plotHeight = height - 20;
  const stepX = 100 / (points.length - 1);

  const coordinates = points.map((point, index) => ({
    x: index * stepX,
    y: plotHeight - (max === 0 ? 0 : (point.value / max) * plotHeight),
  }));

  const line = coordinates
    .map((coordinate, index) => `${index === 0 ? 'M' : 'L'}${coordinate.x} ${coordinate.y}`)
    .join(' ');
  const area = `${line} L100 ${plotHeight} L0 ${plotHeight} Z`;

  // Roughly five labels, whatever the series length.
  const labelStride = Math.max(1, Math.ceil(points.length / 5));
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), points[0]!);

  return (
    <div dir="ltr" style={{ width: '100%' }}>
      {/*
        The value axis is HTML, not SVG text. The plot uses
        `preserveAspectRatio="none"` so its viewBox stretches horizontally to
        whatever width it is given, and any glyph inside would stretch with it.
      */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
        <div
          aria-hidden
          style={{
            display: 'flex',
            flexDirection: 'column-reverse',
            justifyContent: 'space-between',
            height: plotHeight,
            fontSize: 'var(--text-xs)',
            lineHeight: 1,
            color: 'var(--text-muted)',
            textAlign: 'end',
            flexShrink: 0,
          }}
        >
          {ticks.map(({ fraction, value }) => (
            <span key={fraction}>{axisFormat(value)}</span>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}
        role="img"
        aria-label={`${caption}. أعلى قيمة ${format(peak.value)} في ${peak.label}.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--jibli-orange-500)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--jibli-orange-500)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map(({ fraction }) => (
          <line
            key={fraction}
            x1="0"
            x2="100"
            y1={plotHeight - fraction * plotHeight}
            y2={plotHeight - fraction * plotHeight}
            stroke="var(--border-subtle)"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--jibli-orange-500)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          // Keeps the stroke 2px however the viewBox is stretched.
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
        }}
      >
        {points
          .filter((_, index) => index % labelStride === 0)
          .map((point) => (
            <span key={point.label}>{point.label}</span>
          ))}
      </div>
        </div>
      </div>

      <DataTableFallback caption={caption} points={points} format={format} />
    </div>
  );
}

export interface DonutSlice {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

/**
 * Donut with a total in the middle — the order-status split.
 *
 * Built from `stroke-dasharray` on concentric circles rather than arc paths:
 * fewer trigonometry mistakes, and a zero-value slice simply draws nothing
 * instead of collapsing into a stray dot.
 */
export function DonutChart({
  slices,
  total,
  totalLabel,
  caption,
  size = 168,
}: {
  slices: readonly DonutSlice[];
  total: number;
  totalLabel: string;
  caption: string;
  size?: number;
}) {
  const sum = slices.reduce((accumulator, slice) => accumulator + slice.value, 0);

  if (sum === 0) {
    return <p className="empty">لا توجد طلبات في هذه الفترة</p>;
  }

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg
          viewBox="0 0 100 100"
          style={{ width: size, height: size, transform: 'rotate(-90deg)' }}
          role="img"
          aria-label={`${caption}: ${slices
            .map((slice) => `${slice.label} ${Math.round((slice.value / sum) * 100)}%`)
            .join('، ')}`}
        >
          {slices.map((slice) => {
            const fraction = slice.value / sum;
            const dash = fraction * circumference;
            const element = (
              <circle
                key={slice.label}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth="13"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return element;
          })}
        </svg>

        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <strong style={{ fontSize: 'var(--text-xl)', fontVariantNumeric: 'tabular-nums' }}>
            {new Intl.NumberFormat('en-US').format(total)}
          </strong>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
            {totalLabel}
          </span>
        </div>
      </div>

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          flex: 1,
          minWidth: 160,
        }}
      >
        {slices.map((slice) => (
          <li
            key={slice.label}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
          >
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: slice.color,
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, fontSize: 'var(--text-sm)' }}>{slice.label}</span>
            <span
              className="numeric"
              style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}
            >
              {Math.round((slice.value / sum) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A labelled bar in a ranked list — "most ordered categories".
 *
 * `<meter>` would be the semantic element, but its rendering cannot be styled
 * consistently across browsers, so this is a div pair carrying the same
 * information through `role="img"` and a label that states the value.
 */
export function RankedBar({
  label,
  value,
  max,
  format = (value: number) => String(value),
  icon,
}: {
  label: string;
  value: number;
  max: number;
  format?: (value: number) => string;
  icon?: string;
}) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
      {icon ? (
        <span aria-hidden style={{ fontSize: 20, flexShrink: 0 }}>
          {icon}
        </span>
      ) : null}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
            marginBlockEnd: 4,
          }}
        >
          <span
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {label}
          </span>
          <span className="numeric" style={{ fontWeight: 700 }}>
            {format(value)}
          </span>
        </div>

        <div
          role="img"
          aria-label={`${label}: ${format(value)}`}
          style={{
            height: 6,
            borderRadius: 999,
            background: 'var(--jibli-ink-100)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${percent}%`,
              background: 'var(--jibli-orange-500)',
              borderRadius: 999,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Money formatter re-exported so a chart caller needs one import, not two. */
export { money, moneyCompact };
