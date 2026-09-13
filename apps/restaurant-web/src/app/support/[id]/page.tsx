'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateTimeAr } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { portal } from '@/lib/portal-endpoints';
import { THREAD_STATUS_LABELS, TOPICS } from '@/lib/support-labels';

/**
 * One conversation, from the restaurant's side.
 *
 * Replying to a conversation Jibli marked finished reopens it. The alternative
 * — a closed thread that quietly accepts messages nobody is watching — turns
 * "it happened again" into a message that is never read.
 */
export default function SupportThreadPage() {
  return <PortalPage>{({ auth }) => <ThreadScreen auth={auth} />}</PortalPage>;
}

function ThreadScreen({ auth }: { auth: PortalAuth }) {
  const params = useParams<{ id: string }>();
  const threadId = params.id;
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');

  const thread = useQuery({
    queryKey: ['portal-support-thread', threadId],
    queryFn: () => portal.supportThread(auth, threadId),
  });

  const reply = useMutation({
    mutationFn: () => portal.replyToSupportThread(auth, threadId, message.trim()),
    onSuccess: () => {
      setMessage('');
      void queryClient.invalidateQueries({ queryKey: ['portal-support-thread', threadId] });
      void queryClient.invalidateQueries({ queryKey: ['portal-support'] });
    },
  });

  if (thread.isError) {
    return (
      <ErrorState
        message={thread.error instanceof ApiError ? thread.error.messageAr : 'تعذّر تحميل المحادثة'}
        onRetry={() => void thread.refetch()}
      />
    );
  }

  if (thread.isLoading || !thread.data) return <Skeleton height={400} />;

  const data = thread.data;

  return (
    <>
      <Card
        title={data.subject}
        icon="support"
        subtitle={TOPICS.find((topic) => topic.key === data.topic)?.labelAr ?? data.topic}
        actions={
          <Link className="btn btn--ghost btn--sm" href="/support">
            كل المحادثات
          </Link>
        }
      >
        <div className="thread__meta">
          <span
            className={`badge badge--${
              data.status === 'RESOLVED' ? 'neutral' : data.status === 'ANSWERED' ? 'success' : 'warning'
            }`}
          >
            {THREAD_STATUS_LABELS[data.status] ?? data.status}
          </span>
          {data.priority === 'URGENT' ? <span className="badge badge--danger">عاجل</span> : null}
        </div>

        <ol className="thread">
          {data.messages.map((entry) => (
            <li
              key={entry.id}
              className={`thread__message thread__message--${
                entry.side === 'RESTAURANT' ? 'us' : 'them'
              }`}
            >
              <div className="thread__head">
                <strong>{entry.side === 'JIBLI' ? `${entry.author_name} — جيبلي` : entry.author_name}</strong>
                <span>{dateTimeAr(entry.created_at)}</span>
              </div>
              {/* Plain text, deliberately: a support message is not markup. */}
              <p className="thread__body">{entry.body}</p>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="ردّك">
        <div className="field">
          <label htmlFor="reply">الرسالة</label>
          <textarea
            id="reply"
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="اكتب ردّك…"
          />
          {data.status === 'RESOLVED' ? (
            <span className="field__hint">
              هذه المحادثة منتهية. إرسال رسالة جديدة سيعيد فتحها لدى فريق جيبلي.
            </span>
          ) : null}
        </div>

        {reply.error ? (
          <p className="alert-bar alert-bar--danger" role="alert">
            {reply.error instanceof ApiError ? reply.error.messageAr : 'تعذّر إرسال الرد'}
          </p>
        ) : null}

        <button
          type="button"
          className="btn btn--primary"
          disabled={message.trim().length === 0 || reply.isPending}
          onClick={() => reply.mutate()}
        >
          {reply.isPending ? 'جاري الإرسال…' : 'إرسال'}
        </button>
      </Card>
    </>
  );
}
