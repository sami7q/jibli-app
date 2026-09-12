'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  bpsPercent,
  money,
  moneyCompact,
  percentDelta,
  RankedBar,
} from '@jibli/ui-web';
import { Shell } from '@/components/shell';
import { LiveBoard } from '@/components/live-board';
import { Icon, type IconName } from '@/components/icon';
import { portal, type DashboardOverview } from '@/lib/portal-endpoints';
import { useSession } from '@/hooks/use-session';
import { ReadinessCard } from '@/components/readiness-card';
import { SignedOut } from '@/components/signed-out';

/**
 * Restaurant dashboard (plan §131).
 *
 * "Live operational content takes priority over decorative analytics. New
 * orders and alerts remain visible without scrolling through charts." So the
 * stat row is compact, the order board sits immediately beneath it, and every
 * chart is below the board — the operator during a rush never scrolls past
 * analytics to reach a decision.
 */
export default function DashboardPage() {
  const session = useSession();

  if (session.status === 'loading') {
    return <DashboardSkeleton />;
  }

  if (session.status === 'unauthenticated') {
    return <SignedOut reason={session.reason} />;
  }

  const auth = { accessToken: session.accessToken, restaurantId: session.restaurantId };

  return (
    <DashboardShell
      auth={auth}
      session={session}
    />
  );
}

type AuthenticatedSession = Extract<
  ReturnType<typeof useSession>,
  { status: 'authenticated' }
>;

function DashboardShell({
  auth,
  session,
}: {
  auth: { accessToken: string; restaurantId: string };
  session: AuthenticatedSession;
}) {
  const overview = useQuery({
    queryKey: ['dashboard-overview', auth.restaurantId],
    queryFn: () => portal.dashboard(auth),
    // Analytics tolerate staleness; the order board has its own live channel.
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const data = overview.data;

  return (
    <Shell
      restaurantName={session.restaurantName}
      partnerCode={session.partnerCode}
      userName={session.userName}
      restaurants={session.restaurants}
      activeRestaurantId={session.restaurantId}
      onSwitchRestaurant={session.switchRestaurant}
      notificationCount={data?.new_orders ?? 0}
    >
      {/*
        Above the board on purpose: a restaurant that is not live yet has an
        empty board, and this is the only thing on the page it can act on. It
        renders nothing once the restaurant is trading.
      */}
      <ReadinessCard auth={auth} canWrite={session.can('settings.write')} />

      <SummaryRow data={data} isLoading={overview.isLoading} />

      {/* The board comes before every chart, by design and by plan §131. */}
      <LiveBoard auth={auth} />

      <AnalyticsRow data={data} isLoading={overview.isLoading} canSeeFinance={session.can('finance.read')} />
    </Shell>
  );
}

function SummaryRow({
  data,
  isLoading,
}: {
  data: DashboardOverview | undefined;
  isLoading: boolean;
}) {
  return (
    <div className="stats">
      <StatTile
        icon="orders"
        label="طلبات اليوم"
        value={data ? String(data.orders_today) : '—'}
        delta={data?.orders_today_delta ?? null}
        loading={isLoading}
      />
      <StatTile
        icon="chart"
        label="مبيعات اليوم"
        value={data ? moneyCompact(data.sales_today_iqd) : '—'}
        delta={data?.sales_today_delta ?? null}
        loading={isLoading}
      />
      <StatTile
        icon="cash"
        label="متوسط الطلب"
        value={data ? money(data.average_order_iqd) : '—'}
        delta={data?.average_order_delta ?? null}
        loading={isLoading}
      />
      <StatTile
        icon="bell"
        label="الطلبات الجديدة"
        value={data ? String(data.new_orders) : '—'}
        delta={data?.new_orders_delta ?? null}
        loading={isLoading}
        highlight={Boolean(data && data.new_orders > 0)}
      />
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  delta,
  loading,
  highlight = false,
}: {
  icon: IconName;
  label: string;
  value: string;
  delta?: number | null;
  loading: boolean;
  highlight?: boolean;
}) {
  if (loading) return <div className="skeleton" style={{ height: 96 }} aria-hidden />;

  return (
    <div className="stat" style={highlight ? { borderColor: 'var(--jibli-orange-300)' } : undefined}>
      <div className="stat__body">
        <span className="stat__label">{label}</span>
        <span className="stat__value numeric">{value}</span>

        {/*
          A percentage needs a previous value to be a percentage at all. When
          yesterday was zero the server sends null and the tile says so, rather
          than showing an infinite or invented rise (plan §112).
        */}
        {delta === null || delta === undefined ? (
          <span className="stat__delta" style={{ color: 'var(--text-muted)' }}>
            لا توجد مقارنة بالأمس
          </span>
        ) : (
          <span className={`stat__delta stat__delta--${delta >= 0 ? 'up' : 'down'}`}>
            <span aria-hidden>{delta >= 0 ? '↑' : '↓'}</span>
            {percentDelta(delta)}
            <span>مقارنةً بالأمس</span>
          </span>
        )}
      </div>

      <div className="stat__icon" aria-hidden>
        <Icon name={icon} className="nav__icon" />
      </div>
    </div>
  );
}

function AnalyticsRow({
  data,
  isLoading,
  canSeeFinance,
}: {
  data: DashboardOverview | undefined;
  isLoading: boolean;
  canSeeFinance: boolean;
}) {
  if (isLoading) {
    return (
      <div className="analytics">
        {[0, 1, 2, 3].map((index) => (
          <div className="skeleton" key={index} style={{ height: 260 }} aria-hidden />
        ))}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="analytics">
      {canSeeFinance && data.finance ? <FinanceCard finance={data.finance} /> : null}
      <WeeklySalesCard data={data} />
      <BestSellersCard data={data} />
      <LowStockCard data={data} />
    </div>
  );
}

function FinanceCard({ finance }: { finance: NonNullable<DashboardOverview['finance']> }) {
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">
          <Icon name="settlements" className="nav__icon" aria-hidden />
          الملخص المالي
        </h2>
        <Link className="btn btn--ghost btn--sm" href="/commissions">
          عرض التفاصيل
        </Link>
      </div>

      <div className="figure">
        <span className="figure__label">
          العمولة الحالية
          {finance.commission_rate_bps !== null
            ? ` — النسبة ${bpsPercent(finance.commission_rate_bps)}`
            : ''}
        </span>
        <span className="figure__value">{money(finance.open_commission_iqd)}</span>
      </div>

      {/* Null when the role sees finance but not margin (plan §86). */}
      {finance.estimated_net_iqd !== null ? (
        <div className="figure">
          <span className="figure__label">صافي الأرباح التقديري — بعد خصم العمولة</span>
          <span className="figure__value" style={{ color: 'var(--jibli-success-700)' }}>
            {money(finance.estimated_net_iqd)}
          </span>
        </div>
      ) : null}

      <div className="figure">
        <span className="figure__label">التسوية القادمة — {finance.period_label_ar}</span>
        <span className="figure__value">
          {finance.days_until_settlement === 0
            ? 'اليوم'
            : finance.days_until_settlement === 1
              ? 'خلال يوم واحد'
              : finance.days_until_settlement === 2
                ? 'خلال يومين'
                : `خلال ${finance.days_until_settlement} أيام`}
        </span>
      </div>
    </section>
  );
}

function WeeklySalesCard({ data }: { data: DashboardOverview }) {
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">
          <Icon name="chart" className="nav__icon" aria-hidden />
          مبيعات هذا الأسبوع
        </h2>
        <strong className="numeric">{moneyCompact(data.weekly_total_iqd)}</strong>
      </div>

      <BarChart
        caption="مبيعات آخر سبعة أيام"
        points={data.weekly_series.map((day) => ({
          label: day.label_ar,
          value: day.sales_iqd,
        }))}
      />
    </section>
  );
}

function BestSellersCard({ data }: { data: DashboardOverview }) {
  const max = Math.max(1, ...data.best_sellers.map((item) => item.units_sold));

  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">
          <Icon name="menu" className="nav__icon" aria-hidden />
          الأكثر مبيعاً
        </h2>
        <Link className="btn btn--ghost btn--sm" href="/menu">
          عرض المنيو
        </Link>
      </div>

      {data.best_sellers.length === 0 ? (
        <p className="empty">لا توجد مبيعات في آخر سبعة أيام</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {data.best_sellers.map((item) => (
            <RankedBar
              key={item.menu_item_id ?? item.name_ar}
              label={item.name_ar}
              value={item.units_sold}
              max={max}
              format={(value) => `${value} طلب`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LowStockCard({ data }: { data: DashboardOverview }) {
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">
          <Icon name="inventory" className="nav__icon" aria-hidden />
          مواد منخفضة المخزون
        </h2>
        <Link className="btn btn--ghost btn--sm" href="/inventory">
          عرض كل المخزون
        </Link>
      </div>

      {data.low_stock.length === 0 ? (
        <p className="empty">لا توجد مواد منخفضة المخزون</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {data.low_stock.map((item) => (
            <li
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-2) 0',
                borderBlockEnd: '1px solid var(--border-subtle)',
              }}
            >
              {/*
                The icon is decorative: the card's own heading says these are
                low-stock rows, so colour and glyph are never the only signal
                (plan §134).
              */}
              <Icon name="alert" className="nav__icon" aria-hidden />
              <span style={{ flex: 1 }}>{item.name_ar}</span>
              <span className="numeric" style={{ color: 'var(--jibli-danger-700)', fontWeight: 700 }}>
                {item.available} {item.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div style={{ padding: 'var(--space-6)' }}>
      <div className="stats">
        {[0, 1, 2, 3].map((index) => (
          <div className="skeleton" key={index} style={{ height: 96 }} aria-hidden />
        ))}
      </div>
      <div className="skeleton" style={{ height: 400, marginTop: 20 }} aria-hidden />
      <span className="sr-only">جاري التحميل…</span>
    </div>
  );
}
