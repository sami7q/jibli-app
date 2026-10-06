'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';
import { portal } from '@/lib/portal-endpoints';

type Auth = { accessToken: string; restaurantId: string };

/**
 * Going live: what is left, and the one button that asks for it.
 *
 * The restaurant used to set up its menu, hours and drivers with no idea what
 * Admin was waiting for, and no way to say it was finished — Admin's checklist
 * was private to Admin. This is the same twelve checks, from this side, plus
 * the request.
 *
 * It renders nothing once the restaurant is trading. A permanent card about
 * activation on the dashboard of a live restaurant is noise that trains people
 * to ignore the dashboard.
 */
export function ReadinessCard({ auth, canWrite }: { auth: Auth; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const readiness = useQuery({
    queryKey: ['portal-readiness', auth.restaurantId],
    queryFn: () => portal.readiness(auth),
    staleTime: 30_000,
  });

  const submit = useMutation({
    mutationFn: () => portal.requestActivation(auth, note.trim() || undefined),
    onSuccess: () => {
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['portal-readiness'] });
    },
  });

  const withdraw = useMutation({
    mutationFn: () => portal.withdrawActivation(auth),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['portal-readiness'] }),
  });

  const data = readiness.data;
  if (!data || data.operational_status === 'ACTIVE') return null;

  const waiting = Boolean(data.activation_requested_at);
  const done = data.checks.filter((check) => check.passed).length;

  return (
    <section className="card readiness">
      <div className="card__header">
        <h2 className="card__title">تجهيز المطعم للعمل</h2>
        <span className="readiness__count">
          {done} من {data.checks.length}
        </span>
      </div>

      {waiting ? (
        <div className="readiness__sent" role="status">
          <strong>طلبك قيد المراجعة لدى إدارة جيبلي.</strong>
          <span>
            أُرسل في {new Date(data.activation_requested_at ?? '').toLocaleDateString('ar-IQ')}.
            يمكنك متابعة تجهيز المنيو والصور أثناء المراجعة.
          </span>
          {canWrite ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => withdraw.mutate()}
              disabled={withdraw.isPending}
            >
              سحب الطلب
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className="readiness__list">
        {data.checks.map((check) => (
          <li
            key={check.key}
            className={`readiness__item${check.passed ? ' readiness__item--done' : ''}`}
          >
            <span className="readiness__mark" aria-hidden>
              {check.passed ? '✓' : '○'}
            </span>
            <span className="readiness__label">{check.label_ar}</span>
            {/*
              An optional check that has not passed is not a problem, and
              labelling it as one sends people chasing things that do not block
              them.
            */}
            {!check.blocking && !check.passed ? (
              <span className="readiness__optional">اختياري</span>
            ) : null}
          </li>
        ))}
      </ul>

      {!waiting && canWrite ? (
        data.ready ? (
          <div className="readiness__submit">
            <label className="field" htmlFor="activation-note">
              <span>ملاحظة للإدارة (اختياري)</span>
              <textarea
                id="activation-note"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="أي شيء يلزم فريق المراجعة معرفته."
              />
            </label>

            <button
              type="button"
              className="btn btn--primary"
              onClick={() => submit.mutate()}
              disabled={submit.isPending}
            >
              {submit.isPending ? 'جارٍ الإرسال…' : 'إرسال طلب التفعيل'}
            </button>

            {submit.error ? (
              <p className="readiness__error" role="alert">
                {submit.error instanceof ApiError ? submit.error.messageAr : 'تعذّر إرسال الطلب'}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="readiness__pending">أكمل المتطلبات المتبقية، وسيظهر زر إرسال الطلب هنا.</p>
        )
      ) : null}
    </section>
  );
}
