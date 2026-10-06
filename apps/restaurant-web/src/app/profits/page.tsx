'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@jibli/contracts';
import { EXPENSE_CATEGORY_LABELS, money, NumberField } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { portal, type ProfitSummary } from '@/lib/portal-endpoints';

/**
 * Profit report (plan §38).
 *
 * The plan is emphatic that this figure is an *estimate* whenever cost prices
 * are missing, and that the portal must say so rather than present a confident
 * number. The server computes the coverage percentage; this screen leads with
 * it instead of burying it in a footnote.
 *
 * The arithmetic shown here is the server's, restated for the reader — the page
 * never recomputes profit from parts, because two formulas would eventually
 * disagree and the restaurant would be told two different numbers.
 */

const PERIODS = [
  { days: 7, label: 'آخر ٧ أيام' },
  { days: 30, label: 'آخر ٣٠ يوماً' },
  { days: 90, label: 'آخر ٩٠ يوماً' },
] as const;

export default function ProfitsPage() {
  return (
    <PortalPage permission="profit.read" permissionLabelAr="قراءة الأرباح">
      {({ auth, can }) => <ProfitScreen auth={auth} canWriteExpenses={can('expense.write')} />}
    </PortalPage>
  );
}

function ProfitScreen({ auth, canWriteExpenses }: { auth: PortalAuth; canWriteExpenses: boolean }) {
  const [days, setDays] = useState<number>(30);
  const [addingExpense, setAddingExpense] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const queryClient = useQueryClient();

  const profit = useQuery({
    queryKey: ['profit', auth.restaurantId, days],
    queryFn: () => portal.profit(auth, days),
  });

  const expenses = useQuery({
    queryKey: ['expenses', auth.restaurantId, category],
    queryFn: () => portal.expenses(auth, category ? { category } : {}),
  });

  return (
    <>
      <Card
        title="الأرباح"
        icon="profits"
        subtitle="صافي المبيعات بعد التكلفة والعمولة والمصاريف"
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {PERIODS.map((period) => (
              <button
                key={period.days}
                type="button"
                className={`btn btn--${days === period.days ? 'primary' : 'ghost'} btn--sm`}
                onClick={() => setDays(period.days)}
                aria-pressed={days === period.days}
              >
                {period.label}
              </button>
            ))}
          </div>
        }
      >
        {profit.isLoading ? <Skeleton height={280} /> : null}

        {profit.isError ? (
          <ErrorState
            message={
              profit.error instanceof ApiError
                ? profit.error.messageAr
                : 'تعذّر تحميل تقرير الأرباح'
            }
            code={profit.error instanceof ApiError ? profit.error.code : undefined}
            onRetry={() => void profit.refetch()}
          />
        ) : null}

        {profit.data ? <ProfitBody summary={profit.data} days={days} /> : null}
      </Card>

      <Card
        title="مصاريف التشغيل"
        subtitle="الرواتب والإيجار والمشتريات وغيرها — تُطرح من الربح الإجمالي"
        actions={
          canWriteExpenses ? (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => setAddingExpense(true)}
            >
              تسجيل مصروف
            </button>
          ) : null
        }
      >
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBlockEnd: 'var(--space-4)' }}>
          <div className="topbar__control">
            <label htmlFor="expense-category" className="sr-only">
              تصفية حسب نوع المصروف
            </label>
            <select
              id="expense-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as ExpenseCategory | '')}
              style={{
                border: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: 'var(--text-sm)',
                outline: 'none',
              }}
            >
              <option value="">كل الأنواع</option>
              {EXPENSE_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {EXPENSE_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {expenses.isLoading ? <Skeleton height={200} /> : null}

        {expenses.isError ? (
          <ErrorState
            message={
              expenses.error instanceof ApiError ? expenses.error.messageAr : 'تعذّر تحميل المصاريف'
            }
            onRetry={() => void expenses.refetch()}
          />
        ) : null}

        {expenses.data ? (
          <ExpensesTable rows={expenses.data.rows} totalIqd={expenses.data.totalIqd} />
        ) : null}
      </Card>

      {addingExpense ? (
        <ExpenseDialog
          auth={auth}
          onDone={() => {
            setAddingExpense(false);
            void queryClient.invalidateQueries({ queryKey: ['expenses'] });
            void queryClient.invalidateQueries({ queryKey: ['profit'] });
          }}
          onCancel={() => setAddingExpense(false)}
        />
      ) : null}
    </>
  );
}

function ProfitBody({ summary, days }: { summary: ProfitSummary; days: number }) {
  const profitable = summary.estimated_operating_profit_iqd > 0;

  return (
    <>
      {/*
        Coverage first. A profit number built on 40% cost data is a different
        claim from one built on 100%, and the plan requires the difference to be
        visible rather than implied.
      */}
      <p
        className={`alert-bar alert-bar--${summary.is_estimate ? 'warning' : 'success'}`}
        role="status"
      >
        <span style={{ flex: 1 }}>{summary.note_ar}</span>
      </p>

      <div className="split" style={{ marginBlockStart: 'var(--space-4)' }}>
        <div className="figure">
          <span className="figure__label">عدد الطلبات المكتملة</span>
          <span className="figure__value">{summary.order_count}</span>
        </div>
        <div className="figure">
          <span className="figure__label">صافي المبيعات</span>
          <span className="figure__value">{money(summary.net_sales_iqd)}</span>
        </div>
        <div className="figure">
          <span className="figure__label">أجور التوصيل المحصّلة</span>
          <span className="figure__value">{money(summary.delivery_fees_iqd)}</span>
        </div>
      </div>

      <div className="table-wrap" style={{ marginBlockStart: 'var(--space-4)' }}>
        <table className="table">
          <caption className="sr-only">تفصيل احتساب الربح التشغيلي خلال {days} يوماً</caption>
          <thead>
            <tr>
              <th scope="col">البند</th>
              <th scope="col" className="numeric">
                المبلغ
              </th>
              <th scope="col">ملاحظة</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>صافي المبيعات</td>
              <td className="numeric">{money(summary.net_sales_iqd)}</td>
              <td>قيمة الأصناف بعد الخصومات، بدون أجور التوصيل</td>
            </tr>
            <tr>
              <td>‏− تكلفة البضاعة المباعة</td>
              <td className="numeric" style={{ color: 'var(--jibli-danger-700)' }}>
                {money(summary.cost_of_goods_iqd)}
              </td>
              <td>
                من أسعار التكلفة المسجّلة في المنيو ({summary.cost_data_coverage_percent}% تغطية)
              </td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>= الربح الإجمالي</td>
              <td className="numeric">{money(summary.gross_profit_iqd)}</td>
              <td>قبل العمولة والمصاريف</td>
            </tr>
            <tr>
              <td>‏− عمولة جيبلي</td>
              <td className="numeric" style={{ color: 'var(--jibli-danger-700)' }}>
                {money(summary.commission_iqd)}
              </td>
              <td>المستحقة على طلبات هذه الفترة</td>
            </tr>
            <tr>
              <td>‏− مصاريف التشغيل</td>
              <td className="numeric" style={{ color: 'var(--jibli-danger-700)' }}>
                {money(summary.operating_expenses_iqd)}
              </td>
              <td>ما سجّلته أدناه خلال الفترة نفسها</td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>= الربح التشغيلي {summary.is_estimate ? 'التقديري' : ''}</td>
              <td
                className="numeric"
                style={{
                  color: profitable ? 'var(--jibli-success-700)' : 'var(--jibli-danger-700)',
                }}
              >
                {money(summary.estimated_operating_profit_iqd)}
              </td>
              <td>
                {profitable
                  ? 'بعد خصم كل ما سبق'
                  : 'خسارة خلال هذه الفترة — راجع التكاليف والمصاريف'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p
        style={{
          marginBlockStart: 'var(--space-3)',
          marginBlockEnd: 0,
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
        }}
      >
        هذا تقرير تشغيلي لمساعدتك على القرار، وليس بياناً محاسبياً معتمداً. المرجع في المستحق لجيبلي
        هو كشف العمولات في صفحة التسويات.
      </p>
    </>
  );
}

function ExpensesTable({
  rows,
  totalIqd,
}: {
  rows: {
    id: string;
    category: string;
    amount_iqd: number;
    description_ar: string | null;
    expense_date: string;
    created_by: string | null;
  }[];
  totalIqd: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="empty">
        <p style={{ margin: 0, fontWeight: 600 }}>لا توجد مصاريف مسجّلة</p>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
          تسجيل الرواتب والإيجار والمشتريات يجعل رقم الربح أقرب إلى الواقع.
        </p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">النوع</th>
            <th scope="col" className="numeric">
              المبلغ
            </th>
            <th scope="col">الوصف</th>
            <th scope="col">التاريخ</th>
            <th scope="col">سجّلها</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((expense) => (
            <tr key={expense.id}>
              <td>
                {EXPENSE_CATEGORY_LABELS[expense.category as ExpenseCategory] ?? expense.category}
              </td>
              <td className="numeric">{money(expense.amount_iqd)}</td>
              <td>{expense.description_ar ?? '—'}</td>
              <td>
                <span className="ltr-inline">{expense.expense_date}</span>
              </td>
              <td>{expense.created_by ?? '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700 }}>
            <td>الإجمالي</td>
            <td className="numeric">{money(totalIqd)}</td>
            <td colSpan={3}>
              {/* The server's total covers every matching row, not just this page. */}
              مجموع كل المصاريف المطابقة للتصفية
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ExpenseDialog({
  auth,
  onDone,
  onCancel,
}: {
  auth: PortalAuth;
  onDone: () => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [category, setCategory] = useState<ExpenseCategory>('INGREDIENTS');
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(today);

  const create = useMutation({
    mutationFn: () =>
      portal.createExpense(auth, {
        category,
        amount_iqd: amount,
        description_ar: description.trim() || undefined,
        expense_date: date,
      }),
    onSuccess: onDone,
  });

  const amountInvalid = !Number.isInteger(amount) || amount <= 0;
  // A future-dated expense would land in a period that has not happened yet.
  const dateInvalid = date > today;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="exp-title">
      <div className="dialog">
        <h2 id="exp-title">تسجيل مصروف</h2>

        <div className="field">
          <label htmlFor="exp-cat">نوع المصروف</label>
          <select
            id="exp-cat"
            value={category}
            onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
          >
            {EXPENSE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {EXPENSE_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="exp-amount">المبلغ (دينار)</label>
          <NumberField
            id="exp-amount"
            min={0}
            value={amount}
            onChange={(value) => setAmount(value)}
            aria-invalid={amountInvalid}
          />
          {amountInvalid ? (
            <span className="field__error">المبلغ يجب أن يكون رقماً صحيحاً أكبر من صفر</span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="exp-date">تاريخ المصروف</label>
          <input
            id="exp-date"
            type="date"
            max={today}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            aria-invalid={dateInvalid}
          />
          {dateInvalid ? (
            <span className="field__error">لا يمكن تسجيل مصروف بتاريخ مستقبلي</span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="exp-desc">الوصف (اختياري)</label>
          <input
            id="exp-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="فاتورة كهرباء شهر أيلول"
          />
        </div>

        {create.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {create.error instanceof ApiError ? create.error.messageAr : 'تعذّر حفظ المصروف'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={amountInvalid || dateInvalid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'جاري الحفظ…' : 'حفظ'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
