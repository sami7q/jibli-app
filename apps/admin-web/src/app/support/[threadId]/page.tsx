'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateTimeAr } from '@jibli/ui-web';
import { AdminShell } from '@/components/shell';
import { Badge, Card, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { admin } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';
import { STATUS_LABELS, TOPIC_LABELS } from '../page';

/**
 * One conversation with a restaurant.
 *
 * Answering and closing are the same action by default — an operator who has
 * replied has usually dealt with it — but they are separable, because "here is
 * the answer, tell me if that worked" is a real reply that should leave the
 * thread open.
 */
export default function SupportThreadPage() {
  const params = useParams<{ threadId: string }>();
  const threadId = params.threadId;
  const session = useAdminSession();
  const queryClient = useQueryClient();

  const [message, setMessage] = useState('');
  const [resolve, setResolve] = useState(true);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const thread = useQuery({
    queryKey: ['admin-support-thread', threadId],
    queryFn: () => admin.supportThread(token, threadId),
    enabled: session.status === 'authenticated',
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-support-thread', threadId] });
    void queryClient.invalidateQueries({ queryKey: ['admin-support'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-notifications-unread'] });
  };

  const reply = useMutation({
    mutationFn: () => admin.replyToSupportThread(token, threadId, { message, resolve }),
    onSuccess: () => {
      setMessage('');
      invalidate();
    },
  });

  const close = useMutation({
    mutationFn: () => admin.resolveSupportThread(token, threadId),
    onSuccess: invalidate,
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  const data = thread.data;

  return (
    <AdminShell
      title={data?.subject ?? 'محادثة دعم'}
      subtitle={
        data ? `${data.restaurant_name} · ${TOPIC_LABELS[data.topic] ?? data.topic}` : undefined
      }
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
      actions={
        data && data.status !== 'RESOLVED' ? (
          <button
            type="button"
            className="btn btn--outline"
            disabled={close.isPending}
            onClick={() => close.mutate()}
          >
            إنهاء بدون رد
          </button>
        ) : undefined
      }
    >
      {thread.isError ? (
        <ErrorState
          message={thread.error instanceof ApiError ? thread.error.messageAr : 'تعذّر تحميل المحادثة'}
          onRetry={() => void thread.refetch()}
        />
      ) : thread.isLoading || !data ? (
        <Skeleton height={400} />
      ) : (
        <>
          <Card>
            <div className="thread__meta">
              <Badge
                tone={
                  data.status === 'OPEN'
                    ? 'warning'
                    : data.status === 'ANSWERED'
                      ? 'neutral'
                      : 'success'
                }
              >
                {STATUS_LABELS[data.status] ?? data.status}
              </Badge>
              {data.priority === 'URGENT' ? <Badge tone="danger">عاجل</Badge> : null}
              <Link href={`/restaurants/${data.restaurant_id}`} className="btn btn--ghost btn--sm">
                فتح صفحة المطعم
              </Link>
            </div>

            <ol className="thread">
              {data.messages.map((entry) => (
                <li
                  key={entry.id}
                  className={`thread__message thread__message--${entry.side === 'JIBLI' ? 'us' : 'them'}`}
                >
                  <div className="thread__head">
                    <strong>{entry.author_name}</strong>
                    <span>{dateTimeAr(entry.created_at)}</span>
                  </div>
                  {/* Plain text, deliberately: a support message is not markup. */}
                  <p className="thread__body">{entry.body}</p>
                </li>
              ))}
            </ol>
          </Card>

          <Card title="الرد" icon="support">
            <div className="field">
              <label htmlFor="reply">نص الرد</label>
              <textarea
                id="reply"
                rows={5}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="اكتب ردّك للمطعم…"
              />
            </div>

            <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={resolve}
                onChange={(event) => setResolve(event.target.checked)}
              />
              إنهاء المحادثة بعد الإرسال
            </label>

            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              يستطيع المطعم الرد مرة أخرى في أي وقت، وسيُعاد فتح المحادثة تلقائياً إن فعل.
            </p>

            {reply.error ? (
              <p className="alert-bar alert-bar--danger" role="alert">
                {reply.error instanceof ApiError ? reply.error.messageAr : 'تعذّر إرسال الرد'}
              </p>
            ) : null}

            <div className="dialog__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={message.trim().length === 0 || reply.isPending}
                onClick={() => reply.mutate()}
              >
                {reply.isPending ? 'جاري الإرسال…' : 'إرسال الرد'}
              </button>
            </div>
          </Card>
        </>
      )}
    </AdminShell>
  );
}
