'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateAr } from '@jibli/ui-web';
import { Badge, Card, ConfirmDialog, ErrorState, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { admin, type ReviewQueueItem } from '@/lib/admin-endpoints';

/**
 * The moderation queue: what the content screen held, and what readers
 * reported. Both stores require that reports reach someone who acts on them;
 * this is where they reach Jibli.
 *
 * Publish when the screen or the reporters were wrong, hide when they were
 * right. Either decision closes the review's open reports and takes it out of
 * the queue; a reason is recorded in the audit log.
 */

const HELD_LABEL: Record<string, string> = {
  PROFANITY: 'ألفاظ مسيئة',
  CONTACT: 'رقم أو بريد',
  LINK: 'رابط',
  REPORTED: 'أُخفي بعد بلاغات',
};

const REPORT_LABEL: Record<string, string> = {
  ABUSIVE: 'إساءة',
  SPAM: 'مزعج',
  PERSONAL_DATA: 'بيانات شخصية',
  FALSE: 'ادعاء غير صحيح',
  OTHER: 'آخر',
};

export function ReviewQueue({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [deciding, setDeciding] = useState<{
    item: ReviewQueueItem;
    action: 'PUBLISH' | 'HIDE';
  } | null>(null);

  const queue = useQuery({
    queryKey: ['admin-review-queue'],
    queryFn: () => admin.reviewQueue(token),
    refetchInterval: 60_000,
  });

  const resolve = useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'PUBLISH' | 'HIDE';
      reason: string;
    }) => admin.resolveReview(token, id, action, reason),
    onSuccess: () => {
      setDeciding(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-review-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-restaurants'] });
    },
  });

  const items = queue.data ?? [];

  return (
    <Card
      title={`طابور المراجعة${items.length > 0 ? ` (${items.length})` : ''}`}
      icon="alert"
      subtitle="تعليقات أوقفها الفلتر، وتقييمات أبلغ عنها القرّاء"
    >
      {queue.isError ? (
        <ErrorState
          message={queue.error instanceof ApiError ? queue.error.messageAr : 'تعذّر تحميل الطابور'}
          onRetry={() => void queue.refetch()}
        />
      ) : queue.isLoading ? (
        <Skeleton height={160} />
      ) : items.length === 0 ? (
        <p className="empty">لا شيء بانتظار المراجعة</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((item) => (
            <li
              key={item.review_id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
                padding: 'var(--space-3) 0',
                borderBlockEnd: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-2)',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <strong>{item.restaurant_name}</strong>
                <span>{'★'.repeat(item.rating)}</span>
                <span className="ltr-inline">#{item.public_order_number}</span>
                <span style={{ color: 'var(--text-muted)' }}>{dateAr(item.created_at)}</span>
                {item.held_reason ? (
                  <Badge tone="warning">{HELD_LABEL[item.held_reason] ?? item.held_reason}</Badge>
                ) : null}
                {item.open_reports > 0 ? (
                  <Badge tone="danger">
                    {item.open_reports} بلاغ —{' '}
                    {item.report_reasons.map((reason) => REPORT_LABEL[reason] ?? reason).join('، ')}
                  </Badge>
                ) : null}
                <Badge tone={item.is_hidden ? 'neutral' : 'success'}>
                  {item.is_hidden ? 'مخفي الآن' : 'ظاهر الآن'}
                </Badge>
              </div>
              <p style={{ margin: 0 }}>{item.comment ?? 'تقييم بدون تعليق'}</p>
              {item.report_notes.length > 0 ? (
                <p
                  style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}
                >
                  ملاحظات المبلّغين: {item.report_notes.join(' · ')}
                </p>
              ) : null}
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => setDeciding({ item, action: 'PUBLISH' })}
                >
                  نشر
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => setDeciding({ item, action: 'HIDE' })}
                >
                  إخفاء
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deciding ? (
        <ConfirmDialog
          title={deciding.action === 'HIDE' ? 'إخفاء التقييم' : 'نشر التقييم'}
          confirmLabel={deciding.action === 'HIDE' ? 'إخفاء' : 'نشر'}
          requireReason
          isSubmitting={resolve.isPending}
          error={resolve.error instanceof ApiError ? resolve.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {deciding.action === 'HIDE'
                ? 'يُخفى التقييم عن الجميع ويُستبعد من متوسط تقييم المتجر، وتُغلق بلاغاته.'
                : 'يظهر التقييم ويُحسب في متوسط المتجر، وتُغلق بلاغاته كمرفوضة.'}
            </p>
          }
          onConfirm={(reason) =>
            resolve.mutate({ id: deciding.item.review_id, action: deciding.action, reason })
          }
          onCancel={() => setDeciding(null)}
        />
      ) : null}
    </Card>
  );
}
