'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { JibliLogo, RESTAURANT_NAV } from '@jibli/ui-web';
import { Icon, type IconName } from './icon';
import { SessionMenu } from './session-menu';
import { useLiveOrders } from '@/hooks/use-live-orders';
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
  /**
   * What this merchant calls its catalog — «القائمة» or «المنتجات».
   *
   * Optional and defaulted, so a caller that has not been updated renders the
   * restaurant wording rather than a blank sidebar entry.
   */
  catalogLabel?: string;
  /** And what one line in it is called — «صنف» or «منتج». */
  itemLabel?: string;
}

export function Shell({
  children,
  restaurantName,
  partnerCode,
  userName,
  restaurants = [],
  activeRestaurantId,
  onSwitchRestaurant,
  catalogLabel = 'المنيو',
  itemLabel = 'صنف',
}: ShellProps) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <JibliLogo size={34} tone="onLight" />
        </div>

        <nav className="nav" aria-label="القائمة الرئيسية">
          {RESTAURANT_NAV.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              // One entry is named by the merchant rather than by the sidebar.
              label={'catalogLabel' in item && item.catalogLabel ? catalogLabel : item.labelAr}
            />
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
          catalogLabel={catalogLabel}
          itemLabel={itemLabel}
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
  catalogLabel,
  itemLabel,
}: Omit<ShellProps, 'children' | 'restaurants'> & {
  restaurants: readonly PortalRestaurant[];
  /** Named by the merchant, so the search says what it actually searches. */
  catalogLabel: string;
  itemLabel: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');

  /*
   * The box did nothing — no onChange, no form (MERCH-25). An owner on the
   * phone looking up an order by number got no answer. It now submits to the
   * order history, which does the search server-side.
   */
  const submitSearch = (event: React.FormEvent): void => {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    router.push(`/orders?search=${encodeURIComponent(term)}`);
  };

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

      <form className="topbar__search" role="search" onSubmit={submitSearch}>
        <button
          type="submit"
          aria-label="بحث"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'inherit',
            display: 'inline-flex',
          }}
        >
          <Icon name="search" className="nav__icon" aria-hidden />
        </button>
        <label htmlFor="portal-search" className="sr-only">
          {`البحث عن طلب، عميل أو ${itemLabel} في ${catalogLabel}`}
        </label>
        <input
          id="portal-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`البحث عن طلب، عميل أو ${itemLabel} في ${catalogLabel}...`}
        />
      </form>

      <NotificationBell />

      <SessionMenu userName={userName} userRoleAr="فريق الشريك" />

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
function NotificationBell() {
  // Fed by the portal-wide live-orders context, so the badge is correct on
  // every page, not only the dashboard (MERCH-4).
  const { pendingCount: count } = useLiveOrders();

  const label =
    count === 0
      ? 'لا توجد طلبات جديدة'
      : count === 1
        ? 'طلب جديد واحد بانتظار القبول'
        : `${count} طلبات جديدة بانتظار القبول`;

  /*
   * It went to `/`, which on `/` is nothing at all.
   *
   * The badge counts orders waiting for a decision, and the dashboard is where
   * they are — so from anywhere else this is a link home, and once home it has
   * to keep going: to the «طلبات جديدة» lane, which is the thing the number is
   * about and which sits below two cards on a laptop. A control that reports a
   * count and does not take you to what it counted is the one that gets
   * ignored fastest.
   */
  const goToNewOrders = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    if (window.location.pathname !== '/') return; // let the link navigate
    event.preventDefault();
    const lane = document.getElementById('lane-PENDING_RESTAURANT');
    (lane ?? document.getElementById('live-orders'))?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  return (
    <Link
      href="/#lane-PENDING_RESTAURANT"
      className="bell"
      aria-label={label}
      onClick={goToNewOrders}
    >
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
      {/*
        The initial, not an empty grey square (MERCH-31). The badge carries no
        logo URL, and a blank box read as a broken image.
      */}
      <div className="topbar__avatar topbar__avatar--initial" aria-hidden="true">
        {restaurantName.trim().charAt(0) || '؟'}
      </div>
      <div className="topbar__greeting">
        <strong>{restaurantName}</strong>
        <span>
          رقم الشريك: <span className="ltr-inline">#{partnerCode}</span>
        </span>
      </div>
      {canSwitch ? <Icon name="chevron" className="nav__icon" aria-hidden /> : null}
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
