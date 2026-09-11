/**
 * Inline icon set.
 *
 * Drawn inline rather than loaded from an icon font: no extra request on a weak
 * connection, and `currentColor` keeps every icon in step with its container's
 * text colour.
 *
 * Directional icons are mirrored under RTL via the `flip` prop (plan §2:
 * "Directional icons are mirrored where semantically appropriate"). A clock or
 * a home icon is NOT directional and must never be flipped.
 */

export type IconName =
  | 'home'
  | 'orders'
  | 'menu'
  | 'inventory'
  | 'profits'
  | 'commissions'
  | 'settlements'
  | 'drivers'
  | 'staff'
  | 'settings'
  | 'search'
  | 'support'
  | 'bell'
  | 'check'
  | 'close'
  | 'chevron'
  | 'clock'
  | 'cash'
  | 'chart'
  | 'alert'
  | 'volume'
  | 'geography'
  | 'restaurants'
  | 'applications'
  | 'categories'
  | 'live'
  | 'cancelled'
  | 'users'
  | 'reports'
  | 'invoices'
  | 'roles'
  | 'audit'
  | 'add'
  | 'coupons';

interface IconProps {
  readonly name: IconName;
  readonly className?: string;
  readonly flip?: boolean;
  readonly 'aria-hidden'?: boolean;
  readonly title?: string;
}

const PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  orders: 'M7 3h10a1 1 0 0 1 1 1v17l-6-3-6 3V4a1 1 0 0 1 1-1zM9 8h6M9 12h6',
  menu: 'M5 3v8a2 2 0 0 0 4 0V3M7 11v10M19 3c-1.5 2-2 4-2 6s.5 3 2 3v9',
  inventory: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9',
  profits: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  commissions: 'M19 5 5 19M7.5 8a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM16.5 21a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
  settlements: 'M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 8l2-4h14l2 4M16 14h2',
  drivers: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3.5 3-6 7-6s7 2.5 7 6M17 8h5M19.5 5.5v5',
  staff: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3.3 2.7-5.5 6-5.5S14 16.7 14 20M17 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM16 14.5c3 0 6 1.8 6 5.5',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  support: 'M12 2a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-8H5v0a7 7 0 1 1 14 0v0h-2v8h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9z',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  check: 'm20 6-11 11-5-5',
  close: 'M18 6 6 18M6 6l12 12',
  chevron: 'm15 18-6-6 6-6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  cash: 'M2 7h20v10H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  volume: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14',
  geography: 'M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  restaurants: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6',
  applications: 'M9 3h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2V4a1 1 0 0 1 1-1zM9 13l2 2 4-4',
  categories: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  live: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13',
  cancelled: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9l-6 6M9 9l6 6',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  reports: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6',
  invoices: 'M6 2h12a1 1 0 0 1 1 1v19l-3-2-3 2-3-2-3 2V3a1 1 0 0 1 1-1zM9 7h6M9 11h6',
  roles: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  audit: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h2M8 17h6M12 13h4',
  coupons:
    'M4 7h16a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4V8a1 1 0 0 1 1-1zM14 8v1M14 15v1M14 11.5v1',
  add: 'M12 5v14M5 12h14',
};

/** Icons that encode a direction and must mirror in RTL. */
const DIRECTIONAL: ReadonlySet<IconName> = new Set(['chevron']);

export function Icon({ name, className, flip, title, ...rest }: IconProps) {
  const shouldFlip = flip ?? DIRECTIONAL.has(name);

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={rest['aria-hidden'] ?? (title ? undefined : true)}
      style={shouldFlip ? { transform: 'scaleX(-1)' } : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
