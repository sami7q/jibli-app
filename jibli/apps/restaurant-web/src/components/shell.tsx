'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { JibliLogo, RESTAURANT_NAV } from '@jibli/ui-web';
import { Icon, type IconName } from './icon';
import type { PortalRestaurant } from '@/hooks/use-session';

/**
 * Portal shell (plan §131).
 *
 * The navigation rail sits on the inline-end edge — the right, in RTL — exactly
 * as the reference design shows. `aria-current` marks the active page for
 * screen-reader users, not just the background colour (plan §134).
 */

export interface ShellProps {
  children: React.ReactNode;
  restaurantName: string;
  partnerCode: string;
  userName: string;
  /** Every restaurant this session may switch between. Usually one. */
  restaurants?: readonly PortalRestaurant[];
  activeRestaurantId?: string;
  onSwitchRestaurant?: (restaurantId: string) => void;
  /** Count for the topbar bell — new orders needing a decision. */
  notificationCount?: number;
}

export function Shell({
  children,
  restaurantName,
  partnerCode,
  userName,
  restaurants = [],
  activeRestaurantId,
  onSwitchRestaurant,
  notificationCount = 0,
}: ShellProps) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <JibliLogo size={34} tone="onLight" />
        </div>

        <nav className="nav" aria-label="القائمة الرئيسية">
          {RESTAURANT_NAV.map((item) => (
            <NavLink key={item.href} href={item.href} icon={item.icon} label={item.labelAr} />
          ))}
        </nav>

        <div className="sidebar__support">
          <Icon name="support" className="nav__icon" aria-hidden />
          <h3>تحتاج إلى مساعدة؟</h3>
          <p>فريق الدعم متاح دائماً</p>
          <a className="btn btn--ghost btn--block" href="tel:+9647700000000">
            تواصل معنا
          </a>
        </div>
      </aside>

      <main className="main">
        <Topbar
          restaurantName={restaurantName}
          partnerCode={partnerCode}
          userName={userName}
          restaurants={restaurants}
          activeRestaurantId={activeRestaurantId}
          onSwitchRestaurant={onSwitchRestaurant}
          notificationCount={notificationCount}
        />
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  const pathname = usePathname();
  // Exact match for the root, prefix match elsewhere, so /orders/123 keeps
  // "الطلبات" highlighted.
  const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`nav__link${isActive ? ' nav__link--active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon name={icon as IconName} className="nav__icon" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

function Topbar({
  restaurantName,
  partnerCode,
  userName,
  restaurants,
  activeRestaurantId,
  onSwitchRestaurant,
  notificationCount,
}: Omit<ShellProps, 'children' | 'restaurants'> & {
  restaurants: readonly PortalRestaurant[];
}) {
  return (
    <header className="topbar">
      {/*
        Greeting first, so it sits at the inline-start edge — the right in RTL,
        which is where the reference design puts it.
      */}
      <div className="topbar__greeting">
        <strong>مرحباً {userName} 👋</strong>
        <span>نتمنى لك يوماً موفقاً</span>
      </div>

      <div className="topbar__search">
        <Icon name="search" className="nav__icon" aria-hidden />
        <label htmlFor="portal-search" className="sr-only">
          البحث عن طلب، عميل أو صنف في المنيو
        </label>
        <input
          id="portal-search"
          type="search"
          placeholder="البحث عن طلب، عميل أو صنف في المنيو..."
        />
      </div>

      <NotificationBell count={notificationCount ?? 0} />

      <RestaurantBadge
        restaurantName={restaurantName}
        partnerCode={partnerCode}
        restaurants={restaurants}
        activeRestaurantId={activeRestaurantId}
        onSwitchRestaurant={onSwitchRestaurant}
      />
    </header>
  );
}

/**
 * Unread indicator for orders awaiting a decision.
 *
 * The count is also written into the accessible name, because a red dot on an
 * icon communicates nothing to a screen reader (plan §134).
 */
function NotificationBell({ count }: { count: number }) {
  const label =
    count === 0
      ? 'لا توجد طلبات جديدة'
      : count === 1
        ? 'طلب جديد واحد بانتظار القبول'
        : `${count} طلبات جديدة بانتظار القبول`;

  return (
    <Link href="/" className="bell" aria-label={label}>
      <Icon name="bell" className="nav__icon" aria-hidden />
      {count > 0 ? (
        <span className="bell__badge" aria-hidden>
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The restaurant chip, which doubles as the branch switcher.
 *
 * With one membership it is static text: rendering a menu that can only select
 * what is already selected is noise. The list appears only when there is
 * somewhere to switch to.
 */
function RestaurantBadge({
  restaurantName,
  partnerCode,
  restaurants,
  activeRestaurantId,
  onSwitchRestaurant,
}: {
  restaurantName: string;
  partnerCode: string;
  restaurants: readonly PortalRestaurant[];
  activeRestaurantId?: string;
  onSwitchRestaurant?: (restaurantId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const canSwitch = restaurants.length > 1 && onSwitchRestaurant !== undefined;

  // Dismiss on an outside click or Escape — a menu that can only be closed by
  // re-clicking the trigger traps keyboard users.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const body = (
    <>
      <div className="topbar__avatar" aria-hidden="true" />
      <div className="topbar__greeting">
        <strong>{restaurantName}</strong>
        <span>
          رقم الشريك: <span className="ltr-inline">#{partnerCode}</span>
        </span>
      </div>
      {canSwitch ? (
        <Icon name="chevron" className="nav__icon" aria-hidden />
      ) : null}
    </>
  );

  if (!canSwitch) {
    return <div className="topbar__restaurant">{body}</div>;
  }

  return (
    <div className="topbar__restaurant" ref={container} style={{ position: 'relative' }}>
      <button
        type="button"
        className="topbar__restaurant-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {body}
      </button>

      {open ? (
        <div className="menu" role="menu" aria-label="تبديل المطعم">
          {restaurants.map((restaurant) => (
            <button
              key={restaurant.id}
              type="button"
              role="menuitemradio"
              aria-checked={restaurant.id === activeRestaurantId}
              className="menu__item"
              onClick={() => {
                onSwitchRestaurant?.(restaurant.id);
                setOpen(false);
              }}
            >
              <span style={{ flex: 1 }}>{restaurant.display_name}</span>
              <span className="ltr-inline" style={{ color: 'var(--text-muted)' }}>
                #{restaurant.partner_code}
              </span>
              {restaurant.id === activeRestaurantId ? (
                <Icon name="check" className="nav__icon" aria-hidden />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
