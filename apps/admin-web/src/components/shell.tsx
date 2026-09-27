'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { ADMIN_NAV, dateWithWeekdayAr, JibliLogo } from '@jibli/ui-web';
import { Icon, type IconName } from './icon';
import { SessionMenu } from './session-menu';
import { NotificationBell } from './notification-bell';
import { useAdminSession } from '@/hooks/use-session';
import { admin } from '@/lib/admin-endpoints';

/**
 * Admin shell (plan §130).
 *
 * Navigation is grouped exactly as the plan lists it: restaurants, orders,
 * users, finance, coverage, settings. Badge counts surface work waiting on an
 * operator without them having to open each section.
 */

export function AdminShell({
  children,
  title,
  subtitle,
  userName,
  userRoleAr,
  pendingApplications = 0,
  liveOrders = 0,
  actions,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  userName: string;
  userRoleAr: string;
  pendingApplications?: number;
  liveOrders?: number;
  actions?: React.ReactNode;
}) {
  /*
   * The bell reads the session itself rather than taking a token prop. Every
   * screen renders this shell, and threading a token through nineteen pages to
   * reach one component in the header is how a prop ends up missing on the
   * twentieth.
   */
  const session = useAdminSession();
  const bellToken = session.status === 'authenticated' ? session.accessToken : '';

  /*
   * People waiting to become couriers, counted on every page. An application
   * from the app used to arrive with no signal anywhere in the panel, so the
   * only way to learn of one was to go and look.
   */
  const driverApplications = useQuery({
    queryKey: ['admin-driver-applications'],
    queryFn: () => admin.driverApplications(bellToken),
    enabled: bellToken !== '' && session.status === 'authenticated' && session.can('driver.read.global'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const badges: Record<string, number> = {
    '/applications': pendingApplications,
    '/orders/live': liveOrders,
    '/drivers': driverApplications.data?.length ?? 0,
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <JibliLogo size={34} tone="onDark" />
          <span className="brand__tagline">جيبلي اللي تريده</span>
        </div>

        <nav aria-label="القائمة الرئيسية" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {ADMIN_NAV.map((section, index) => (
            <div className="nav-group" key={section.group ?? `root-${index}`}>
              {section.group ? <div className="nav-group__title">{section.group}</div> : null}
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon as IconName}
                  label={item.labelAr}
                  badge={badges[item.href] ?? 0}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__support">
          <Icon name="support" className="nav__icon" aria-hidden />
          <div>
            <strong>الدعم الفني</strong>
            <span>تواصل مع الفريق</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>

          <div className="topbar__spacer" />

          {actions}

          <div className="topbar__control">
            <Icon name="clock" className="nav__icon" aria-hidden />
            <span>{dateWithWeekdayAr(new Date())}</span>
          </div>

          <AdminSearch />

          <NotificationBell token={bellToken} />

          <SessionMenu userName={userName} userRoleAr={userRoleAr} />

        </header>

        {children}

        <AdminFooter />
      </main>
    </div>
  );
}

/**
 * Global search.
 *
 * Ctrl/Cmd-K focuses it, because an operator triaging a complaint is typing an
 * order number, not reaching for a mouse. The shortcut is shown in the field so
 * it is discoverable rather than folklore.
 */
function AdminSearch() {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="topbar__control">
      <Icon name="search" className="nav__icon" aria-hidden />
      <label htmlFor="admin-search" className="sr-only">
        البحث في المطاعم والطلبات والمستخدمين
      </label>
      <input
        id="admin-search"
        ref={input}
        type="search"
        placeholder="البحث في المطاعم، الطلبات، المستخدمين ..."
      />
      <kbd className="kbd" aria-hidden>
        Ctrl K
      </kbd>
    </div>
  );
}

function AdminFooter() {
  return (
    <footer className="footer">
      <span>
        <span className="ltr-inline">v1.0.0</span> — جميع الحقوق محفوظة{' '}
        <span className="ltr-inline">Jibli © 2026</span>
      </span>
      <span>معاً نبني تجربة توصيل أفضل</span>
      <nav aria-label="روابط مساعدة">
        <a href="/settings">إعدادات المنصة</a>
        <a href="/audit">السجلات</a>
        <a href="tel:+9647700000000">تواصل معنا</a>
      </nav>
    </footer>
  );
}

function NavLink({
  href,
  icon,
  label,
  badge,
}: {
  href: string;
  icon: IconName;
  label: string;
  badge: number;
}) {
  const pathname = usePathname();
  // Exact match everywhere: admin sections share prefixes (/orders vs
  // /orders/live), and a prefix match would highlight two links at once.
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={`nav__link${isActive ? ' nav__link--active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon name={icon} className="nav__icon" aria-hidden />
      <span>{label}</span>
      {badge > 0 ? (
        <span className="nav__badge">
          {badge}
          <span className="sr-only">عنصر بانتظار المراجعة</span>
        </span>
      ) : null}
    </Link>
  );
}
