'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateTimeAr } from '@jibli/ui-web';
import { AdminShell } from '@/components/shell';
import { Badge, Card, ErrorState, MfaChallenge, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type ConfigEntry } from '@/lib/admin-endpoints';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Platform configuration (plan §118).
 *
 * "The mobile application never hard-codes the amount." Everything here reaches
 * a live client within seconds, so high-impact keys demand a written reason and
 * every change is versioned.
 */

const KEY_LABELS: Record<string, string> = {
  global_checkout_enabled: 'تفعيل الطلبات على مستوى المنصة',
  platform_service_fee_iqd: 'رسوم الخدمة (د.ع)',
  default_commission_rate_bps: 'نسبة العمولة الافتراضية (نقطة أساس)',
  default_settlement_policy: 'دورة التسوية الافتراضية',
  default_payment_term_days: 'مهلة السداد (أيام)',
  delivery_pin_enabled: 'طلب رمز التسليم',
  order_acceptance_timeout_minutes: 'مهلة قبول الطلب (دقائق)',
  minimum_app_version: 'أقل إصدار مدعوم للتطبيق',
  latest_app_version: 'أحدث إصدار متاح',
  support_phone: 'رقم الدعم الفني',
  max_active_deliveries_per_driver: 'أقصى مهام توصيل نشطة لكل سائق',
};

export default function SettingsPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ConfigEntry | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const config = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => admin.config(token),
    enabled: session.status === 'authenticated',
  });

  const update = useMutation({
    mutationFn: ({ key, value, reason }: { key: string; value: unknown; reason?: string }) =>
      admin.updateConfig(token, key, value, reason),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-config'] });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) setNeedsMfa(true);
    },
  });

  if (session.status !== 'authenticated') {
    return (
      <div className="empty" style={{ minHeight: '100vh', justifyContent: 'center' }}>
        <h1>الرجاء تسجيل الدخول</h1>
      </div>
    );
  }

  const entries = config.data ?? [];
  const checkoutEntry = entries.find((entry) => entry.key === 'global_checkout_enabled');
  const checkoutDisabled = checkoutEntry?.value === false;

  return (
    <AdminShell
      title="إعدادات المنصة"
      subtitle="إعدادات تسري على كل العملاء والمطاعم فوراً"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      {/*
        The global kill switch deserves its own banner: it is the single setting
        that can stop the entire marketplace (plan §125).
      */}
      {checkoutDisabled ? (
        <div className="alert-bar alert-bar--danger" role="alert">
          <Icon name="alert" className="nav__icon" aria-hidden />
          <span>
            الطلبات متوقفة على مستوى المنصة بالكامل. لا يستطيع أي عميل إتمام طلب في أي مدينة.
          </span>
        </div>
      ) : null}

      <Card title="الإعدادات العامة" icon="settings">
        {config.isError ? (
          <ErrorState
            message={
              config.error instanceof ApiError ? config.error.messageAr : 'تعذّر تحميل الإعدادات'
            }
            onRetry={() => void config.refetch()}
          />
        ) : config.isLoading ? (
          <Skeleton height={320} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {entries.map((entry) => (
              <div
                key={entry.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-4)',
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-sunken)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>
                    {KEY_LABELS[entry.key] ?? entry.key}
                    {entry.reason_required ? (
                      <span style={{ marginInlineStart: 8 }}>
                        <Badge tone="warning">يتطلب سبباً</Badge>
                      </span>
                    ) : null}
                  </strong>
                  <span
                    className="ltr-inline"
                    style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}
                  >
                    {entry.key}
                  </span>
                  {entry.updated_at ? (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                      آخر تعديل: {dateTimeAr(entry.updated_at)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                      القيمة الافتراضية
                    </div>
                  )}
                </div>

                <div style={{ fontWeight: 700, minWidth: 120, textAlign: 'start' }}>
                  <ValueDisplay value={entry.value} />
                </div>

                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => setEditing(entry)}
                >
                  تعديل
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editing ? (
        <EditConfigDialog
          entry={editing}
          label={KEY_LABELS[editing.key] ?? editing.key}
          isSubmitting={update.isPending}
          error={update.error instanceof ApiError ? update.error.messageAr : null}
          onSave={(value, reason) => update.mutate({ key: editing.key, value, reason })}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {needsMfa ? (
        <MfaChallenge onVerified={() => setNeedsMfa(false)} onCancel={() => setNeedsMfa(false)} />
      ) : null}
    </AdminShell>
  );
}

function ValueDisplay({ value }: { value: unknown }) {
  if (typeof value === 'boolean') {
    return <Badge tone={value ? 'success' : 'danger'}>{value ? 'مفعّل' : 'معطّل'}</Badge>;
  }
  if (typeof value === 'number') {
    return <span className="numeric">{new Intl.NumberFormat('en-US').format(value)}</span>;
  }
  return <span className="ltr-inline">{String(value)}</span>;
}

function EditConfigDialog({
  entry,
  label,
  isSubmitting,
  error,
  onSave,
  onCancel,
}: {
  entry: ConfigEntry;
  label: string;
  isSubmitting: boolean;
  error: string | null;
  onSave: (value: unknown, reason?: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<unknown>(entry.value);
  const [reason, setReason] = useState('');

  const reasonMissing = entry.reason_required && reason.trim().length < 5;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="config-title">
      <div className="dialog">
        <h2 id="config-title">{label}</h2>

        <div className="field">
          <label htmlFor="config-value">القيمة</label>
          {typeof entry.value === 'boolean' ? (
            <select
              id="config-value"
              value={String(value)}
              onChange={(event) => setValue(event.target.value === 'true')}
            >
              <option value="true">مفعّل</option>
              <option value="false">معطّل</option>
            </select>
          ) : typeof entry.value === 'number' ? (
            <input
              id="config-value"
              type="number"
              value={Number(value)}
              onChange={(event) => setValue(Number(event.target.value))}
            />
          ) : (
            <input
              id="config-value"
              value={String(value)}
              onChange={(event) => setValue(event.target.value)}
              style={{ direction: 'ltr', textAlign: 'left' }}
            />
          )}
        </div>

        {entry.key === 'global_checkout_enabled' && value === false ? (
          <div className="dialog__impact">
            <strong>
              <Icon name="alert" className="nav__icon" aria-hidden /> هذا يوقف الطلبات في كل المدن
            </strong>
            <p style={{ margin: 0 }}>
              الطلبات النشطة الحالية تكمل مسارها، ولا تُحذف أي بيانات. لكن لن يتمكن أي عميل من
              إتمام طلب جديد حتى تُعيد التفعيل.
            </p>
          </div>
        ) : null}

        {entry.reason_required ? (
          <div className="field">
            <label htmlFor="config-reason">سبب التغيير (مطلوب)</label>
            <textarea
              id="config-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <span className="field__hint">
              يُحفظ السبب مع القيمة السابقة والجديدة في سجل التغييرات.
            </span>
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
            className="btn btn--primary"
            disabled={reasonMissing || isSubmitting}
            onClick={() => onSave(value, reason || undefined)}
          >
            {isSubmitting ? 'جاري الحفظ…' : 'حفظ'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
