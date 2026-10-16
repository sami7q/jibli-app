'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateAr } from '@jibli/ui-web';
import { PortalPage, type PortalAuth } from '@/components/portal-page';
import { Card, ConfirmDialog, ErrorState, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { portal } from '@/lib/portal-endpoints';

/**
 * What customers said.
 *
 * Read-only, and deliberately. A restaurant that could reply in public, edit or
 * remove a rating would turn the number customers rely on into something the
 * restaurant curates. A restaurant that disagrees with one opens a support
 * thread, where a person looks at it.
 *
 * The distribution is shown beside the average because "4.2" says nothing about
 * whether that is everybody giving four, or half giving five and half giving
 * two — and those are different kitchens with different problems.
 */
export default function ReviewsPage() {
  return <PortalPage>{({ auth }) => <ReviewsScreen auth={auth} />}</PortalPage>;
}

function ReviewsScreen({ auth }: { auth: PortalAuth }) {
  const [maxRating, setMaxRating] = useState<number | undefined>(undefined);
  const queryClient = useQueryClient();
  const [reporting, setReporting] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<
    'ABUSIVE' | 'SPAM' | 'PERSONAL_DATA' | 'FALSE' | 'OTHER'
  >('ABUSIVE');
  const [blocking, setBlocking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const report = useMutation({
    mutationFn: ({ reviewId, note }: { reviewId: string; note: string }) =>
      portal.reportReview(auth, reviewId, { reason: reportReason, note: note || undefined }),
    onSuccess: (result) => {
      setReporting(null);
      setNotice(result.note_ar);
      void queryClient.invalidateQueries({ queryKey: ['portal-reviews'] });
    },
  });

  const block = useMutation({
    mutationFn: (reviewId: string) => portal.blockReviewAuthor(auth, reviewId),
    onSuccess: (result) => {
      setBlocking(null);
      setNotice(result.note_ar);
      void queryClient.invalidateQueries({ queryKey: ['portal-reviews'] });
    },
  });

  const reviews = useQuery({
    queryKey: ['portal-reviews', auth.restaurantId, maxRating],
    queryFn: () => portal.reviews(auth, { max_rating: maxRating }),
  });

  if (reviews.isError) {
    return (
      <ErrorState
        message={
          reviews.error instanceof ApiError ? reviews.error.messageAr : 'تعذّر تحميل التقييمات'
        }
        onRetry={() => void reviews.refetch()}
      />
    );
  }

  if (reviews.isLoading || !reviews.data) return <Skeleton height={420} />;

  const data = reviews.data;
  const highest = Math.max(1, ...Object.values(data.distribution));

  return (
    <>
      <Card title="تقييم مطعمك" icon="star">
        {data.rating_count === 0 ? (
          <div className="empty">
            <p style={{ margin: 0, fontWeight: 600 }}>لا توجد تقييمات بعد</p>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              يستطيع العميل التقييم بعد استلام طلبه بقليل. ستظهر التقييمات هنا فور وصولها.
            </p>
          </div>
        ) : (
          <div className="rating-summary">
            <div className="rating-summary__score">
              <strong>{data.rating?.toFixed(1)}</strong>
              <Stars value={Math.round(data.rating ?? 0)} />
              <span>{data.rating_count} تقييم</span>
            </div>

            <ul className="rating-bars">
              {[5, 4, 3, 2, 1].map((step) => {
                const total = data.distribution[String(step)] ?? 0;
                return (
                  <li key={step}>
                    <span className="rating-bars__label">{step}</span>
                    <span className="rating-bars__track" aria-hidden>
                      <span style={{ inlineSize: `${Math.round((total / highest) * 100)}%` }} />
                    </span>
                    <span className="rating-bars__count">{total}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <Card
        title="آراء العملاء"
        icon="star"
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="button"
              className={`btn btn--${maxRating === undefined ? 'primary' : 'ghost'} btn--sm`}
              onClick={() => setMaxRating(undefined)}
            >
              الكل
            </button>
            <button
              type="button"
              className={`btn btn--${maxRating === 3 ? 'primary' : 'ghost'} btn--sm`}
              onClick={() => setMaxRating(3)}
            >
              الأقل من ٤
            </button>
          </div>
        }
      >
        {data.reviews.length === 0 ? (
          <p className="empty">لا توجد تقييمات مطابقة</p>
        ) : (
          <ul className="reviews">
            {data.reviews.map((review) => (
              <li key={review.id} className="review">
                <div className="review__head">
                  <Stars value={review.rating} />
                  <strong>{review.author_name}</strong>
                  <span className="ltr-inline">#{review.public_order_number}</span>
                  <span>{dateAr(review.created_at)}</span>
                </div>
                {review.comment ? (
                  <p className="review__body">{review.comment}</p>
                ) : (
                  <p className="review__body review__body--empty">تقييم بدون تعليق</p>
                )}
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-2)',
                    marginBlockStart: 'var(--space-2)',
                  }}
                >
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setReporting(review.id)}
                  >
                    إبلاغ
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setBlocking(review.id)}
                  >
                    حظر الكاتب
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {notice ? (
          <p className="alert-bar alert-bar--success" role="status">
            {notice}
          </p>
        ) : null}

        <p style={{ marginBlockEnd: 0, fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          التقييمات تصل من العملاء بعد استلام الطلب ولا يمكن تعديلها أو حذفها من هنا. إن كان تقييم
          مخالفاً أو غير صحيح فاضغط <strong>إبلاغ</strong> وسيراجعه فريق جيبلي ويقرّر إخفاءه.{' '}
          <strong>حظر الكاتب</strong> يخفي تقييماته من قائمتك أنت فقط.
        </p>
      </Card>

      {reporting ? (
        <ConfirmDialog
          title="الإبلاغ عن تقييم"
          confirmLabel="إرسال البلاغ"
          tone="primary"
          isSubmitting={report.isPending}
          error={report.error instanceof ApiError ? report.error.messageAr : null}
          body={
            <div className="field">
              <label htmlFor="report-reason">السبب</label>
              <select
                id="report-reason"
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value as typeof reportReason)}
              >
                <option value="ABUSIVE">إساءة أو شتائم</option>
                <option value="PERSONAL_DATA">بيانات شخصية (رقم، عنوان)</option>
                <option value="SPAM">إعلان أو محتوى مزعج</option>
                <option value="FALSE">ادعاء غير صحيح</option>
                <option value="OTHER">سبب آخر</option>
              </select>
            </div>
          }
          onConfirm={(note) => report.mutate({ reviewId: reporting, note })}
          onCancel={() => setReporting(null)}
        />
      ) : null}

      {blocking ? (
        <ConfirmDialog
          title="حظر كاتب التقييم"
          confirmLabel="حظر"
          isSubmitting={block.isPending}
          error={block.error instanceof ApiError ? block.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              لن تظهر لك تقييمات هذا العميل بعد الآن. نجومه تبقى ضمن متوسط تقييمك، ولا يُبلَّغ
              بالحظر.
            </p>
          }
          onConfirm={() => block.mutate(blocking)}
          onCancel={() => setBlocking(null)}
        />
      ) : null}
    </>
  );
}

/** Five stars, with the filled count also in the accessible name. */
function Stars({ value }: { value: number }) {
  return (
    <span className="stars" role="img" aria-label={`${value} من 5`}>
      {[1, 2, 3, 4, 5].map((step) => (
        <Icon
          key={step}
          name="star"
          className={`stars__star${step <= value ? ' stars__star--on' : ''}`}
          aria-hidden
        />
      ))}
    </span>
  );
}
