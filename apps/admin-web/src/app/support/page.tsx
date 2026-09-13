'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { relativeAr } from '@jibli/ui-web';
import { AdminShell } from '@/components/shell';
import {
  Badge,
  Card,
  DataTable,
  ErrorState,
  FilterBar,
  SearchInput,
  Select,
  Skeleton,
} from '@/components/ui';
import { ApiError } from '@/lib/api';
import { admin, type SupportThreadSummary } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';
import { useDebounced } from '@/hooks/use-debounced';
import { THREAD_STATUS_LABELS, TOPIC_LABELS } from '@/lib/support-labels';

/**
 * Support inbox.
 *
 * A queue, not an archive: it opens on what is waiting for Jibli, sorted so
 * the thing that has waited longest is at the top. Sorting by newest — the
 * obvious default — buries the message from three days ago that nobody
 * answered under the one that arrived a minute ago and is already handled.
 */

export default function SupportPage() {
  const session = useAdminSession();
  const [status, setStatus] = useState<'OPEN' | 'ANSWERED' | 'RESOLVED' | ''>('OPEN');
  const [search, setSearch] = useState('');

  const debouncedSearch = useDebounced(search, 350);
  const token = session.status === 'authenticated' ? session.accessToken : '';

  const threads = useQuery({
    queryKey: ['admin-support', status, debouncedSearch],
    queryFn: () =>
      admin.supportThreads(token, {
        status: status || undefined,
        q: debouncedSearch || undefined,
      }),
    enabled: session.status === 'authenticated',
    // The inbox is the one screen where a stale list is actively misleading.
    refetchInterval: 60_000,
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  return (
    <AdminShell
      title="الدعم"
      subtitle="رسائل المطاعم إلى فريق جيبلي"
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      <Card>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={setSearch}
            label="بحث"
            placeholder="الموضوع أو اسم المطعم…"
          />
          <Select
            value={status}
            onChange={setStatus}
            label="الحالة"
            allLabel="كل المحادثات"
            options={(['OPEN', 'ANSWERED', 'RESOLVED'] as const).map((value) => ({
              value,
              label: THREAD_STATUS_LABELS[value] as string,
            }))}
          />
        </FilterBar>

        {threads.isError ? (
          <ErrorState
            message={
              threads.error instanceof ApiError ? threads.error.messageAr : 'تعذّر تحميل المحادثات'
            }
            onRetry={() => void threads.refetch()}
          />
        ) : threads.isLoading ? (
          <Skeleton height={320} />
        ) : (
          <DataTable<SupportThreadSummary>
            caption="محادثات الدعم"
            rows={threads.data ?? []}
            keyOf={(row) => row.id}
            emptyMessage={
              status === 'OPEN' ? 'لا توجد رسائل بانتظار الرد' : 'لا توجد محادثات مطابقة'
            }
            columns={[
              {
                key: 'subject',
                header: 'الموضوع',
                render: (row) => (
                  <Link
                    href={`/support/${row.id}`}
                    style={{ color: 'inherit', fontWeight: row.awaiting_jibli ? 700 : 500 }}
                  >
                    {row.subject}
                    {row.priority === 'URGENT' ? (
                      <span style={{ marginInlineStart: 6 }}>
                        <Badge tone="danger">عاجل</Badge>
                      </span>
                    ) : null}
                  </Link>
                ),
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
                key: 'topic',
                header: 'التصنيف',
                render: (row) => TOPIC_LABELS[row.topic] ?? row.topic,
              },
              {
                key: 'status',
                header: 'الحالة',
                render: (row) => (
                  <Badge
                    tone={
                      row.status === 'OPEN'
                        ? 'warning'
                        : row.status === 'ANSWERED'
                          ? 'neutral'
                          : 'success'
                    }
                  >
                    {THREAD_STATUS_LABELS[row.status] ?? row.status}
                  </Badge>
                ),
              },
              {
                key: 'messages',
                header: 'الرسائل',
                numeric: true,
                render: (row) => row.message_count,
              },
              {
                key: 'last',
                header: 'آخر رسالة',
                render: (row) => relativeAr(row.last_message_at),
              },
            ]}
          />
        )}
      </Card>
    </AdminShell>
  );
}
