'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { money } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { portal, type OpenCommissions } from '@/lib/portal-endpoints';

/**
 * Running commission (plan §39, §42).
 *
 * The plan requires commission to be visible *as it accrues*, not only when a
 * statement arrives. This screen shows every completed order that no statement
 * has claimed yet, with the rate that was snapshotted onto it, so nothing about
 * the next bill is a surprise.
 *
 * An order appears here exactly until a settlement line is written for it — the
 * database enforces one line per order, so an order can never be counted both
 * here and on an issued statement.
 */
export default function CommissionsPage() {
  return (
    <PortalPage permission="finance.read" permissionLabelAr="قراءة البيانات المالية">
      {({ auth }) => <CommissionsScreen auth={auth} />}
    </PortalPage>
  );
}

function CommissionsScreen({ auth }: { auth: PortalAuth }) {
  const open = useQuery({
    queryKey: ['open-commissions', auth.restaurantId],
    queryFn: () => portal.openCommissions(auth),
  });

  if (open.isError) {
    return (
      <ErrorState
        message={open.error instanceof ApiError ? open.error.messageAr : 'تعذّر تحميل العمولات'}
        code={open.error instanceof ApiError ? open.error.code : undefined}
        onRetry={() => void open.refetch()}
      />
    );
  }

  if (open.isLoading || !open.data) return <Skeleton height={420} />;

  const data = open.data;
  /*
   * The commission is a flat fee, so the figure worth showing is what it costs
   * per order — not a percentage. It equals the configured fee except on an
   * order too small to carry it, where the fee is capped at what the restaurant
   * earned; averaging makes that visible instead of hiding it.
   */
  const feePerOrder =
    data.order_count > 0 ? Math.round(data.commission_total_iqd / data.order_count) : 0;

  return (
    <>
      <Card
        title="المستحق لجيبلي"
        icon="commissions"
        subtitle="يتراكم مع كل طلب مكتمل، ويصبح صفراً عند استلام الإدارة للمبلغ"
        actions={
          <Link className="btn btn--ghost btn--sm" href="/settlements">
            الكشوف الصادرة
          </Link>
        }
      >
        <p className="alert-bar alert-bar--warning" role="status">
          <span style={{ flex: 1 }}>{data.note_ar}</span>
        </p>

        <div className="split" style={{ marginBlockStart: 'var(--space-4)' }}>
          <div className="figure">
            <span className="figure__label">المبلغ المتراكم لجيبلي</span>
            <span className="figure__value">
              {money(data.platform_due_iqd ?? data.commission_total_iqd)}
            </span>
          </div>
          <div className="figure">
            <span className="figure__label">منها العمولة</span>
            <span className="figure__value">{money(data.commission_total_iqd)}</span>
          </div>
          <div className="figure">
            <span className="figure__label">منها رسوم الخدمة</span>
            <span className="figure__value">{money(data.service_fee_total_iqd ?? 0)}</span>
          </div>
          <div className="figure">
            <span className="figure__label">عدد الطلبات</span>
            <span className="figure__value">{data.order_count}</span>
          </div>
          <div className="figure">
            <span className="figure__label">إجمالي المبيعات</span>
            <span className="figure__value">{money(data.gross_sales_iqd)}</span>
          </div>
          <div className="figure">
            <span className="figure__label">صافي المطعم</span>
            <span className="figure__value">{money(data.restaurant_net_iqd)}</span>
          </div>
          <div className="figure">
            <span className="figure__label">العمولة لكل طلب</span>
            <span className="figure__value">{money(feePerOrder)}</span>
          </div>
          <div className="figure">
            <span className="figure__label">نظام التسوية</span>
            <span className="figure__value" style={{ fontSize: 'var(--text-sm)' }}>
              {data.policy === 'MONTHLY' ? 'شهري' : data.policy ? 'نصف شهري' : '—'}
            </span>
          </div>
        </div>

        <PeriodNote data={data} />
      </Card>

      <Card
        title="تفصيل الطلبات"
        subtitle="أساس العمولة لكل طلب وقيمة العمولة المسجّلة عليه وقت الاكتمال"
      >
        {data.orders.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0, fontWeight: 600 }}>لا يوجد مبلغ متراكم لجيبلي</p>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              كل الطلبات المكتملة مُدرجة في كشوف صادرة.
            </p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">رقم الطلب</th>
                    <th scope="col">اكتمل في</th>
                    <th scope="col" className="numeric">
                      إجمالي الطلب
                    </th>
                    <th scope="col" className="numeric">
                      أجرة التوصيل
                    </th>
                    <th scope="col" className="numeric">
                      أساس العمولة
                    </th>
                    <th scope="col" className="numeric">
                      العمولة
                    </th>
                    <th scope="col" className="numeric">
                      رسوم الخدمة
                    </th>
                    <th scope="col" className="numeric">
                      صافيك
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <span className="ltr-inline">{order.public_order_number}</span>
                      </td>
                      <td>
                        <span className="ltr-inline">
                          {order.completed_at ? formatDateTime(order.completed_at) : '—'}
                        </span>
                      </td>
                      <td className="numeric">{money(order.customer_total_iqd)}</td>
                      <td className="numeric">{money(order.delivery_fee_iqd)}</td>
                      <td className="numeric">{money(order.commission_base_iqd)}</td>
                      <td className="numeric" style={{ color: 'var(--jibli-danger-700)' }}>
                        {money(order.commission_amount_iqd)}
                      </td>
                      <td className="numeric" style={{ color: 'var(--jibli-danger-700)' }}>
                        {money(order.service_fee_iqd ?? 0)}
                      </td>
                      <td className="numeric">
                        <strong>{money(order.restaurant_net_iqd)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.truncated ? (
              <p
                className="alert-bar alert-bar--warning"
                style={{ marginBlockStart: 'var(--space-3)' }}
              >
                <span style={{ flex: 1 }}>
                  معروض {data.orders.length} طلباً من أصل {data.order_count}. المجاميع أعلاه تشمل
                  الطلبات كلها، لا المعروض منها فقط.
                </span>
              </p>
            ) : null}
          </>
        )}

        {/*
          Delivery fees are outside the commission base — the plan's Appendix E
          worked example depends on it, and stating it here stops the recurring
          "why doesn't the rate match my total" question.
        */}
        <p
          style={{
            marginBlockStart: 'var(--space-3)',
            marginBlockEnd: 0,
            fontSize: 'var(--text-xs)',
            color: 'var(--text-muted)',
          }}
        >
          العمولة قيمة ثابتة عن كل طلب، لا تزيد بزيادة قيمة الطلب. وهي لا تتجاوز أساس العمولة — قيمة
          الأصناف بعد الخصومات التي يموّلها المطعم، دون أجرة التوصيل. القيمة المطبّقة على كل طلب هي
          المسجّلة وقته ولا تتغيّر بعد ذلك.
        </p>
      </Card>
    </>
  );
}

function PeriodNote({ data }: { data: OpenCommissions }) {
  if (data.order_count === 0) return null;

  return (
    <p
      style={{
        marginBlockStart: 'var(--space-3)',
        marginBlockEnd: 0,
        fontSize: 'var(--text-sm)',
        color: 'var(--text-secondary)',
      }}
    >
      {data.first_completed_at ? (
        <>
          يشمل الطلبات المكتملة من{' '}
          <span className="ltr-inline">{formatDate(data.first_completed_at)}</span>
          {data.last_completed_at ? (
            <>
              {' '}
              إلى <span className="ltr-inline">{formatDate(data.last_completed_at)}</span>
            </>
          ) : null}
          .
        </>
      ) : null}
      {data.last_settled_period_end ? (
        <>
          {' '}
          آخر كشف صادر انتهت فترته في{' '}
          <span className="ltr-inline">{formatDate(data.last_settled_period_end)}</span>.
        </>
      ) : (
        ' لم يصدر أي كشف بعد.'
      )}
    </p>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-IQ', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' });
}
