'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  BarChart,
  DonutChart,
  money,
  moneyCompact,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  percentDelta,
  RankedBar,
  relativeAr,
} from '@jibli/ui-web';
import type { OrderStatus } from '@jibli/contracts';
import { AdminShell } from '@/components/shell';
import { Icon, type IconName } from '@/components/icon';
import { ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { admin, type AdminOverview } from '@/lib/admin-endpoints';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Admin dashboard (plan §130).
 *
 * "Cards show definitions consistently. For example, 'Platform revenue' must
 * not mix accrued commission with collected cash." Every money tile below names
 * which of the two it is, because that is exactly the distinction that gets
 * confused in a review meeting.
 *
 * The whole screen is one request. Eleven panels fetched separately would each
 * re-pay auth and connection setup for figures that are only meaningful read
 * together, and would let one slow panel make the page look broken.
 */
export default function AdminDashboardPage() {
  const session = useAdminSession();

  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => admin.overview(session.status === 'authenticated' ? session.accessToken : ''),
    enabled: session.status === 'authenticated',
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (session.status === 'loading') {
    return (
      <div style={{ padding: 'var(--space-6)' }}>
        <Skeleton height={560} />
        <span className="sr-only">جاري التحميل…</span>
      </div>
    );
  }

  if (session.status === 'unauthenticated') {
    return (
      <div className="empty" style={{ minHeight: '100vh', justifyContent: 'center' }}>
        <h1>
          {session.reason === 'NOT_PLATFORM_STAFF'
            ? 'هذا الحساب ليس ضمن فريق المنصة'
            : 'الرجاء تسجيل الدخول'}
        </h1>
        <p>
          {session.reason === 'NOT_PLATFORM_STAFF'
            ? 'لوحة الأدمن مخصّصة لموظفي جيبلي. إن كنت شريكاً استخدم بوابة المطاعم.'
            : 'انتهت الجلسة أو لم يتم تسجيل الدخول بعد.'}
        </p>
      </div>
    );
  }

  const data = overview.data;

  return (
    <AdminShell
      title={`مرحباً ${session.userName || 'بك'} 👋`}
      subtitle="هنا نظرة سريعة على أداء المنصة اليوم"
      userName={session.userName}
      userRoleAr={session.roleAr}
      pendingApplications={data?.open_applications ?? 0}
      liveOrders={data?.live_orders ?? 0}
    >
      {overview.isError ? (
        <ErrorState
          message={
            overview.error instanceof ApiError
              ? overview.error.messageAr
              : 'تعذّر تحميل بيانات اللوحة'
          }
          code={overview.error instanceof ApiError ? overview.error.code : undefined}
          onRetry={() => void overview.refetch()}
        />
      ) : null}

      <StatRow data={data} isLoading={overview.isLoading} />

      {overview.isLoading ? (
        <div className="panels">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} height={280} />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="panels">
            <StatusPanel data={data} />
            <SalesTrendPanel data={data} />
            <PerformancePanel data={data} />
          </div>

          <div className="panels">
            <CategoriesPanel data={data} />
            <ApplicationsPanel data={data} />
            <RecentOrdersPanel data={data} />
          </div>

          <div className="panels">
            <CommissionPanel data={data} />
            <ActivityPanel data={data} />
            <TopRestaurantsPanel data={data} />
          </div>
        </>
      ) : null}
    </AdminShell>
  );
}

function StatRow({ data, isLoading }: { data: AdminOverview | undefined; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="stats">
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} height={104} />
        ))}
      </div>
    );
  }

  return (
    <div className="stats">
      {/*
        "Accrued", not "collected". Commission is earned when an order
        completes; whether the restaurant has paid it is a settlement question,
        and conflating the two is the specific error plan §130 calls out.
      */}
      <StatTile
        icon="commissions"
        tone="orange"
        label="إيرادات المنصة (عمولة مستحقة اليوم)"
        value={data ? money(data.commission_today_iqd) : '—'}
        delta={data?.commission_delta ?? null}
        comparison="مقارنةً بالأمس"
      />
      <StatTile
        icon="cash"
        tone="amber"
        label="إجمالي المبيعات اليوم"
        value={data ? moneyCompact(data.sales_today_iqd) : '—'}
        delta={data?.sales_delta ?? null}
        comparison="مقارنةً بالأمس"
      />
      <StatTile
        icon="orders"
        tone="green"
        label="طلبات اليوم"
        value={data ? String(data.orders_today) : '—'}
        delta={data?.orders_delta ?? null}
        comparison="مقارنةً بالأمس"
      />
      <StatTile
        icon="users"
        tone="blue"
        label="مستخدمون نشطون"
        value={data ? new Intl.NumberFormat('en-US').format(data.active_users) : '—'}
        delta={data?.users_delta ?? null}
        comparison="نمو التسجيل مقارنةً بالشهر الماضي"
      />
      <StatTile
        icon="restaurants"
        tone="orange"
        label="مطاعم نشطة"
        value={data ? String(data.active_restaurants) : '—'}
        delta={data?.restaurants_delta ?? null}
        comparison="نمو الانضمام مقارنةً بالشهر الماضي"
      />
    </div>
  );
}

function StatTile({
  icon,
  tone,
  label,
  value,
  delta,
  comparison,
}: {
  icon: IconName;
  tone: 'orange' | 'blue' | 'green' | 'amber';
  label: string;
  value: string;
  delta: number | null;
  comparison: string;
}) {
  return (
    <div className="stat">
      <div className={`stat__icon stat__icon--${tone}`} aria-hidden>
        <Icon name={icon} className="nav__icon" />
      </div>
      <div className="stat__body">
        <span className="stat__value numeric">{value}</span>
        <span className="stat__label">{label}</span>

        {/*
          Growth from a zero baseline is not a percentage. The server sends null
          and the tile says there is nothing to compare, instead of printing an
          infinity or a fabricated number (plan §112).
        */}
        {delta === null ? (
          <span className="stat__delta" style={{ color: 'var(--text-muted)' }}>
            لا توجد فترة سابقة للمقارنة
          </span>
        ) : (
          <span className={`stat__delta stat__delta--${delta >= 0 ? 'up' : 'down'}`}>
            <span aria-hidden>{delta >= 0 ? '↑' : '↓'}</span>
            {percentDelta(delta)}
            <span>{comparison}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Panel({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: IconName;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card__header">
        <h2 className="card__title">
          <Icon name={icon} className="nav__icon" aria-hidden />
          {title}
        </h2>
        {action ? (
          <Link className="btn btn--ghost btn--sm" href={action.href}>
            {action.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function StatusPanel({ data }: { data: AdminOverview }) {
  const distribution = data.status_distribution;

  return (
    <Panel title="توزيع الطلبات حسب الحالة" icon="chart" action={{ href: '/orders', label: 'عرض الكل' }}>
      <DonutChart
        caption="توزيع طلبات اليوم حسب الحالة"
        total={distribution.total}
        totalLabel="إجمالي طلبات اليوم"
        slices={[
          { label: 'مكتمل', value: distribution.completed, color: 'var(--jibli-success-500)' },
          { label: 'في التوصيل', value: distribution.delivering, color: 'var(--jibli-orange-500)' },
          { label: 'قيد التحضير', value: distribution.preparing, color: 'var(--jibli-warning-500)' },
          { label: 'ملغي', value: distribution.cancelled, color: 'var(--jibli-danger-500)' },
        ]}
      />
    </Panel>
  );
}

function SalesTrendPanel({ data }: { data: AdminOverview }) {
  const total = data.sales_series.reduce((sum, point) => sum + point.value, 0);

  return (
    <Panel title="المبيعات خلال ٣٠ يوماً" icon="chart">
      <p style={{ margin: 0, marginBlockEnd: 'var(--space-3)' }}>
        <strong className="numeric" style={{ fontSize: 'var(--text-xl)' }}>
          {moneyCompact(total)}
        </strong>{' '}
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          إجمالي الطلبات المكتملة
        </span>
      </p>
      <AreaChart
        caption="المبيعات اليومية خلال آخر ٣٠ يوماً"
        points={data.sales_series.map((point) => ({ label: point.label, value: point.value }))}
      />
    </Panel>
  );
}

function PerformancePanel({ data }: { data: AdminOverview }) {
  const performance = data.performance;

  return (
    <Panel title="أداء المنصة" icon="reports" action={{ href: '/finance/reports', label: 'التقارير' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <PerformanceRow label="متوسط قيمة الطلب" value={money(performance.average_order_iqd)} />
        <PerformanceRow
          label="متوسط وقت التوصيل"
          value={`${performance.average_delivery_minutes} دقيقة`}
        />
        <PerformanceRow
          label="معدل إلغاء الطلبات"
          value={`${performance.cancellation_rate_percent}%`}
          tone={performance.cancellation_rate_percent > 5 ? 'danger' : 'success'}
        />
        <PerformanceRow label="طلبات جارية الآن" value={String(data.live_orders)} />
        <PerformanceRow label="طلبات انضمام مفتوحة" value={String(data.open_applications)} />
      </div>

      {/*
        Ratings are not in Release 1 (plan §3), so the panel says what is missing
        rather than showing a placeholder number someone might quote.
      */}
      <p
        style={{
          marginBlockStart: 'var(--space-3)',
          marginBlockEnd: 0,
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
        }}
      >
        التقييمات غير مفعّلة في الإصدار الأول، لذلك لا يظهر هنا متوسط تقييم.
      </p>
    </Panel>
  );
}

function PerformanceRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 'var(--space-3)',
        paddingBlockEnd: 'var(--space-2)',
        borderBlockEnd: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{label}</span>
      <strong
        className="numeric"
        style={
          tone
            ? { color: tone === 'danger' ? 'var(--jibli-danger-700)' : 'var(--jibli-success-700)' }
            : undefined
        }
      >
        {value}
      </strong>
    </div>
  );
}

function CategoriesPanel({ data }: { data: AdminOverview }) {
  const max = Math.max(1, ...data.top_categories.map((category) => category.order_count));

  return (
    <Panel title="أكثر التصنيفات طلباً" icon="categories" action={{ href: '/categories', label: 'عرض الكل' }}>
      {data.top_categories.length === 0 ? (
        <p className="empty">لا توجد طلبات خلال آخر ٣٠ يوماً</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {data.top_categories.map((category) => (
            <RankedBar
              key={category.name_ar}
              label={category.name_ar}
              value={category.order_count}
              max={max}
              format={(value) => `${value} طلب`}
            />
          ))}
        </div>
      )}

      {/*
        A restaurant can carry several cuisine tags, so these counts overlap by
        design and must not be read as a partition of total orders.
      */}
      <p
        style={{
          marginBlockStart: 'var(--space-3)',
          marginBlockEnd: 0,
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
        }}
      >
        المطعم الواحد قد يحمل أكثر من تصنيف، لذا مجموع هذه الأرقام يتجاوز عدد الطلبات.
      </p>
    </Panel>
  );
}

function ApplicationsPanel({ data }: { data: AdminOverview }) {
  return (
    <Panel
      title="طلبات انضمام جديدة"
      icon="applications"
      action={{ href: '/applications', label: 'عرض الكل' }}
    >
      {data.pending_applications.length === 0 ? (
        <p className="empty">لا توجد طلبات انضمام بانتظار المراجعة</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {data.pending_applications.map((application) => (
            <li
              key={application.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) 0',
                borderBlockEnd: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: 'block' }}>{application.display_name}</strong>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  {application.governorate_name_ar} — {application.city_name_ar} ·{' '}
                  {relativeAr(new Date(application.submitted_at))}
                </span>
              </div>
              <Link className="btn btn--primary btn--sm" href={`/applications`}>
                مراجعة
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RecentOrdersPanel({ data }: { data: AdminOverview }) {
  return (
    <Panel title="أحدث الطلبات" icon="orders" action={{ href: '/orders', label: 'عرض الكل' }}>
      {data.recent_orders.length === 0 ? (
        <p className="empty">لا توجد طلبات بعد</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">المطعم</th>
                <th scope="col">العميل</th>
                <th scope="col" className="numeric">
                  المبلغ
                </th>
                <th scope="col">الحالة</th>
                <th scope="col">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <span className="ltr-inline">{order.public_order_number}</span>
                  </td>
                  <td>{order.restaurant_name}</td>
                  <td>{order.customer_name}</td>
                  <td className="numeric">{money(order.total_iqd)}</td>
                  <td>
                    <span
                      className={`badge badge--${ORDER_STATUS_TONE[order.status as OrderStatus] ?? 'done'}`}
                    >
                      {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
                    </span>
                  </td>
                  <td>
                    <span className="ltr-inline">
                      {new Date(order.placed_at).toLocaleTimeString('ar-IQ', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function CommissionPanel({ data }: { data: AdminOverview }) {
  const total = data.commission_series.reduce((sum, point) => sum + point.value, 0);

  return (
    <Panel
      title="إيرادات المنصة (عمولة مستحقة)"
      icon="commissions"
      action={{ href: '/finance/settlements', label: 'التسويات' }}
    >
      <p style={{ margin: 0, marginBlockEnd: 'var(--space-3)' }}>
        <strong className="numeric" style={{ fontSize: 'var(--text-xl)' }}>
          {moneyCompact(total)}
        </strong>{' '}
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
          خلال آخر ٧ أيام
        </span>
      </p>

      <BarChart
        caption="العمولة المستحقة يومياً خلال آخر سبعة أيام"
        points={data.commission_series.map((point) => ({
          label: point.label,
          value: point.value,
        }))}
      />

      <p
        style={{
          marginBlockStart: 'var(--space-3)',
          marginBlockEnd: 0,
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
        }}
      >
        هذه عمولة مستحقة على الطلبات المكتملة، وليست مبالغ محصّلة. المحصّل يظهر في التسويات.
      </p>
    </Panel>
  );
}

function ActivityPanel({ data }: { data: AdminOverview }) {
  return (
    <Panel title="الأنشطة الأخيرة" icon="audit" action={{ href: '/audit', label: 'عرض الكل' }}>
      {data.activity.length === 0 ? (
        <p className="empty">لا توجد أنشطة مسجّلة</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {data.activity.map((entry) => (
            <li
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) 0',
                borderBlockEnd: '1px solid var(--border-subtle)',
              }}
            >
              <Icon name="audit" className="nav__icon" aria-hidden />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 'var(--text-sm)' }}>
                  {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  {entry.actor_name ?? 'النظام'} · {relativeAr(new Date(entry.created_at))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Arabic for the audit actions the feed can show.
 *
 * Unknown codes fall through to the raw action rather than being hidden: a new
 * action type appearing untranslated is a visible prompt to add it, whereas a
 * silently dropped row would hide activity from the people auditing it.
 */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  RESTAURANT_CREATE: 'تمت إضافة مطعم جديد',
  RESTAURANT_APPROVE: 'تم قبول طلب انضمام',
  RESTAURANT_REJECT: 'تم رفض طلب انضمام',
  RESTAURANT_SUSPEND: 'تم إيقاف مطعم',
  COMMISSION_UPDATE: 'تم تعديل نسبة عمولة',
  ORDER_CANCEL: 'تم إلغاء طلب',
  SETTLEMENT_ISSUE: 'تم إصدار كشف تسوية',
  SETTLEMENT_VOID: 'تم إلغاء كشف تسوية',
  PAYMENT_RECORD: 'تم تسجيل دفعة',
  INVENTORY_ADJUST: 'تمت تسوية مخزون',
  GEOGRAPHY_UPDATE: 'تم تعديل تغطية جغرافية',
  ROLE_ASSIGN: 'تم تعديل صلاحيات مستخدم',
  PHONE_UNMASK: 'تم كشف رقم هاتف عميل',
};

function TopRestaurantsPanel({ data }: { data: AdminOverview }) {
  return (
    <Panel
      title="أعلى المطاعم مبيعاً"
      icon="restaurants"
      action={{ href: '/restaurants', label: 'عرض الكل' }}
    >
      {data.top_restaurants.length === 0 ? (
        <p className="empty">لا توجد مبيعات خلال آخر ٣٠ يوماً</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {data.top_restaurants.map((restaurant, index) => (
            <li
              key={restaurant.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) 0',
                borderBlockEnd: '1px solid var(--border-subtle)',
              }}
            >
              {/* Rank is text, not just a coloured medal, so it survives a
                  screen reader and a monochrome print. */}
              <span
                className="rank"
                style={index === 0 ? { background: 'var(--jibli-orange-500)', color: '#fff' } : undefined}
              >
                {index + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/restaurants/${restaurant.id}`} style={{ fontWeight: 600 }}>
                  {restaurant.name}
                </Link>
                <span
                  style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}
                >
                  {restaurant.order_count} طلب
                </span>
              </div>
              <strong className="numeric">{moneyCompact(restaurant.revenue_iqd)}</strong>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
