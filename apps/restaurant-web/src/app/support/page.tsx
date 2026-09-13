'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { relativeAr } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { portal, type SupportThreadSummary } from '@/lib/portal-endpoints';
import { THREAD_STATUS_LABELS, TOPICS } from '@/lib/support-labels';

/**
 * Talking to Jibli.
 *
 * A restaurant with a problem used to phone whoever they happened to know.
 * Nothing was recorded, nobody else could pick it up, and the same question got
 * a different answer twice. Now it lands in a queue with the restaurant's name
 * on it, and the answer stays where both sides can re-read it.
 *
 * No permission gate: every member of the restaurant can ask for help,
 * including the one whose shift is the reason the question exists. Restricting
 * support to owners is how a problem at nine in the evening waits until
 * morning.
 */

export default function SupportPage() {
  return <PortalPage>{({ auth }) => <SupportScreen auth={auth} />}</PortalPage>;
}

function SupportScreen({ auth }: { auth: PortalAuth }) {
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);

  const threads = useQuery({
    queryKey: ['portal-support', auth.restaurantId],
    queryFn: () => portal.supportThreads(auth),
  });

  const list = threads.data ?? [];
  const answered = list.filter((thread) => thread.awaiting_you);

  return (
    <>
      {/*
        The one state worth interrupting for: Jibli answered and nobody at the
        restaurant has read it yet.
      */}
      {answered.length > 0 ? (
        <div className="alert-bar alert-bar--success" role="status">
          <Icon name="support" className="nav__icon" aria-hidden />
          <span>
            وصلك ردّ على {answered.length === 1 ? 'محادثة' : `${answered.length} محادثات`}.
          </span>
        </div>
      ) : null}

      <Card
        title="الدعم"
        icon="support"
        subtitle="تواصل مباشر مع فريق جيبلي"
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setComposing(true)}>
            رسالة جديدة
          </button>
        }
      >
        {threads.isError ? (
          <ErrorState
            message={
              threads.error instanceof ApiError ? threads.error.messageAr : 'تعذّر تحميل المحادثات'
            }
            onRetry={() => void threads.refetch()}
          />
        ) : threads.isLoading ? (
          <Skeleton height={260} />
        ) : list.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0, fontWeight: 600 }}>لا توجد محادثات بعد</p>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              عندك سؤال أو مشكلة؟ اكتب لنا وسيصلك الرد هنا.
            </p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setComposing(true)}
              style={{ marginBlockStart: 'var(--space-3)' }}
            >
              ابدأ محادثة
            </button>
          </div>
        ) : (
          <ul className="threads">
            {list.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} />
            ))}
          </ul>
        )}
      </Card>

      {composing ? (
        <ComposeDialog
          auth={auth}
          onDone={() => {
            setComposing(false);
            void queryClient.invalidateQueries({ queryKey: ['portal-support'] });
          }}
          onCancel={() => setComposing(false)}
        />
      ) : null}
    </>
  );
}

function ThreadRow({ thread }: { thread: SupportThreadSummary }) {
  return (
    <li>
      <Link href={`/support/${thread.id}`} className="threads__row">
        <span className="threads__main">
          <strong>{thread.subject}</strong>
          <span className="threads__meta">
            {TOPICS.find((topic) => topic.key === thread.topic)?.labelAr ?? thread.topic} ·{' '}
            {thread.message_count} رسالة · {relativeAr(thread.last_message_at)}
          </span>
        </span>
        <span
          className={`badge badge--${
            thread.awaiting_you ? 'success' : thread.status === 'OPEN' ? 'warning' : 'neutral'
          }`}
        >
          {THREAD_STATUS_LABELS[thread.status] ?? thread.status}
        </span>
      </Link>
    </li>
  );
}

function ComposeDialog({
  auth,
  onDone,
  onCancel,
}: {
  auth: PortalAuth;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState<string>('OTHER');
  const [priority, setPriority] = useState<'NORMAL' | 'URGENT'>('NORMAL');
  const [message, setMessage] = useState('');

  const send = useMutation({
    mutationFn: () =>
      portal.openSupportThread(auth, {
        subject: subject.trim(),
        topic,
        priority,
        message: message.trim(),
      }),
    onSuccess: onDone,
  });

  const canSend = subject.trim().length >= 3 && message.trim().length >= 5 && !send.isPending;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="support-title">
      <div className="dialog">
        <h2 id="support-title">رسالة إلى فريق جيبلي</h2>

        <div className="field">
          <label htmlFor="support-topic">نوع الموضوع</label>
          <select
            id="support-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          >
            {TOPICS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.labelAr}
                {entry.hint ? ` — ${entry.hint}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="support-subject">الموضوع</label>
          <input
            id="support-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="مثال: الطلب #12345 لم يصل للسائق"
            maxLength={140}
          />
        </div>

        <div className="field">
          <label htmlFor="support-message">التفاصيل</label>
          <textarea
            id="support-message"
            rows={6}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="اشرح المشكلة بالتفصيل — كلما كانت التفاصيل أوضح كان الرد أسرع."
          />
        </div>

        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={priority === 'URGENT'}
            onChange={(event) => setPriority(event.target.checked ? 'URGENT' : 'NORMAL')}
          />
          عاجل — يؤثر على طلبات جارية الآن
        </label>

        {send.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {send.error instanceof ApiError ? send.error.messageAr : 'تعذّر إرسال الرسالة'}
          </p>
        ) : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canSend}
            onClick={() => send.mutate()}
          >
            {send.isPending ? 'جاري الإرسال…' : 'إرسال'}
          </button>
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
