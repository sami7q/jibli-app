'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { OrderAlertManager, type AlertState } from '@/lib/order-alerts';
import { Icon } from '@/components/icon';

/**
 * Order-alert verification harness (plan §181).
 *
 * "Sound must be tested on the actual browsers/tablets/laptops restaurants are
 * expected to use. Browser autoplay and background-tab behaviour cannot be
 * trusted solely from unit tests."
 *
 * This page exists so that QA is a checklist someone can actually run on the
 * device, rather than an instruction nobody can act on. It drives the real
 * `OrderAlertManager` — not a mock — so what passes here is what ships.
 *
 * Restaurants are pointed at this during onboarding to satisfy the
 * `orderAlertAcknowledged` readiness check (plan §122).
 */

interface CheckResult {
  readonly id: string;
  readonly labelAr: string;
  readonly hintAr: string;
  status: 'pending' | 'pass' | 'fail';
}

const INITIAL_CHECKS: CheckResult[] = [
  {
    id: 'activation',
    labelAr: 'تفعيل الصوت بعد ضغطة المستخدم',
    hintAr: 'اضغط "تفعيل التنبيهات". يجب أن تتحول الحالة إلى مفعّل بدون رسالة خطأ.',
    status: 'pending',
  },
  {
    id: 'foreground-sound',
    labelAr: 'الصوت يعمل والصفحة مفتوحة',
    hintAr: 'اضغط "محاكاة طلب جديد". يجب أن تسمع نغمتين صاعدتين.',
    status: 'pending',
  },
  {
    id: 'background-tab',
    labelAr: 'الصوت يعمل والتبويب في الخلفية',
    hintAr: 'اضغط "محاكاة بعد 5 ثوانٍ" ثم انتقل لتبويب آخر فوراً. يجب أن تسمع التنبيه.',
    status: 'pending',
  },
  {
    id: 'escalation',
    labelAr: 'التنبيه المتصاعد للطلب غير المقبول',
    hintAr: 'اضغط "محاكاة تصعيد". يجب أن تسمع نغمة أعلى وأطول (أربع نغمات).',
    status: 'pending',
  },
  {
    id: 'browser-notification',
    labelAr: 'إشعار المتصفح يظهر',
    hintAr: 'وافق على إذن الإشعارات، ثم جرّب المحاكاة في الخلفية. يجب أن يظهر إشعار.',
    status: 'pending',
  },
  {
    id: 'title-badge',
    labelAr: 'عدّاد الطلبات يظهر في عنوان التبويب',
    hintAr: 'بعد المحاكاة، انظر إلى عنوان التبويب. يجب أن يبدأ بـ (1).',
    status: 'pending',
  },
  {
    id: 'no-overlap',
    labelAr: 'عدة طلبات لا تُنتج أصواتاً متداخلة',
    hintAr: 'اضغط "محاكاة 3 طلبات". يجب أن تسمع تنبيهاً واحداً، لا ثلاثة متداخلة.',
    status: 'pending',
  },
  {
    id: 'device-volume',
    labelAr: 'الصوت مسموع على مستوى صوت الجهاز الفعلي',
    hintAr: 'جرّب على مستوى الصوت الذي سيستخدمه المطعم فعلياً في مكان صاخب.',
    status: 'pending',
  },
];

export default function AlertTestPage() {
  const [checks, setChecks] = useState<CheckResult[]>(INITIAL_CHECKS);
  const [alertState, setAlertState] = useState<AlertState>({
    enabled: false,
    notificationPermission: 'unknown',
    pendingOrderIds: [],
  });
  const [environment, setEnvironment] = useState<Record<string, string>>({});

  const manager = useRef<OrderAlertManager | null>(null);
  if (!manager.current) {
    manager.current = new OrderAlertManager({
      onStateChange: setAlertState,
      // Shortened so a tester is not waiting a full minute to see escalation.
      repeatIntervalMs: 8_000,
      escalateAfterMs: 16_000,
    });
  }

  // Capture what device this actually ran on — a passing checklist is only
  // meaningful alongside the browser and platform it passed on.
  useEffect(() => {
    setEnvironment({
      browser: navigator.userAgent,
      platform: navigator.platform,
      audioContext:
        typeof window !== 'undefined' && 'AudioContext' in window ? 'مدعوم' : 'غير مدعوم',
      notifications:
        typeof window !== 'undefined' && 'Notification' in window ? 'مدعوم' : 'غير مدعوم',
      screen: `${window.screen.width}×${window.screen.height}`,
    });
  }, []);

  useEffect(() => {
    const current = manager.current;
    return () => current?.disable();
  }, []);

  const setStatus = useCallback((id: string, status: 'pass' | 'fail') => {
    setChecks((current) => current.map((c) => (c.id === id ? { ...c, status } : c)));
  }, []);

  const enable = async () => {
    await manager.current?.enable();
  };

  const simulate = (count: number) => {
    manager.current?.syncPending(
      Array.from({ length: count }, (_, i) => `test-order-${Date.now()}-${i}`),
    );
  };

  const simulateDelayed = (delayMs: number) => {
    setTimeout(() => simulate(1), delayMs);
  };

  const clear = () => manager.current?.acknowledgeAll();

  const passedCount = checks.filter((c) => c.status === 'pass').length;
  const failedCount = checks.filter((c) => c.status === 'fail').length;
  const allDone = checks.every((c) => c.status !== 'pending');

  /** A copy-paste block for the QA record. */
  const report = [
    `تقرير اختبار تنبيه الطلبات — ${new Date().toLocaleString('ar-IQ')}`,
    `المتصفح: ${environment.browser ?? ''}`,
    `المنصة: ${environment.platform ?? ''}`,
    `الشاشة: ${environment.screen ?? ''}`,
    '',
    ...checks.map(
      (c) => `${c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '—'} ${c.labelAr}`,
    ),
    '',
    `النتيجة: ${passedCount} نجح، ${failedCount} فشل من ${checks.length}`,
  ].join('\n');

  return (
    <main className="main" style={{ maxWidth: 880, margin: '0 auto' }}>
      <header className="topbar">
        <div className="topbar__greeting">
          <strong>اختبار تنبيه الطلبات</strong>
          <span>
            شغّل هذا الاختبار على الجهاز الذي سيستخدمه المطعم فعلياً — سلوك الصوت يختلف بين
            المتصفحات والأجهزة
          </span>
        </div>
      </header>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">
            <Icon name="volume" className="nav__icon" aria-hidden />
            حالة النظام
          </h2>
        </div>

        <dl
          style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', margin: 0 }}
        >
          <dt style={{ color: 'var(--text-muted)' }}>الصوت</dt>
          <dd style={{ margin: 0, fontWeight: 700 }}>
            {alertState.enabled ? 'مفعّل' : 'غير مفعّل'}
          </dd>
          <dt style={{ color: 'var(--text-muted)' }}>إذن الإشعارات</dt>
          <dd style={{ margin: 0, fontWeight: 700 }}>
            {alertState.notificationPermission === 'granted'
              ? 'ممنوح'
              : alertState.notificationPermission === 'denied'
                ? 'مرفوض'
                : 'لم يُطلب بعد'}
          </dd>
          <dt style={{ color: 'var(--text-muted)' }}>طلبات معلّقة</dt>
          <dd style={{ margin: 0, fontWeight: 700 }} className="numeric">
            {alertState.pendingOrderIds.length}
          </dd>
          <dt style={{ color: 'var(--text-muted)' }}>AudioContext</dt>
          <dd style={{ margin: 0 }}>{environment.audioContext ?? '—'}</dd>
          <dt style={{ color: 'var(--text-muted)' }}>المتصفح</dt>
          <dd style={{ margin: 0, fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}>
            {environment.browser ?? '—'}
          </dd>
        </dl>
      </section>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">أدوات المحاكاة</h2>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <button type="button" className="btn btn--primary" onClick={() => void enable()}>
            تفعيل التنبيهات
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => simulate(1)}
            disabled={!alertState.enabled}
          >
            محاكاة طلب جديد
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => simulateDelayed(5000)}
            disabled={!alertState.enabled}
          >
            محاكاة بعد 5 ثوانٍ
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => simulate(3)}
            disabled={!alertState.enabled}
          >
            محاكاة 3 طلبات
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              simulate(1);
              // The manager escalates on its own once the order has waited past
              // the escalation threshold; this just shortens the wait for QA.
            }}
            disabled={!alertState.enabled}
          >
            محاكاة تصعيد (انتظر 16 ثانية)
          </button>
          <button type="button" className="btn btn--danger" onClick={clear}>
            مسح الطلبات المعلّقة
          </button>
        </div>

        {!alertState.enabled ? (
          <p className="alert-bar alert-bar--warning" style={{ marginTop: 'var(--space-4)' }}>
            المتصفح يمنع تشغيل الصوت بدون ضغطة من المستخدم. اضغط "تفعيل التنبيهات" أولاً.
          </p>
        ) : null}
      </section>

      <section className="card">
        <div className="card__header">
          <h2 className="card__title">قائمة التحقق</h2>
          <span className="badge badge--done">
            {passedCount} / {checks.length}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {checks.map((check) => (
            <div
              key={check.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-3)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                background:
                  check.status === 'pass'
                    ? 'var(--jibli-success-50)'
                    : check.status === 'fail'
                      ? 'var(--jibli-danger-50)'
                      : 'var(--surface-sunken)',
              }}
            >
              <div style={{ flex: 1 }}>
                <strong style={{ display: 'block' }}>{check.labelAr}</strong>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  {check.hintAr}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  className="btn btn--success btn--sm"
                  onClick={() => setStatus(check.id, 'pass')}
                  aria-label={`${check.labelAr}: نجح`}
                >
                  نجح
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => setStatus(check.id, 'fail')}
                  aria-label={`${check.labelAr}: فشل`}
                >
                  فشل
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {allDone ? (
        <section className="card">
          <div className="card__header">
            <h2 className="card__title">
              {failedCount === 0 ? '✓ اكتمل الاختبار بنجاح' : `✗ ${failedCount} اختبار فشل`}
            </h2>
          </div>

          {failedCount > 0 ? (
            <p className="alert-bar alert-bar--danger">
              لا تعتمد هذا الجهاز للعمل قبل حل الأخطاء. الخطة §181 تعتبر تنبيه الطلبات شرطاً
              تشغيلياً وليس تحسيناً اختيارياً.
            </p>
          ) : null}

          <label htmlFor="qa-report" className="sr-only">
            تقرير الاختبار
          </label>
          <textarea
            id="qa-report"
            readOnly
            value={report}
            rows={14}
            style={{
              width: '100%',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              marginTop: 'var(--space-3)',
            }}
          />

          <button
            type="button"
            className="btn btn--primary"
            style={{ marginTop: 'var(--space-3)' }}
            onClick={() => void navigator.clipboard.writeText(report)}
          >
            نسخ التقرير
          </button>
        </section>
      ) : null}
    </main>
  );
}
