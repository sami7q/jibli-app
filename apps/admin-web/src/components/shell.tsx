'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { dateWithWeekdayAr, JibliLogo } from '@jibli/ui-web';
import { Icon, type IconName } from './icon';
import { SessionMenu } from './session-menu';
import { NotificationBell } from './notification-bell';
import { OrderSound } from './order-sound';
import { ForbiddenState } from './ui';
import { useAdminSession, type AdminSessionState } from '@/hooks/use-session';
import { admin } from '@/lib/admin-endpoints';
import { ADMIN_SECTIONS, sectionFor, visibleTabs, type AdminSection } from '@/lib/nav';

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
  pendingActivations = 0,
  liveOrders = 0,
  actions,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  userName: string;
  userRoleAr: string;
  pendingApplications?: number;
  /** Shops that asked, from the app, to go live. Shown on the directory. */
  pendingActivations?: number;
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
  const router = useRouter();
  const bellToken = session.status === 'authenticated' ? session.accessToken : '';

  /*
   * A staff-issued password must be replaced before anything else (ADMIN-10).
   * The server refuses every route until it is, so reaching any shell-wrapped
   * page while the flag is set means landing on error boxes; send them to the
   * change screen instead. The change screen has its own bare layout and never
   * renders this shell, so this cannot loop.
   */
  useEffect(() => {
    if (session.status === 'authenticated' && session.mustChangePassword) {
      router.replace('/change-password');
    }
  }, [session, router]);

  /*
   * People waiting to become couriers, counted on every page. An application
   * from the app used to arrive with no signal anywhere in the panel, so the
   * only way to learn of one was to go and look.
   */
  const driverApplications = useQuery({
    queryKey: ['admin-driver-applications'],
    queryFn: () => admin.driverApplications(bellToken),
    enabled:
      bellToken !== '' && session.status === 'authenticated' && session.can('driver.read.global'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const badges: Record<string, number> = {
    '/applications': pendingApplications,
    '/restaurants': pendingActivations,
    '/orders/live': liveOrders,
    '/drivers': driverApplications.data?.length ?? 0,
  };
  const pathname = usePathname();
  const current = sectionFor(pathname);
  const can = session.status === 'authenticated' ? session.can : () => false;
  const currentTabs = current ? visibleTabs(current, can) : [];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <JibliLogo size={34} tone="onDark" />
          <span className="brand__tagline">جيبلي اللي تريده</span>
        </div>

        <nav
          aria-label="القائمة الرئيسية"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
        >
          {ADMIN_SECTIONS.map((section) => {
            // A section opens on the first tab this role may see, and is gone
            // when it may see none (ADMIN-11).
            const tabs = visibleTabs(section, can);
            const first = tabs[0];
            if (!first) return null;
            return (
              <NavLink
                key={section.labelAr}
                href={first.href}
                icon={section.icon}
                label={section.labelAr}
                active={current === section}
                badge={tabs.reduce((sum, tab) => sum + (badges[tab.href] ?? 0), 0)}
              />
            );
          })}
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

          {session.status === 'authenticated' && session.can('order.read.global') ? (
            <OrderSound token={bellToken} />
          ) : null}

          <NotificationBell token={bellToken} />

          <SessionMenu userName={userName} userRoleAr={userRoleAr} />
        </header>

        {current && currentTabs.length > 1 ? (
          <SectionTabs
            section={current}
            tabs={currentTabs}
            pathname={pathname}
            badges={badges}
          />
        ) : null}

        {children}

        <AdminFooter />
      </main>
    </div>
  );
}

/**
 * Global search (ADMIN-18).
 *
 * It used to be an input wired to nothing — typing an order number and pressing
 * Enter did precisely nothing. An order number («JB…» or a bare digit string)
 * goes to the orders list already filtered; anything else is treated as a shop
 * name / partner code and opens the directory on it. Both land on a screen
 * whose own search box the API already answers, so there is no new endpoint and
 * no half-built results dropdown to maintain.
 *
 * Ctrl/Cmd-K focuses it, because an operator triaging a complaint is typing an
 * order number, not reaching for a mouse. The shortcut is shown in the field so
 * it is discoverable rather than folklore.
 */
function AdminSearch() {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [value, setValue] = useState('');

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

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const term = value.trim();
    if (!term) return;
    // Route to the screen whose own search answers this, then let it read `?q=`
    // on mount (ADMIN-18): «JB…» or a short digit string is an order number; a
    // 10–11 digit string is an Iraqi phone, so a user; anything else is a shop
    // name or partner code.
    const allDigits = /^\d+$/.test(term);
    const target = /^jb/i.test(term)
      ? '/orders'
      : allDigits && term.length >= 10
        ? '/users'
        : allDigits
          ? '/orders'
          : '/restaurants';
    router.push(`${target}?q=${encodeURIComponent(term)}`);
  };

  return (
    <form className="topbar__control" onSubmit={submit} role="search">
      <Icon name="search" className="nav__icon" aria-hidden />
      <label htmlFor="admin-search" className="sr-only">
        البحث في المطاعم والطلبات والمستخدمين
      </label>
      <input
        id="admin-search"
        ref={input}
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="رقم طلب أو اسم متجر… ثم Enter"
      />
      <kbd className="kbd" aria-hidden>
        Ctrl K
      </kbd>
    </form>
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
        {/* Was a tel: to a placeholder number (+9647700000000) that dialled
            nothing; points at the support inbox instead (ADMIN-24). */}
        <a href="/support">رسائل الدعم</a>
      </nav>
    </footer>
  );
}

/**
 * The shell with a `ForbiddenState` where the content would be (ADMIN-11).
 *
 * A page the role may not open renders this rather than firing its data query
 * and showing an English «FORBIDDEN» box. The sidebar stays, so the operator
 * can step to a screen they do have.
 */
export function ForbiddenShell({
  session,
  requiredAr,
}: {
  session: Extract<AdminSessionState, { status: 'authenticated' }>;
  requiredAr?: string;
}) {
  return (
    <AdminShell title="غير مصرّح" userName={session.userName || 'مدير'} userRoleAr={session.roleAr}>
      <ForbiddenState {...(requiredAr ? { requiredAr } : {})} />
    </AdminShell>
  );
}

/**
 * The screens inside the current section, as tabs under the header.
 *
 * Exact matching: tabs share prefixes (/orders and /orders/live), so a prefix
 * match would light two at once. A detail page (an order, a shop) lights none,
 * and the sidebar still says which section it is in.
 */
function SectionTabs({
  section,
  tabs,
  pathname,
  badges,
}: {
  section: AdminSection;
  tabs: AdminSection['tabs'];
  pathname: string;
  badges: Record<string, number>;
}) {
  return (
    <nav className="section-tabs" aria-label={section.labelAr}>
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        const badge = badges[tab.href] ?? 0;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`section-tabs__tab${active ? ' section-tabs__tab--active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {tab.labelAr}
            {badge > 0 ? <span className="nav__badge">{badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function NavLink({
  href,
  icon,
  label,
  active,
  badge,
}: {
  href: string;
  icon: IconName;
  label: string;
  active: boolean;
  badge: number;
}) {
  const isActive = active;

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
