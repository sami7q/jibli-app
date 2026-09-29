'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateAr, dateTimeAr, money } from '@jibli/ui-web';
import { Card, DataTable, ErrorState, MfaChallenge, Money, Skeleton } from '@/components/ui';
import { Dropdown } from '@/components/dropdown';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type Collectable, type CollectionArchive } from '@/lib/admin-endpoints';

/**
 * Collecting the platform's profit from each shop, and the archive of it.
 *
 * Profit is the commission plus the service fee: orders are paid in cash to
 * the shop's courier, so both sit at the shop until somebody collects them.
 *
 * The commission a restaurant owes accumulates order by order; at some point
 * somebody hands over cash. This is that moment, and it has to do three things
 * atomically or the screen and the books stop agreeing: the outstanding figure
 * goes to zero, the orders behind it stop counting as outstanding, and the
 * amount lands somewhere permanent.
 *
 * Behind it, a collection is a settlement issued and paid in one step — not a
 * second kind of record. The restaurant sees the same statement in its own
 * portal, and reconciliation checks it like any other.
 */
export function CollectionPanel({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [collecting, setCollecting] = useState<Collectable | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [receipt, setReceipt] = useState<{ amount: number; orders: number; name: string } | null>(
    null,
  );

  const collectable = useQuery({
    queryKey: ['admin-collectable'],
    queryFn: () => admin.collectable(token),
  });

  const archive = useQuery({
    queryKey: ['admin-collections'],
    queryFn: () => admin.collections(token),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-collectable'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-collections'] });
    // The commission overview reads the same orders; leaving it stale would
    // show money as outstanding that was just collected.
    void queryClient.invalidateQueries({ queryKey: ['admin-commission-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-finance-summary'] });
  };

  const pending = collectable.data ?? [];
  const outstanding = pending.reduce((sum, row) => sum + profitOf(row), 0);
  const collected = archive.data?.total_collected_iqd ?? 0;

  return (
    <>
      <Card
        title="الأرباح غير المحصّلة"
        icon="commissions"
        subtitle="العمولة ورسوم الخدمة المتجمّعة لدى كل متجر من الطلبات المكتملة"
      >
        {collectable.isError ? (
          <ErrorState
            message={
              collectable.error instanceof ApiError
                ? collectable.error.messageAr
                : 'تعذّر تحميل المستحقات'
            }
            onRetry={() => void collectable.refetch()}
          />
        ) : collectable.isLoading ? (
          <Skeleton height={200} />
        ) : (
          <>
            <div className="kpi-row" style={{ marginBlockEnd: 'var(--space-4)' }}>
              <div className="kpi kpi--warning">
                <span className="kpi__label">بانتظار التحصيل</span>
                <span className="kpi__value">{money(outstanding)}</span>
                <span className="kpi__note">
                  من {pending.length} {pending.length === 1 ? 'متجر' : 'متاجر'}
                </span>
              </div>
              <div className="kpi kpi--primary">
                <span className="kpi__label">محصّل في الأرشيف</span>
                <span className="kpi__value">{money(collected)}</span>
                <span className="kpi__note">مجموع كل عمليات التحصيل</span>
              </div>
            </div>

            {pending.length === 0 ? (
              <p className="empty">لا توجد أرباح غير محصّلة. كل ما اكتمل تم تحصيله.</p>
            ) : (
              <DataTable<Collectable>
                caption="الأرباح المستحقة لكل متجر"
                rows={pending}
                keyOf={(row) => row.restaurant_id}
                emptyMessage="لا شيء للتحصيل"
                columns={[
                  {
                    key: 'name',
                    header: 'المتجر',
                    render: (row) => (
                      <Link
                        href={`/restaurants/${row.restaurant_id}`}
                        style={{ color: 'inherit', fontWeight: 700 }}
                      >
                        {row.display_name}
                      </Link>
                    ),
                  },
                  {
                    key: 'orders',
                    header: 'طلبات',
                    numeric: true,
                    render: (row) => row.order_count,
                  },
                  {
                    key: 'since',
                    header: 'منذ',
                    render: (row) => (row.oldest_order_at ? dateAr(row.oldest_order_at) : '—'),
                  },
                  {
                    key: 'commission',
                    header: 'العمولة',
                    numeric: true,
                    render: (row) => <Money amount={row.commission_iqd} />,
                  },
                  {
                    key: 'service',
                    header: 'رسوم الخدمة',
                    numeric: true,
                    render: (row) => <Money amount={row.service_fee_iqd ?? 0} />,
                  },
                  {
                    key: 'amount',
                    header: 'إجمالي الأرباح',
                    numeric: true,
                    render: (row) => (
                      <strong style={{ color: 'var(--jibli-warning-700)' }}>
                        <Money amount={profitOf(row)} />
                      </strong>
                    ),
                  },
                  {
                    key: 'action',
                    header: '',
                    render: (row) => (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => setCollecting(row)}
                      >
                        جمع الأرباح
                      </button>
                    ),
                  },
                ]}
              />
            )}
          </>
        )}
      </Card>

      <Card
        title="أرشيف الأرباح"
        icon="invoices"
        subtitle="كل عملية تحصيل، بالمبلغ والطلبات التي غطّاها"
      >
        {archive.isError ? (
          <ErrorState
            message={
              archive.error instanceof ApiError ? archive.error.messageAr : 'تعذّر تحميل الأرشيف'
            }
            onRetry={() => void archive.refetch()}
          />
        ) : archive.isLoading ? (
          <Skeleton height={200} />
        ) : (
          <DataTable<CollectionArchive['collections'][number]>
            caption="سجل التحصيل"
            rows={archive.data?.collections ?? []}
            keyOf={(row) => row.settlement_id}
            emptyMessage="لم يُحصَّل شيء بعد"
            columns={[
              {
                key: 'date',
                header: 'التاريخ',
                render: (row) => (row.collected_at ? dateTimeAr(row.collected_at) : '—'),
              },
              {
                key: 'restaurant',
                header: 'المطعم',
                render: (row) => (
                  <Link href={`/restaurants/${row.restaurant_id}`} style={{ color: 'inherit' }}>
                    {row.restaurant_name}
                  </Link>
                ),
              },
              { key: 'orders', header: 'طلبات', numeric: true, render: (row) => row.order_count },
              {
                key: 'sales',
                header: 'مبيعات الفترة',
                numeric: true,
                render: (row) => <Money amount={row.gross_sales_iqd} />,
              },
              {
                key: 'amount',
                header: 'المحصّل',
                numeric: true,
                render: (row) => (
                  <strong style={{ color: 'var(--jibli-success-700)' }}>
                    <Money amount={row.amount_iqd} />
                  </strong>
                ),
              },
              {
                key: 'method',
                header: 'الطريقة',
                render: (row) => METHOD_LABELS[row.method ?? ''] ?? row.method ?? '—',
              },
              {
                key: 'by',
                header: 'سجّلها',
                render: (row) => row.recorded_by ?? '—',
              },
              {
                key: 'statement',
                header: '',
                render: (row) => (
                  <Link
                    className="btn btn--ghost btn--sm"
                    href={`/finance/settlements/${row.settlement_id}`}
                  >
                    الكشف
                  </Link>
                ),
              },
            ]}
          />
        )}
      </Card>

      {collecting ? (
        <CollectDialog
          token={token}
          target={collecting}
          onDone={(result) => {
            setCollecting(null);
            setReceipt(result);
            refresh();
          }}
          onNeedsMfa={() => {
            setCollecting(null);
            setNeedsMfa(true);
          }}
          onCancel={() => setCollecting(null)}
        />
      ) : null}

      {receipt ? (
        <div className="dialog-backdrop" role="dialog" aria-modal="true">
          <div className="dialog">
            <h2>تم التحصيل</h2>
            <div className="figure">
              <span className="figure__label">المبلغ</span>
              <span className="figure__value">{money(receipt.amount)}</span>
            </div>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              من <strong>{receipt.name}</strong> عن {receipt.orders} طلباً. صارت الأرباح المعلّقة
              لهذا المتجر صفراً، وأُضيف المبلغ إلى أرشيف الأرباح.
            </p>
            <div className="dialog__actions">
              <button type="button" className="btn btn--primary" onClick={() => setReceipt(null)}>
                تمام
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {needsMfa ? (
        <MfaChallenge onVerified={() => setNeedsMfa(false)} onCancel={() => setNeedsMfa(false)} />
      ) : null}
    </>
  );
}

/** Commission plus service fee; an older API sends commission alone. */
function profitOf(row: Collectable): number {
  return row.profit_iqd ?? row.commission_iqd + (row.service_fee_iqd ?? 0);
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'نقداً',
  BANK_TRANSFER: 'حوالة',
  CHEQUE: 'صك',
  OTHER: 'أخرى',
};

function CollectDialog({
  token,
  target,
  onDone,
  onNeedsMfa,
  onCancel,
}: {
  token: string;
  target: Collectable;
  onDone: (result: { amount: number; orders: number; name: string }) => void;
  onNeedsMfa: () => void;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'OTHER'>('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const collect = useMutation({
    mutationFn: () =>
      admin.collect(token, {
        restaurant_id: target.restaurant_id,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (result) =>
      onDone({
        amount: result.collected_iqd,
        orders: result.order_count,
        name: target.display_name,
      }),
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) onNeedsMfa();
    },
  });

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="collect-title"
    >
      <div className="dialog">
        <h2 id="collect-title">تحصيل من {target.display_name}</h2>

        <div className="figure">
          <span className="figure__label">الأرباح المستحقة</span>
          <span className="figure__value">{money(profitOf(target))}</span>
        </div>

        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          عمولة {money(target.commission_iqd)} + رسوم خدمة {money(target.service_fee_iqd ?? 0)}
        </p>

        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          عن <strong>{target.order_count}</strong> طلباً مكتملاً
          {target.oldest_order_at ? ` منذ ${dateAr(target.oldest_order_at)}` : ''}.
        </p>

        <Dropdown
          value={method}
          onChange={(value) => setMethod((value || 'CASH') as typeof method)}
          label="طريقة الاستلام"
          options={[
            { value: 'CASH', label: 'نقداً' },
            { value: 'BANK_TRANSFER', label: 'حوالة بنكية' },
            { value: 'OTHER', label: 'أخرى' },
          ]}
        />

        <div className="field">
          <label htmlFor="collect-ref">رقم المرجع (اختياري)</label>
          <input
            id="collect-ref"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="رقم الحوالة أو الإيصال"
          />
        </div>

        <div className="field">
          <label htmlFor="collect-note">ملاحظة (اختياري)</label>
          <textarea
            id="collect-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <div className="dialog__impact">
          <strong>
            <Icon name="alert" className="nav__icon" aria-hidden /> ماذا يحدث
          </strong>
          <p style={{ margin: 0 }}>
            يُنشأ كشف بهذه الطلبات، تُضاف إليه رسوم الخدمة، ويُسجَّل مدفوعاً بالكامل. تصبح الأرباح
            المعلّقة لهذا المتجر صفراً، ويظهر الكشف للمطعم في بوابته. التسجيل لا يُحذف ولا يُعدَّل —
            يُصحَّح بقيد مقابل إن لزم.
          </p>
        </div>

        {collect.error && !(collect.error instanceof ApiError && collect.error.needsReauth) ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {collect.error instanceof ApiError ? collect.error.messageAr : 'تعذّر التحصيل'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={collect.isPending}
            onClick={() => collect.mutate()}
          >
            {collect.isPending ? 'جاري التحصيل…' : `تأكيد استلام ${money(profitOf(target))}`}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
