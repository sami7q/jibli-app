'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icon';
import { Dropdown } from './dropdown';
import { apiRequest, ApiError } from '@/lib/api';
import { useAdminSession, useApplyAccessToken } from '@/hooks/use-session';

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
  // The server's Arabic message is the banner; the raw code is kept only on the
  // element's title for support, never appended as English text to the Arabic
  // sentence (ADMIN-24).
  return (
    <div className="alert-bar alert-bar--danger" role="alert" {...(code ? { title: code } : {})}>
      <Icon name="alert" className="nav__icon" aria-hidden />
      <span style={{ flex: 1 }}>{message}</span>
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
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'rose';
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/** Money cell. Always tabular, always LTR inside an RTL table. */
export function Money({ amount }: { amount: number }) {
  return <span className="numeric">{new Intl.NumberFormat('en-US').format(amount)} د.ع</span>;
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
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
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

/**
 * Offset pager shared by every long list (ADMIN-17).
 *
 * The lists silently stopped at the first page and gave no sign there was more;
 * older records were reachable only by an exact search. This reads `meta.total`
 * the API already returns and offers «السابق / التالي», so nothing is stranded.
 * It renders nothing when a single page holds everything.
 */
export function Pager({
  offset,
  pageSize,
  total,
  onOffsetChange,
}: {
  offset: number;
  pageSize: number;
  total: number;
  onOffsetChange: (offset: number) => void;
}) {
  if (total <= pageSize && offset === 0) return null;

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + pageSize, total);
  const canPrev = offset > 0;
  const canNext = offset + pageSize < total;

  return (
    <nav
      aria-label="تصفّح النتائج"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-4)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        <span className="numeric">{from}</span>–<span className="numeric">{to}</span> من{' '}
        <span className="numeric">{total}</span>
      </span>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn btn--outline btn--sm"
          disabled={!canPrev}
          onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
        >
          السابق
        </button>
        <button
          type="button"
          className="btn btn--outline btn--sm"
          disabled={!canNext}
          onClick={() => onOffsetChange(offset + pageSize)}
        >
          التالي
        </button>
      </div>
    </nav>
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
  allLabel,
}: {
  value: T | '';
  onChange: (value: T | '') => void;
  options: { value: T; label: string }[];
  label: string;
  allLabel?: string;
}) {
  /*
   * A thin wrapper over `Dropdown`, kept so the twelve screens that already
   * call `Select` did not all have to change at once. The native control it
   * used to render had no visible border and opened upward near the bottom of
   * the window; see dropdown.tsx for why that is worth replacing rather than
   * restyling.
   */
  return (
    <Dropdown
      value={value}
      onChange={onChange}
      options={options}
      label={label}
      {...(allLabel === undefined ? {} : { allLabel })}
    />
  );
}

/** Screen shown when a session lacks the role a page requires. */
export function ForbiddenState({ requiredAr }: { requiredAr?: string }) {
  return (
    <div className="empty" style={{ minHeight: '60vh', justifyContent: 'center' }}>
      <Icon name="roles" className="nav__icon" aria-hidden />
      <h2>لا تملك صلاحية الوصول</h2>
      <p>
        {requiredAr
          ? `هذه الصفحة تتطلب صلاحية: ${requiredAr}`
          : 'هذه الصفحة تتطلب صلاحيات إضافية. تواصل مع مدير النظام.'}
      </p>
    </div>
  );
}

/**
 * Step-up prompt for a sensitive action (plan §88).
 *
 * Shown when the server answers REAUTHENTICATION_REQUIRED. The action is not
 * retried automatically after verification — the operator confirms again, so a
 * sensitive change is never executed by a stale click.
 *
 * Which factor it asks for depends on the account. An authenticator is the
 * stronger answer and is used whenever one is enrolled; an account without one
 * re-enters its password. Asking for a code that no authenticator can produce
 * would not make the action safer, only impossible — and an operator who
 * cannot change a commission has no reason to keep the control on.
 */
export function MfaChallenge({
  onVerified,
  onCancel,
}: {
  onVerified: () => void;
  onCancel: () => void;
}) {
  const session = useAdminSession();
  const applyAccessToken = useApplyAccessToken();
  const accessToken = session.status === 'authenticated' ? session.accessToken : null;

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [usesAuthenticator, setUsesAuthenticator] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  // Which factor to ask for. Until this answers, the dialog shows neither
  // field rather than guessing and making the operator retype.
  //
  // Both `/auth/mfa/status` and `/auth/mfa/verify` sit behind bearer auth, so
  // the session's access token must be passed — without it they always 401 and
  // the step-up could never complete (ADMIN-1).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await apiRequest<{ enabled: boolean }>('/api/v1/auth/mfa/status', {
          accessToken,
        });
        if (!cancelled) setUsesAuthenticator(status.enabled);
      } catch {
        // Ask for the code: it is the stricter of the two, so a failed check
        // never downgrades the challenge.
        if (!cancelled) setUsesAuthenticator(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const answer = usesAuthenticator ? code : password;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiRequest<{ verified: boolean; access_token?: string }>(
        '/api/v1/auth/mfa/verify',
        {
          method: 'POST',
          accessToken,
          body: usesAuthenticator ? { code } : { password },
        },
      );
      // The verify response carries a fresh token stamped with `mfaAt`; swap it
      // into the provider so the retried sensitive action is step-up-fresh.
      if (result.access_token) applyAccessToken(result.access_token);
      onVerified();
    } catch (caught) {
      // The server's Arabic message, never `CODE: message` (ADMIN-1 / §112).
      setError(caught instanceof ApiError ? caught.messageAr : 'تعذّر التحقق');
      setCode('');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="mfa-title">
      <div className="dialog">
        <h2 id="mfa-title">تأكيد الهوية</h2>

        {usesAuthenticator === null ? (
          <Skeleton height={120} />
        ) : usesAuthenticator ? (
          <>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              هذا الإجراء حساس ويتطلب رمز التحقق بخطوتين. أدخل الرمز من تطبيق المصادقة، أو أحد رموز
              الاسترداد.
            </p>

            <div className="field">
              <label htmlFor="mfa-code">رمز التحقق</label>
              <input
                id="mfa-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                style={{ textAlign: 'center', letterSpacing: 6, fontSize: 'var(--text-xl)' }}
              />
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              هذا الإجراء حساس. أكّد أنك أنت بإدخال كلمة مرور حسابك.
            </p>

            <div className="field">
              <label htmlFor="mfa-password">كلمة المرور</label>
              <input
                id="mfa-password"
                type="password"
                dir="ltr"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
              <span className="field__hint">
                لحماية أقوى، فعّل التحقق بخطوتين من صفحة الأمان — عندها يُطلب رمز بدل كلمة المرور.
              </span>
            </div>
          </>
        )}

        {error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={answer.length < (usesAuthenticator ? 6 : 1) || isSubmitting}
            onClick={() => void submit()}
          >
            {isSubmitting ? 'جاري التحقق…' : 'تأكيد'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
