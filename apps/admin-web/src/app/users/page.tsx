'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RESTAURANT_ROLE_LABELS, dateAr, relativeAr } from '@jibli/ui-web';
import { USER_STATUSES, type RestaurantRole, type UserStatus } from '@jibli/contracts';
import { AdminShell } from '@/components/shell';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  FilterBar,
  MfaChallenge,
  Money,
  SearchInput,
  Select,
  Skeleton,
} from '@/components/ui';
import { ApiError } from '@/lib/api';
import { admin, type AdminCustomer } from '@/lib/admin-endpoints';
import { SessionGate } from '@/components/session-gate';
import { useAdminSession } from '@/hooks/use-session';
import { useDebounced } from '@/hooks/use-debounced';

/**
 * People directory: restaurant owners and customers (plan §84, §87).
 *
 * One table for both, because one phone number is one person — an owner orders
 * dinner from someone else's restaurant like anybody. The audience filter is
 * what separates them on screen, and it opens on owners: that is who an
 * operator comes here looking for, while a customer list is something you
 * browse rather than search.
 *
 * Phone numbers arrive masked. Revealing one is a separate, audited request —
 * not a toggle — because plan §84 treats an unmask as a privileged action that
 * must leave a trace naming who looked and why.
 */

const STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'نشط',
  SUSPENDED: 'موقوف',
  DEACTIVATED: 'معطّل',
};

type Audience = 'OWNERS' | 'CUSTOMERS' | '';

const AUDIENCE_LABELS: Record<Exclude<Audience, ''>, string> = {
  OWNERS: 'ملاك المطاعم',
  CUSTOMERS: 'العملاء',
};

export default function UsersPage() {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [audience, setAudience] = useState<Audience>('OWNERS');
  const [blocking, setBlocking] = useState<AdminCustomer | null>(null);
  const [unmasking, setUnmasking] = useState<AdminCustomer | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [needsMfa, setNeedsMfa] = useState(false);

  const debouncedSearch = useDebounced(search, 350);
  const token = session.status === 'authenticated' ? session.accessToken : '';

  const customers = useQuery({
    queryKey: ['admin-customers', debouncedSearch, status, audience],
    queryFn: () =>
      admin.customers(token, {
        q: debouncedSearch || undefined,
        status: status || undefined,
        role: audience || undefined,
      }),
    enabled: session.status === 'authenticated',
  });

  const block = useMutation({
    mutationFn: ({ id, blocked, reason }: { id: string; blocked: boolean; reason: string }) =>
      admin.blockCustomer(token, id, blocked, reason),
    onSuccess: () => {
      setBlocking(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-customers'] });
    },
  });

  const unmask = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      admin.unmaskPhone(token, id, reason),
    onSuccess: (result, variables) => {
      setRevealed((current) => ({ ...current, [variables.id]: result.phone }));
      setUnmasking(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.needsReauth) setNeedsMfa(true);
    },
  });

  if (session.status !== 'authenticated') {
    return <SessionGate session={session} />;
  }

  return (
    <AdminShell
      title={
        audience === 'CUSTOMERS'
          ? 'العملاء'
          : audience === ''
            ? 'الأشخاص'
            : 'ملاك المطاعم'
      }
      subtitle={
        audience === 'OWNERS'
          ? 'من يدير المطاعم على المنصة، وما يديره كل منهم'
          : undefined
      }
      userName={session.userName || 'مدير'}
      userRoleAr={session.roleAr}
    >
      <Card>
        <FilterBar>
          <SearchInput
            value={search}
            onChange={setSearch}
            label="بحث"
            placeholder="الاسم، الهاتف، اسم المستخدم، أو اسم المطعم…"
          />
          <Select
            value={audience}
            onChange={setAudience}
            label="الفئة"
            allLabel="الجميع"
            options={(['OWNERS', 'CUSTOMERS'] as const).map((value) => ({
              value,
              label: AUDIENCE_LABELS[value],
            }))}
          />
          <Select
            value={status}
            onChange={setStatus}
            label="حالة الحساب"
            allLabel="كل الحالات"
            options={USER_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))}
          />
        </FilterBar>

        {customers.isError ? (
          <ErrorState
            message={
              customers.error instanceof ApiError
                ? customers.error.messageAr
                : 'تعذّر تحميل قائمة العملاء'
            }
            onRetry={() => void customers.refetch()}
          />
        ) : customers.isLoading ? (
          <Skeleton height={320} />
        ) : (
          <DataTable<AdminCustomer>
            caption={audience === 'CUSTOMERS' ? 'قائمة العملاء' : 'قائمة الأشخاص'}
            rows={customers.data ?? []}
            keyOf={(row) => row.id}
            emptyMessage={
              audience === 'OWNERS'
                ? 'لا يوجد ملاك مطاعم مطابقون'
                : 'لا يوجد أشخاص مطابقون'
            }
            columns={[
              {
                key: 'name',
                header: 'الاسم',
                render: (row) => row.full_name ?? <span style={{ color: 'var(--text-muted)' }}>—</span>,
              },
              {
                key: 'restaurant',
                header: 'المطعم',
                render: (row) =>
                  row.restaurants.length === 0 ? (
                    <span style={{ color: 'var(--text-muted)' }}>عميل</span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {row.restaurants.map((restaurant) => (
                        <Link
                          key={restaurant.id}
                          href={`/restaurants/${restaurant.id}`}
                          style={{ color: 'inherit', fontWeight: 600 }}
                        >
                          {restaurant.display_name}
                          <span
                            style={{
                              color: 'var(--text-muted)',
                              fontWeight: 400,
                              fontSize: 'var(--text-xs)',
                              marginInlineStart: 6,
                            }}
                          >
                            {RESTAURANT_ROLE_LABELS[restaurant.role as RestaurantRole] ??
                              restaurant.role}
                          </span>
                        </Link>
                      ))}
                    </div>
                  ),
              },
              {
                key: 'phone',
                header: 'الهاتف',
                render: (row) => (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="ltr-inline">{revealed[row.id] ?? row.phone}</span>
                    {row.phone_masked && !revealed[row.id] ? (
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        onClick={() => setUnmasking(row)}
                      >
                        إظهار
                      </button>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'الحالة',
                render: (row) => (
                  <Badge tone={row.status === 'ACTIVE' ? 'success' : 'danger'}>
                    {STATUS_LABELS[row.status as UserStatus]}
                  </Badge>
                ),
              },
              {
                key: 'profile',
                header: 'الملف',
                render: (row) =>
                  row.profile_completed ? (
                    <Badge tone="success">مكتمل</Badge>
                  ) : (
                    <Badge tone="warning">غير مكتمل</Badge>
                  ),
              },
              { key: 'city', header: 'المدينة', render: (row) => row.city_name_ar ?? '—' },
              { key: 'orders', header: 'الطلبات', numeric: true, render: (row) => row.order_count },
              {
                key: 'spend',
                header: 'إجمالي الإنفاق',
                numeric: true,
                render: (row) => <Money amount={row.lifetime_spend_iqd} />,
              },
              {
                key: 'joined',
                header: 'الانضمام',
                render: (row) => dateAr(row.created_at),
              },
              {
                key: 'seen',
                header: 'آخر دخول',
                render: (row) => (row.last_login_at ? relativeAr(row.last_login_at) : '—'),
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <button
                    type="button"
                    className={`btn btn--sm ${row.status === 'ACTIVE' ? 'btn--danger' : 'btn--outline'}`}
                    onClick={() => setBlocking(row)}
                  >
                    {row.status === 'ACTIVE' ? 'حظر' : 'رفع الحظر'}
                  </button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {blocking ? (
        <ConfirmDialog
          title={
            blocking.status === 'ACTIVE'
              ? `حظر ${blocking.full_name ?? 'العميل'}`
              : `رفع الحظر عن ${blocking.full_name ?? 'العميل'}`
          }
          confirmLabel={blocking.status === 'ACTIVE' ? 'حظر الحساب' : 'رفع الحظر'}
          tone={blocking.status === 'ACTIVE' ? 'danger' : 'primary'}
          requireReason
          isSubmitting={block.isPending}
          error={block.error instanceof ApiError ? block.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {blocking.status === 'ACTIVE'
                ? 'يتم إنهاء جلسات العميل فوراً ولن يتمكن من تسجيل الدخول أو الطلب. لا تُحذف طلباته أو بياناته السابقة.'
                : 'سيتمكن العميل من تسجيل الدخول والطلب مرة أخرى.'}
            </p>
          }
          onConfirm={(reason) =>
            block.mutate({
              id: blocking.id,
              blocked: blocking.status === 'ACTIVE',
              reason,
            })
          }
          onCancel={() => setBlocking(null)}
        />
      ) : null}

      {unmasking ? (
        <ConfirmDialog
          title="إظهار رقم الهاتف"
          confirmLabel="إظهار الرقم"
          tone="primary"
          requireReason
          isSubmitting={unmask.isPending}
          error={unmask.error instanceof ApiError ? unmask.error.messageAr : null}
          body={
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              يُسجَّل هذا الإجراء في سجل الأنشطة مع اسمك والسبب. أظهر الرقم فقط عند الحاجة
              التشغيلية الفعلية.
            </p>
          }
          onConfirm={(reason) => unmask.mutate({ id: unmasking.id, reason })}
          onCancel={() => setUnmasking(null)}
        />
      ) : null}

      {needsMfa ? (
        <MfaChallenge onVerified={() => setNeedsMfa(false)} onCancel={() => setNeedsMfa(false)} />
      ) : null}
    </AdminShell>
  );
}
