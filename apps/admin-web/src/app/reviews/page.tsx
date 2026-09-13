'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateAr } from '@jibli/ui-web';
import { AdminShell } from '@/components/shell';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  FilterBar,
  Select,
  Skeleton,
} from '@/components/ui';
import { Icon } from '@/components/icon';
import { ApiError } from '@/lib/api';
import { admin, type AdminReview } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';

/**
 * Ratings, and hiding the ones that are not ratings.
 *
 * Opens on the low ones, because that is what moderation is about and because
 * a one-star review is also the earliest warning that something at a restaurant
 * has gone wrong.
 *
 * Hide, never delete. A deleted review is an accusation nobody can re-read, and
 * the one case where moderation is contested is exactly the case where the
 * original text matters. Hiding removes it from the average immediately.
 */
export default function ReviewsPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [maxRating, setMaxRating] = useState('3');
  const [hidden, setHidden] = useState('');
  const [moderating, setModerating] = useState<AdminReview | null>(null);

  const token = session.status === 'authenticated' ? session.accessToken : '';

  const reviews = useQuery({
    queryKey: ['admin-reviews', maxRating, hidden],
    queryFn: () =>
      admin.reviews(token, {
        max_rating: maxRating || undefined,
        hidden: hidden || undefined,
      }),
    enabled: session.status === 'authenticated',
  });

  const setVisibility = useMutation({
    mutationFn: ({ id, isHidden, reason }: { id: string; isHidden: boolean; reason: string }) =>
      admin.setReviewHidden(token, id, isHidden, reason),
    onSuccess: () => {
      setModerating(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-reviews'] });
      // The restaurant's star column moves with it.
      void queryClient.invalidateQueries({ queryKey: ['admin-restaurants'] });
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  return (
    <AdminShell
      title="التقييمات"
      subtitle="تقييمات العملاء بعد استلام الطلب"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      <Card>
        <FilterBar>
          <Select
            value={maxRating}
            onChange={setMaxRating}
            label="حتى تقييم"
            allLabel="كل التقييمات"
            options={[
              { value: '1', label: 'نجمة واحدة' },
              { value: '2', label: 'نجمتان فأقل' },
              { value: '3', label: 'ثلاث نجوم فأقل' },
            ]}
          />
          <Select
            value={hidden}
            onChange={setHidden}
            label="الظهور"
            allLabel="الكل"
            options={[
              { value: 'false', label: 'ظاهرة' },
              { value: 'true', label: 'مخفية' },
            ]}
          />
        </FilterBar>

        {reviews.isError ? (
          <ErrorState
            message={
              reviews.error instanceof ApiError ? reviews.error.messageAr : 'تعذّر تحميل التقييمات'
            }
            onRetry={() => void reviews.refetch()}
          />
        ) : reviews.isLoading ? (
          <Skeleton height={320} />
        ) : (
          <DataTable<AdminReview>
            caption="تقييمات العملاء"
            rows={reviews.data ?? []}
            keyOf={(row) => row.id}
            emptyMessage="لا توجد تقييمات مطابقة"
            columns={[
              {
                key: 'rating',
                header: 'التقييم',
                render: (row) => <Stars value={row.rating} />,
              },
              {
                key: 'restaurant',
                header: 'المطعم',
                render: (row) => (
                  <Link href={`/restaurants/${row.restaurant_id}`} style={{ color: 'inherit' }}>
                    {row.restaurant_name}
                  </Link>
                ),
              },
              {
                key: 'comment',
                header: 'التعليق',
                render: (row) =>
                  row.comment ? (
                    <span style={{ opacity: row.is_hidden ? 0.5 : 1 }}>{row.comment}</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>بدون تعليق</span>
                  ),
              },
              {
                key: 'order',
                header: 'الطلب',
                render: (row) => (
                  <span className="ltr-inline">#{row.public_order_number}</span>
                ),
              },
              { key: 'date', header: 'التاريخ', render: (row) => dateAr(row.created_at) },
              {
                key: 'state',
                header: 'الحالة',
                render: (row) =>
                  row.is_hidden ? <Badge tone="neutral">مخفي</Badge> : <Badge tone="success">ظاهر</Badge>,
              },
              {
                key: 'actions',
                header: 'إجراءات',
                render: (row) => (
                  <button
                    type="button"
                    className={`btn btn--${row.is_hidden ? 'ghost' : 'danger'} btn--sm`}
                    onClick={() => setModerating(row)}
                  >
                    {row.is_hidden ? 'إظهار' : 'إخفاء'}
                  </button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {moderating ? (
        <ConfirmDialog
          title={moderating.is_hidden ? 'إظهار التقييم' : 'إخفاء التقييم'}
          confirmLabel={moderating.is_hidden ? 'إظهار' : 'إخفاء'}
          requireReason
          isSubmitting={setVisibility.isPending}
          error={setVisibility.error instanceof ApiError ? setVisibility.error.messageAr : null}
          body={
            <div className="dialog__impact">
              <strong>
                <Icon name="alert" className="nav__icon" aria-hidden /> ماذا يحدث
              </strong>
              <p style={{ margin: 0 }}>
                {moderating.is_hidden
                  ? 'يعود التقييم للظهور للعملاء ويُحتسب في متوسط تقييم المطعم من جديد.'
                  : 'يختفي التقييم عن العملاء ويُستبعد من متوسط تقييم المطعم فوراً. لا يُحذف — يبقى في السجل ويمكن إظهاره لاحقاً.'}
              </p>
            </div>
          }
          onConfirm={(reason) =>
            setVisibility.mutate({
              id: moderating.id,
              isHidden: !moderating.is_hidden,
              reason,
            })
          }
          onCancel={() => setModerating(null)}
        />
      ) : null}
    </AdminShell>
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
