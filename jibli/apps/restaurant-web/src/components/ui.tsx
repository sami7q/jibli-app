'use client';

import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icon';

/**
 * Shared Admin Portal primitives.
 *
 * Every state a screen can be in — loading, empty, failed, forbidden — has a
 * component here, so no page invents its own. Plan §112 forbids a generic
 * "something went wrong" for a condition the server already named, and that is
 * only achievable if the error component is handed the real code.
 */

export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
}: {
  title?: string;
  subtitle?: string;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {title ? (
        <div className="card__header">
          <div>
            <h2 className="card__title">
              {icon ? <Icon name={icon} className="nav__icon" aria-hidden /> : null}
              {title}
            </h2>
            {subtitle ? (
              <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Skeleton block. Never a spinner on a table — the shape should be predictable. */
export function Skeleton({ height = 200 }: { height?: number }) {
  return (
    <>
      <div className="skeleton" style={{ height }} aria-hidden />
      <span className="sr-only">جاري التحميل…</span>
    </>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="empty">
      <Icon name="search" className="nav__icon" aria-hidden />
      <p style={{ margin: 0, fontWeight: 600 }}>{message}</p>
      {hint ? <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>{hint}</p> : null}
    </div>
  );
}

/**
 * Error state.
 *
 * Takes the server's Arabic message rather than composing its own — the server
 * knows whether this was a closed city, a stale version or a permission gap.
 */
export function ErrorState({
  message,
  code,
  onRetry,
}: {
  message: string;
  code?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="alert-bar alert-bar--danger" role="alert">
      <Icon name="alert" className="nav__icon" aria-hidden />
      <span style={{ flex: 1 }}>
        {message}
        {code ? (
          <span style={{ opacity: 0.7, fontSize: 'var(--text-xs)' }}> ({code})</span>
        ) : null}
      </span>
      {onRetry ? (
        <button type="button" className="btn btn--danger btn--sm" onClick={onRetry}>
          إعادة المحاولة
        </button>
      ) : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/** Money cell. Always tabular, always LTR inside an RTL table. */
export function Money({ amount }: { amount: number }) {
  return (
    <span className="numeric">{new Intl.NumberFormat('en-US').format(amount)} د.ع</span>
  );
}

export function DataTable<T>({
  columns,
  rows,
  keyOf,
  caption,
  emptyMessage = 'لا توجد نتائج',
}: {
  columns: { key: string; header: string; render: (row: T) => ReactNode; numeric?: boolean }[];
  rows: T[];
  keyOf: (row: T) => string;
  caption?: string;
  emptyMessage?: string;
}) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;

  return (
    // Wide tables scroll inside their own container; the page never scrolls
    // sideways (plan §138).
    <div className="table-wrap">
      <table className="table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric ? 'numeric' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keyOf(row)}>
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? 'numeric' : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Confirmation dialog for a destructive action (plan §114).
 *
 * A reason is mandatory when `requireReason` is set — the plan makes a written
 * reason part of the action, not an optional note.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'تأكيد',
  tone = 'danger',
  requireReason = false,
  isSubmitting = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  requireReason?: boolean;
  isSubmitting?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const reasonTooShort = requireReason && reason.trim().length < 5;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="dialog">
        <h2 id="confirm-title">{title}</h2>
        <div>{body}</div>

        {requireReason ? (
          <div className="field">
            <label htmlFor="confirm-reason">السبب (مطلوب)</label>
            <textarea
              id="confirm-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && reasonTooShort}
              aria-describedby="confirm-reason-hint"
            />
            <span id="confirm-reason-hint" className="field__hint">
              يُسجَّل السبب في سجل الأنشطة ولا يمكن تعديله لاحقاً.
            </span>
            {touched && reasonTooShort ? (
              <span className="field__error">الرجاء كتابة سبب واضح (5 أحرف على الأقل)</span>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className={`btn btn--${tone}`}
            disabled={reasonTooShort || isSubmitting}
            onClick={() => onConfirm(reason.trim())}
          >
            {isSubmitting ? 'جاري التنفيذ…' : confirmLabel}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

/** Search + filter bar shared by every list screen. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--space-2)',
        alignItems: 'center',
        marginBottom: 'var(--space-4)',
      }}
    >
      {children}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'بحث…',
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
}) {
  return (
    <div className="topbar__control">
      <Icon name="search" className="nav__icon" aria-hidden />
      <label htmlFor="filter-search" className="sr-only">
        {label}
      </label>
      <input
        id="filter-search"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  allLabel = 'الكل',
}: {
  value: T | '';
  onChange: (value: T | '') => void;
  options: { value: T; label: string }[];
  label: string;
  allLabel?: string;
}) {
  const id = `select-${label.replace(/\s/g, '-')}`;
  return (
    <div className="topbar__control">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T | '')}
        style={{
          border: 'none',
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: 'var(--text-sm)',
          outline: 'none',
        }}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Screen shown when a session lacks the role a page requires. */
export function ForbiddenState({ requiredAr }: { requiredAr?: string }) {
  return (
    <div className="empty" style={{ minHeight: '60vh', justifyContent: 'center' }}>
      <Icon name="alert" className="nav__icon" aria-hidden />
      <h2>لا تملك صلاحية الوصول</h2>
      <p>
        {requiredAr
          ? `هذه الصفحة تتطلب صلاحية: ${requiredAr}`
          : 'هذه الصفحة تتطلب صلاحيات إضافية. تواصل مع مدير النظام.'}
      </p>
    </div>
  );
}
